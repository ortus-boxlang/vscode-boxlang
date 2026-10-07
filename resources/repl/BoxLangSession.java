import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.*;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import ortus.boxlang.runtime.BoxRuntime;
import ortus.boxlang.runtime.context.ScriptingRequestBoxContext;
import ortus.boxlang.runtime.context.IBoxContext;
import ortus.boxlang.runtime.scopes.Key;
import ortus.boxlang.compiler.parser.BoxSourceType;
import ortus.boxlang.runtime.runnables.BoxScript;
import ortus.boxlang.runtime.runnables.IClassRunnable;
import ortus.boxlang.runtime.interop.DynamicObject;
import ortus.boxlang.runtime.runnables.RunnableLoader;
import ortus.boxlang.runtime.types.exceptions.ParseException;
import ortus.boxlang.runtime.types.Query;
import ortus.boxlang.runtime.types.util.JSONUtil;
import ortus.boxlang.runtime.util.ResolvedFilePath;

/** Java 21 source-file launcher: uses the selected runtime JAR, no additional build or dependencies. */
class BoxLangSession {
    static final int LIMIT = 100;
    static final int OUTPUT_LIMIT = 65536;

    static class SessionContext extends ScriptingRequestBoxContext {
        ResolvedFilePath source;
        ResolvedFilePath scriptPath;
        SessionContext(BoxRuntime runtime) { super(runtime.getRuntimeContext(), false); }
        @Override public IBoxContext pushTemplate(ResolvedFilePath template) {
            // Replace the ad-hoc script's placeholder path, not included templates' real paths.
            return super.pushTemplate(Objects.equals(template, scriptPath) ? source : template);
        }
    }

    static class Output extends OutputStream {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        boolean truncated;
        public synchronized void write(int value) {
            if (bytes.size() < OUTPUT_LIMIT) bytes.write(value);
            else truncated = true;
        }
        synchronized void reset() { bytes.reset(); truncated = false; }
        synchronized String text() { return bytes.toString(StandardCharsets.UTF_8) + (truncated ? "\n[Output truncated]" : ""); }
    }

