# BoxLang REPL session POC

Run the extension in VS Code's Extension Development Host, then use **BoxLang: Open REPL Session (POC)** from the command palette. In a BoxLang script editor, right-click **Run Selection in REPL Session** or **Run File in REPL Session**. File execution uses the editor contents, including unsaved edits.

Run `answer = 41;`, then `answer += 1;`, and click **Variables** to open the native **REPL Variables** tree in the BoxLang sidebar. The tree always shows `variables`, `server`, and `request` scopes plus the last non-null result, so expressions such as `server.java` remain explorable even without assigning a variable. Expand structs, arrays, query rows, or stored object fields; the tree preserves expansion across executions. Hover for types/previews, refresh or collapse all from the view toolbar, and right-click to copy a value preview or inspection path. The same session is available to Copilot through `#executeBoxLangREPL` and `#inspectBoxLangREPL` (enable those tools in the chat tool picker). Both execution and inspection request approval. Inspection does not start a session. Normal editor/panel execution is an explicit user action and does not show a second confirmation.

The console shows a single entry for each execution as it moves from queued to running to completed/failed. **Use code** edits a previous command; **Run again** retains the original file path for relative includes. Ctrl/Cmd+Enter submits code; Alt+Up/Down navigates history and restores your draft. Output follows new results only when you are already near the bottom. **Clear output** leaves variables untouched. Expand returned structures directly inside execution cards, without rerunning code. Copilot can inspect a chosen scope or use the execution ID returned by the execution tool to inspect a result.

## Runtime

`BoxLangSession.java` is launched with Java 21's source-file launcher and the configured BoxLang runtime JAR. It requires a JDK, not a JRE. The extension's downloaded Java installation is a JDK. No runtime changes, additional library, or separate Java build are required.

The process uses the configured BoxLang home and the first workspace folder as its working directory. Home modules and runtime configuration remain in effect. This is a scratch scripting context, not an attached application/request context; it does not load the workspace's application descriptor. Closing the panel preserves the session; closing the VS Code window, Stop, or Reset discards it. Runtime/home changes take effect on the next session start.

## POC limits

- Requires a desktop or remote Node.js extension host; no browser-only runtime execution.
- One session per extension host/workspace window; no notebooks, templates, CFML, or application attachment.
- Scope/result browsing supports structs, BoxLang/Java arrays, query rows, BoxLang objects (`this` and `variables` scopes), and public Java instance fields. User-defined getters are not evaluated. Private Java fields and static members are not exposed.
- First 100 children per level, 2 KB scalar previews, 64 KB captured output per request; no paging.
- History retains 100 execution records in memory and survives closing/reopening the panel, but not a window reload. The runtime retains the last 100 result references for inspection; results expire on eviction or session restart. These are live references, not frozen snapshots.
- The native inspector is read-only and copies bounded previews. Dedicated query/table viewers and full-value retrieval are deferred.
- Execution is queued. A 30-second execution timeout or cancellation kills the process and discards state; there is no safe in-process interrupt yet.
- Errors can leave partial variable changes and filesystem/network side effects. Reset does not undo those side effects.
- Workspace trust is required. Code runs with the user's permissions, **not in a sandbox**. Variable inspection can disclose secrets, so Copilot inspection also requests approval.

## Checks

```sh
npm test
# Optional real DOM check, using an installed Chromium (or BOXLANG_REPL_TEST_BROWSER):
npm run test:repl-ui
BOXLANG_REPL_TEST_JAR=/path/to/boxlang.jar \
BOXLANG_REPL_TEST_JAVA=/path/to/jdk-21/bin/java npm run test:repl
```

The real-runtime smoke test uses a temporary BoxLang home and verifies persistence, multiline scripts, expression results, nested inspection, relative includes, error recovery, output limits, and cyclic values. Unit tests cover the shared queue, execution states/history, stop/cancellation/timeout, process failures, trust/input validation, and native tree refresh/expansion. The Chromium panel check covers stable DOM updates, keyboard history, safe output, rerun, and scroll preservation. Native tree rendering and approval prompts still need an Extension Development Host check.
