import assert from "assert";
import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { pathToFileURL } from "url";

/** Opt-in real DOM check using an already-installed Chromium, no browser package/download. */
async function main() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "boxlang-repl-panel-"));
    try {
        const source = await fs.readFile("src/repl/index.ts", "utf8");
        let html = /panel\.webview\.html = `([\s\S]*?)`;/.exec(source)?.[1];
        assert.ok(html, "panel template should exist");
        // A file:// fixture is not a VS Code webview; CSP enforcement requires the real extension host.
        html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, "")
            .replace(/\$\{nonce\}/g, "test")
            .replace("${styles}", pathToFileURL(path.resolve("resources/repl/session.css")).href)
            .replace("${script}", pathToFileURL(path.resolve("resources/repl/session.js")).href)
            .replace("<head>", `<head><script>
window.sent = [];
window.acquireVsCodeApi = () => ({getState: () => ({draft: 'my draft'}), setState() {}, postMessage(message) { sent.push(message); }});
</script>`);
        html = html.replace("</body>", `<script>
const result = document.createElement('pre'); result.id = 'repl-test-result';
try {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const send = data => window.dispatchEvent(new MessageEvent('message', {data}));
    const input = document.getElementById('code');
    const timeline = document.getElementById('history');
    const execution = {kind: 'execution', id: 1, code: 'answer = 41;', state: 'Queued'};
    send({kind: 'history', executions: []});
    send(execution);
    const original = timeline.querySelector('article');
    send({...execution, state: 'Running'});
    send({...execution, state: 'Completed', durationMs: 5, response: {ok: true, output: '41'}});
    check(timeline.querySelectorAll('article').length === 1, 'state updates must not duplicate entries');
    check(timeline.querySelector('article') === original, 'updates must preserve existing DOM nodes');
    check(original.dataset.state === 'Completed', 'completion must update the existing entry');
    check(input.value === 'my draft', 'execution updates must preserve the draft');
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', altKey: true}));
    check(input.value === 'answer = 41;', 'history navigation must recall code');
    send({...execution, state: 'Failed', response: {ok: false, error: '<img src=x onerror=alert(1)>'}});
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', altKey: true}));
    check(input.value === 'my draft', 'navigation must restore draft after a live execution update');
    check(original.querySelector('.error').textContent.includes('<img'), 'errors must appear on their execution');
    check(!original.querySelector('img'), 'runtime text must not become HTML');
    Array.from(original.querySelectorAll('button')).find(button => button.textContent === 'Run again').click();
    check(sent.at(-1).kind === 'rerun' && sent.at(-1).id === 1, 'rerun must reference the original source-aware execution');
    document.getElementById('variables').click();
    check(sent.at(-1).kind === 'variables', 'variables action must focus the native view');
    input.value = 'println(answer);';
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true}));
    check(sent.at(-1).kind === 'execute' && sent.at(-1).code === 'println(answer);', 'keyboard execution must submit code');
    check(input.value === '', 'submission must leave a fresh prompt');
    send({...execution, id: 2, state: 'Completed', response: {ok: true, result: {name: 'result', type: 'UnmodifiableStruct', value: '{10 entries}', expandable: true}}});
    const returned = timeline.lastElementChild.querySelector('details');
    returned.open = true; returned.dispatchEvent(new Event('toggle'));
    const rootRequest = sent.at(-1);
    check(rootRequest.kind === 'inspectResult' && rootRequest.executionId === 2 && rootRequest.path.length === 0, 'returned values must be lazily explorable');
    send({kind: 'resultChildren', id: rootRequest.id, ok: true, variables: [{name: 'nested', type: 'Array', value: '[2 items]', expandable: true}]});
    const nested = returned.querySelector('details');
    nested.open = true; nested.dispatchEvent(new Event('toggle'));
    const nestedRequest = sent.at(-1);
    check(nestedRequest.path.join('.') === 'nested', 'nested expansion must inspect members, not rerun code');
    send({kind: 'resultChildren', id: nestedRequest.id, ok: true, variables: [{name: '1', type: 'String', value: '<img src=x>', expandable: false}]});
    check(nested.textContent.includes('<img src=x>') && !nested.querySelector('img'), 'nested previews must remain text, not HTML');
    for (let id = 3; id <= 110; id++) send({...execution, id, state: 'Completed', response: {ok: true, output: 'done'}});
    check(timeline.querySelectorAll('article').length === 100, 'history must stay bounded');
    timeline.scrollTop = 0;
    send({...execution, id: 110, state: 'Failed', response: {ok: false, error: 'changed'}});
    check(timeline.scrollTop === 0, 'updates must not yank a reader to the bottom');
    send({kind: 'history', executions: []});
    send({...execution, id: 111});
    check(!document.getElementById('empty'), 'new execution must replace the empty hint');
    result.textContent = 'PASS';
} catch (error) { result.textContent = 'FAIL: ' + error.message; }
document.body.appendChild(result);
</script></body>`);
        const fixture = path.join(directory, "panel.html");
        await fs.writeFile(fixture, html);
        const { stdout } = await promisify(execFile)(process.env.BOXLANG_REPL_TEST_BROWSER || "chromium", [
            "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--user-data-dir=${path.join(directory, "profile")}`, "--virtual-time-budget=1000", "--dump-dom", pathToFileURL(fixture).href
        ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        assert.ok(stdout.includes('<pre id="repl-test-result">PASS</pre>'), /<pre id="repl-test-result">([^<]*)<\/pre>/.exec(stdout)?.[1] || "Browser check did not finish");
        console.log("REPL panel smoke test passed: stable execution entries, keyboard history, safe output, rerun, native-view action, and scrolling.");
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