    public static void main(String[] args) throws Exception {
        PrintStream protocol = System.out;
        // Runtime/module startup logging must not enter the JSON protocol stream.
        System.setOut(System.err);
        String home = System.getenv("BOXLANG_HOME");
        if (home == null || home.isBlank()) throw new IllegalArgumentException("BOXLANG_HOME must be supplied by the session launcher");
        String config = System.getenv("BOXLANG_CONFIG");
        if (config == null && Files.isRegularFile(Path.of(".boxlang.json"))) config = Path.of(".boxlang.json").toAbsolutePath().toString();
        // Unlike BoxRunner, the embedded API does not resolve BOXLANG_HOME for us.
        BoxRuntime runtime = BoxRuntime.getInstance(false, config, home);
        var context = new SessionContext(runtime);
        var output = new Output();
        var capture = new PrintStream(output, true, StandardCharsets.UTF_8);
        System.setOut(capture);
        System.setErr(capture);
        context.setOut(capture);
        var results = new LinkedHashMap<Long, Object>();
        send(protocol, Map.of("ready", true));
        try (var reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.reset();
                var response = new LinkedHashMap<String, Object>();
                try {
                    var request = (Map<?, ?>) JSONUtil.fromJSON(line);
                    response.put("id", request.get("id"));
                    switch ((String) request.get("action")) {
                        case "execute" -> {
                            String code = (String) request.get("code");
                            if (code == null || code.isBlank() || code.length() > 1000000) throw new IllegalArgumentException("Expected non-empty code (maximum 1 MB)");
                            String source = (String) request.get("source");
                            context.source = ResolvedFilePath.of(source == null ? Path.of(".boxlang-repl.bxs").toAbsolutePath() : Path.of(source));
                            BoxScript script;
                            try {
                                script = RunnableLoader.getInstance().loadStatement(context, code, BoxSourceType.BOXSCRIPT);
                            } catch (ParseException parseError) {
                                script = RunnableLoader.getInstance().loadSource(context, code, BoxSourceType.BOXSCRIPT);
                            }
                            // Compile before executing: a runtime error must never cause a second execution.
                            context.scriptPath = script.getRunnablePath();
                            // Older runtimes do not push a template for ad-hoc scripts at all.
                            context.pushTemplate(context.source);
                            try {
                                Object result = runtime.executeStatement(script, context);
                                response.put("result", describe("result", result));
                                if (request.get("executionId") instanceof Number executionId) {
                                    response.put("executionId", executionId.longValue());
                                    results.put(executionId.longValue(), result);
                                    if (results.size() > LIMIT) results.remove(results.keySet().iterator().next());
                                }
                            } finally {
                                context.popTemplate();
                            }
                        }
                        case "inspect" -> {
                            Object value;
                            if (request.get("executionId") instanceof Number executionId) {
                                if (!results.containsKey(executionId.longValue())) throw new IllegalArgumentException("Result expired or belongs to a stopped session; run the code again");
                                value = results.get(executionId.longValue());
                            } else {
                                String scope = request.get("scope") instanceof String name ? name : "variables";
                                if (!List.of("variables", "server", "request").contains(scope)) throw new IllegalArgumentException("Unsupported scope");
                                value = context.getScopeNearby(Key.of(scope));
                            }
                            var segments = request.get("path") instanceof List<?> list ? list : List.of();
                            if (segments.size() > 20) throw new IllegalArgumentException("Inspection path is too deep");
                            for (Object segment : segments) value = child(value, (String) segment);
                            response.put("variables", children(value));
                        }
                        default -> throw new IllegalArgumentException("Unknown session action");
                    }
                    response.put("ok", true);
                } catch (Exception error) {
                    response.put("ok", false);
                    response.put("error", error.getClass().getSimpleName() + ": " + error.getMessage());
                } finally {
                    context.flushBuffer(true);
                    response.put("output", output.text());
                }
                send(protocol, response);
            }
        } finally {
            context.shutdown();
            runtime.shutdown();
        }
    }

    static void send(PrintStream protocol, Object response) throws Exception {
        protocol.println(JSONUtil.getJSONBuilder(false).asString(response));
        protocol.flush();
    }

    // Only runtime-owned class scopes and public instance fields; never evaluate user getters.
    static Object unwrap(Object value) {
        if (value instanceof DynamicObject dynamic) return dynamic.getTargetInstance() == null ? dynamic.getTargetClass() : dynamic.getTargetInstance();
        return value;
    }

    static Object inspectable(Object value) {
        value = unwrap(value);
        if (value instanceof IClassRunnable instance) {
            return Map.of("this", instance.getThisScope(), "variables", instance.getVariablesScope());
        }
        return value;
    }

    static List<Field> fields(Object value) {
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean || value instanceof Class<?>) return List.of();
        return Arrays.stream(value.getClass().getFields())
            .filter(field -> !Modifier.isStatic(field.getModifiers()) && !field.isSynthetic())
            .sorted(Comparator.comparing(Field::getName)).limit(LIMIT).toList();
    }

    static Object child(Object value, String name) throws Exception {
        value = inspectable(value);
        if (value instanceof Map<?, ?> map) {
            for (var entry : map.entrySet()) if (keyName(entry.getKey()).equalsIgnoreCase(name)) return entry.getValue();
            throw new IllegalArgumentException("Unknown variable: " + name);
        }
        if (value instanceof List<?> list) return list.get(Integer.parseInt(name) - 1);
        if (value instanceof Query query) {
            int index = Integer.parseInt(name) - 1;
            if (index < 0 || index >= query.size()) throw new IllegalArgumentException("Invalid query row");
            return query.getRowAsStruct(index);
        }
        if (value != null && value.getClass().isArray()) return java.lang.reflect.Array.get(value, Integer.parseInt(name) - 1);
        for (Field field : fields(value)) if (field.getName().equals(name)) return field.get(value);
        throw new IllegalArgumentException("Value is not expandable or member is unavailable");
    }

    static List<Map<String, Object>> children(Object value) throws Exception {
        value = inspectable(value);
        var result = new ArrayList<Map<String, Object>>();
        if (value instanceof Map<?, ?> map) {
            for (var entry : map.entrySet()) {
                if (result.size() == LIMIT) break;
                result.add(describe(keyName(entry.getKey()), entry.getValue()));
            }
        } else if (value instanceof List<?> list) {
            for (int i = 0; i < Math.min(list.size(), LIMIT); i++) result.add(describe(Integer.toString(i + 1), list.get(i)));
        } else if (value instanceof Query query) {
            for (int i = 0; i < Math.min(query.size(), LIMIT); i++) result.add(describe(Integer.toString(i + 1), query.getRowAsStruct(i)));
        } else if (value != null && value.getClass().isArray()) {
            for (int i = 0; i < Math.min(java.lang.reflect.Array.getLength(value), LIMIT); i++) result.add(describe(Integer.toString(i + 1), java.lang.reflect.Array.get(value, i)));
        } else if (!fields(value).isEmpty()) {
            for (Field field : fields(value)) {
                try { result.add(describe(field.getName(), field.get(value))); }
                catch (IllegalAccessException error) { result.add(describe(field.getName(), "[inaccessible public field]")); }
            }
        } else result.add(describe("value", value));
        return result;
    }

    static String keyName(Object key) { return key instanceof Key boxKey ? boxKey.getName() : String.valueOf(key); }

    // ponytail: first 100 children and 2 KB scalar previews; add paging/full-value retrieval after the POC.
    static Map<String, Object> describe(String name, Object value) {
        Object original = unwrap(value);
        String type = original == null ? "null" : original instanceof IClassRunnable instance ? instance.bxGetName().getName() : original.getClass().getSimpleName();
        value = inspectable(original);
        boolean array = value != null && value.getClass().isArray();
        boolean expandable = value instanceof Map<?, ?> || value instanceof List<?> || value instanceof Query || array || !fields(value).isEmpty();
        String preview;
        if (value == null) preview = "null";
        else if (value instanceof String || value instanceof Number || value instanceof Boolean) preview = String.valueOf(value);
        else if (value instanceof Map<?, ?> map) preview = "{" + map.size() + " entries}";
        else if (value instanceof List<?> list) preview = "[" + list.size() + " items]";
        else if (value instanceof Query query) preview = "Query (" + query.size() + " rows)";
        else if (array) preview = "[" + java.lang.reflect.Array.getLength(value) + " items]";
        else preview = "[" + type + "]";
        if (preview.length() > 2048) preview = preview.substring(0, 2048) + "…";
        return Map.of("name", name, "type", type, "value", preview, "expandable", expandable);
    }
}
