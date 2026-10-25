import assert from "assert";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import readline from "readline";

/** Real-runtime check, deliberately separate from the mocked unit suite. */
async function main() {
    const jar = process.env.BOXLANG_REPL_TEST_JAR;
    if (!jar) throw new Error("Set BOXLANG_REPL_TEST_JAR to a BoxLang runtime JAR; optionally set BOXLANG_REPL_TEST_JAVA to Java 21+.");
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "boxlang-repl-smoke-"));
    const proc = spawn(process.env.BOXLANG_REPL_TEST_JAVA || "java", [
        "--class-path", path.resolve(jar), path.resolve("resources/repl/BoxLangSession.java")
    ], { cwd: directory, env: { ...process.env, BOXLANG_HOME: path.join(directory, "home"), BOXLANG_CONFIG: undefined, BOXLANG_MODULESDIRECTORY: undefined } });
    let stderr = "";
    proc.stderr.on("data", data => { stderr += data; });
    const reader = readline.createInterface({ input: proc.stdout });
    const messages: object[] = [];
    let waiting: { resolve: (message: any) => void; reject: (error: Error) => void } | undefined;
    reader.on("line", line => {
        try {
            const message = JSON.parse(line);
            if (waiting) { const request = waiting; waiting = undefined; request.resolve(message); }
            else messages.push(message);
        } catch (error) { waiting?.reject(error); }
    });
    proc.stdin.on("error", error => waiting?.reject(error));
    proc.on("error", error => waiting?.reject(error));
    proc.on("close", code => waiting?.reject(new Error(`Bridge exited (${code}): ${stderr}`)));
    const timeout = setTimeout(() => { proc.kill("SIGKILL"); waiting?.reject(new Error(`Smoke test timed out: ${stderr}`)); }, 60000);
    const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise<any>((resolve, reject) => { waiting = { resolve, reject }; });
    let id = 0;
    const request = async (payload: object) => {
        const requestId = ++id;
        proc.stdin.write(JSON.stringify({ id: requestId, ...((payload as any).action === "execute" ? { executionId: requestId } : {}), ...payload }) + "\n");
        const response = await next();
        assert.strictEqual(response.id, requestId);
        return response;
    };
    try {
        assert.deepStrictEqual(await next(), { ready: true });
        const server = await request({ action: "execute", code: "server.java" });
        assert.strictEqual(server.result.expandable, true);
        const serverResult = await request({ action: "inspect", executionId: server.executionId });
        assert.ok(serverResult.variables.length > 0, 'bare expression results must be explorable without assignment');
        const serverScope = await request({ action: "inspect", scope: "server", path: ["java"] });
        assert.deepStrictEqual(serverScope.variables, serverResult.variables);
        assert.deepStrictEqual((await request({ action: "inspect" })).variables, [], 'server.java does not create local variables');
        assert.strictEqual((await request({ action: "inspect", scope: "request" })).ok, true);
        const home = await request({ action: "execute", code: 'println(createObject("java", "ortus.boxlang.runtime.BoxRuntime").getInstance().getRuntimeHome().toString());' });
        assert.strictEqual(home.output.trim(), path.join(directory, "home"), 'embedded runtime must use the supplied home, not ~/.boxlang');
        const executed = await request({ action: "execute", code: 'answer = 40;\nanswer += 2; data = {values: [1, 2]}; println(answer);' });
        assert.strictEqual(executed.ok, true, executed.error);
        assert.strictEqual(executed.output, "42\n");
        const expression = await request({ action: "execute", code: "answer + 1" });
        assert.strictEqual(expression.result.value, "43");
        const variables = await request({ action: "inspect" });
        assert.strictEqual(variables.variables.find(value => value.name === "answer").value, "42");
        const nested = await request({ action: "inspect", path: ["data", "values"] });
        assert.deepStrictEqual(nested.variables.map(value => value.value), ["1", "2"]);

        await fs.mkdir(path.join(directory, "source"));
        await fs.writeFile(path.join(directory, "source", "helper.bxs"), "includedValue = 77;");
        const included = await request({ action: "execute", code: 'include "helper.bxs";', source: path.join(directory, "source", "unsaved.bxs") });
        assert.strictEqual(included.ok, true, included.error);
        assert.strictEqual((await request({ action: "inspect", path: ["includedValue"] })).variables[0].value, "77");

        const failed = await request({ action: "execute", code: 'answer++; throw(message="Expected failure");' });
        assert.strictEqual(failed.ok, false);
        assert.strictEqual((await request({ action: "inspect", path: ["answer"] })).variables[0].value, "43", "runtime failure must not execute code twice");
        assert.strictEqual((await request({ action: "execute", code: "answer + 1" })).result.value, "44", "session survives errors");
        assert.strictEqual((await request({ action: "inspect", path: ["doesNotExist"] })).ok, false);
        const output = await request({ action: "execute", code: 'println(repeatString("x", 70000));' });
        assert.ok(output.output.includes("[Output truncated]"));
        assert.strictEqual((await request({ action: "execute", code: 'people = queryNew("name", "varchar", [["Ada"]]);' })).ok, true);
        assert.strictEqual((await request({ action: "inspect", path: ["people", "1", "name"] })).variables[0].value, "Ada");
        const cyclic = await request({ action: "execute", code: "data.self = data;" });
        assert.strictEqual(cyclic.ok, true);
        assert.strictEqual((await request({ action: "inspect", path: ["data", "self"] })).ok, true);
        const array = await request({ action: "execute", code: "[{ nested: [1, 2] }]" });
        assert.strictEqual((await request({ action: "inspect", executionId: array.executionId, path: ["1", "nested", "2"] })).variables[0].value, "2");
        const point = await request({ action: "execute", code: 'createObject("java", "java.awt.Point").init(3, 4)' });
        assert.strictEqual(point.result.expandable, true);
        const fields = await request({ action: "inspect", executionId: point.executionId });
        assert.strictEqual(fields.variables.find(value => value.name === "x").value, "3");
        const bytes = await request({ action: "execute", code: 'createObject("java", "java.lang.String").init("abc").getBytes()' });
        assert.strictEqual((await request({ action: "inspect", executionId: bytes.executionId, path: ["1"] })).variables[0].value, "97");
        await fs.writeFile(path.join(directory, "Profile.bx"), 'class { this.name = "Ada"; variables.count = 2; function getName() { throw(message="Getter must not run"); } }');
        const object = await request({ action: "execute", code: "new Profile()" });
        assert.strictEqual(object.ok, true, object.error);
        assert.strictEqual((await request({ action: "inspect", executionId: object.executionId, path: ["this", "name"] })).variables[0].value, "Ada");
        assert.strictEqual((await request({ action: "inspect", executionId: object.executionId, path: ["variables", "count"] })).variables[0].value, "2");
        assert.strictEqual((await request({ action: "inspect", executionId: 999999 })).ok, false);
        console.log("REPL bridge smoke test passed: scopes, returned values, arrays/structs/queries, BoxLang objects, public Java fields, and existing session behavior.");
    } finally {
        clearTimeout(timeout);
        proc.kill("SIGKILL");
        reader.close();
        await new Promise<void>(resolve => { if (proc.exitCode !== null || proc.signalCode !== null) resolve(); else proc.once("close", () => resolve()); });
        await fs.rm(directory, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
