import * as assert from 'assert';
import { EventEmitter } from 'events';
import { PassThrough, Writable } from 'stream';
import * as sinon from 'sinon';

const vscode = require('vscode');
const Module = require('module');
const originalRequire = Module.prototype.require;
let spawned: FakeProcess[] = [];

class FakeProcess extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    requests: any[] = [];
    exitCode: number | null = null;
    signalCode: string | null = null;
    stdin = new Writable({ write: (chunk, _encoding, callback) => { this.requests.push(JSON.parse(String(chunk))); callback(); } });
    constructor() { super(); setImmediate(() => this.stdout.write('{"ready":true}\n')); }
    reply(value: object) { this.stdout.write(JSON.stringify({ id: this.requests[this.requests.length - 1].id, ok: true, output: '', ...value }) + '\n'); }
    kill() { this.exitCode = 0; setImmediate(() => { this.stdout.end(); this.stderr.end(); this.emit('close', 0, null); }); return true; }
}

// Isolate session dependencies without launching Java or touching runtime downloads.
Module.prototype.require = function(id: string) {
    if (/[\\/]repl[\\/]ReplSession\./.test(this.filename || '')) {
        if (id === '../utils/ProcessTracker') return { trackedSpawn: () => { const proc = new FakeProcess(); spawned.push(proc); return proc; } };
        if (id === '../utils/versionManager') return { getConfiguredBoxLangJarPath: async () => '/mock/runtime.jar' };
        if (id === '../utils/Configuration') return { ExtensionConfig: { boxLangHome: '/mock/home', boxlangJavaExecutable: 'java', boxlangJavaHome: '/mock/java' } };
        if (id === '../context') return { getExtensionContext: () => ({ extensionPath: '/mock/extension' }) };
    }
    return originalRequire.apply(this, arguments);
};
const sessionModulePath = require.resolve('../../repl/ReplSession');
const previousModule = require.cache[sessionModulePath];
delete require.cache[sessionModulePath];
const { ReplSession } = require('../../repl/ReplSession');
Module.prototype.require = originalRequire;
if (previousModule) require.cache[sessionModulePath] = previousModule;
else delete require.cache[sessionModulePath];

async function waitForRequests(count: number) {
    for (let attempt = 0; attempt < 100 && (spawned[0]?.requests.length ?? 0) < count; attempt++) {
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.strictEqual(spawned[0]?.requests.length, count);
    return spawned[0];
}

suite('Shared REPL session', () => {
    let session: any;
    let originalTrust: unknown;
    let originalFolders: unknown;
    setup(() => {
        originalTrust = vscode.workspace.isTrusted;
        originalFolders = vscode.workspace.workspaceFolders;
        vscode.workspace.isTrusted = true;
        vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/mock/workspace' } }];
        spawned = [];
        session = new ReplSession();
    });
    teardown(() => {
        session.dispose();
        vscode.workspace.isTrusted = originalTrust;
        vscode.workspace.workspaceFolders = originalFolders;
        sinon.restore();
    });

    test('UI and tool executions use one process and run sequentially', async () => {
        const events: any[] = [];
        session.onDidChange(event => { if ('id' in event) events.push(event); });
        const first = session.execute('answer = 41;');
        const second = session.execute('answer += 1;');
        assert.deepStrictEqual(session.executions.map(item => item.state), ['Queued', 'Queued']);
        const proc = await waitForRequests(1);
        assert.strictEqual(session.status, 'Running');
        proc.reply({ output: 'first' });
        assert.strictEqual((await first).output, 'first');
        await waitForRequests(2);
        assert.strictEqual(spawned.length, 1);
        proc.reply({ output: 'second' });
        assert.strictEqual((await second).output, 'second');
        assert.strictEqual(session.status, 'Ready');
        assert.deepStrictEqual(events.filter(event => event.id === 1).map(event => event.state), ['Queued', 'Running', 'Completed']);
        assert.deepStrictEqual(session.executions.map(item => item.state), ['Completed', 'Completed']);
        assert.ok(session.executions[0].durationMs >= 0);
    });

    test('stop rejects active and queued work without silently starting another session', async () => {
        const first = session.execute('sleep(10000);');
        const second = session.execute('answer = 42;');
        await waitForRequests(1);
        const failures = Promise.all([assert.rejects(first, /state discarded/), assert.rejects(second, /cancelled/)]);
        session.stop();
        await failures;
        assert.strictEqual(spawned.length, 1);
        assert.strictEqual(session.status, 'Stopped');
        await assert.rejects(session.inspect(), /No REPL session/);
    });

    test('cancelling a Copilot execution stops the shared session', async () => {
        let cancel: () => void;
        const token = { isCancellationRequested: false, onCancellationRequested: listener => { cancel = listener; return { dispose() {} }; } };
        const execution = session.execute('sleep(10000);', undefined, token);
        await waitForRequests(1);
        const failed = assert.rejects(execution, /Cancelled/);
        token.isCancellationRequested = true;
        cancel();
        await failed;
        assert.strictEqual(session.status, 'Stopped');
    });

    test('unexpected process exit rejects queued work rather than silently losing state', async () => {
        const first = session.execute('answer = 41;');
        const queued = session.execute('answer += 1;');
        const proc = await waitForRequests(1);
        const failures = Promise.all([assert.rejects(first, /REPL exited/), assert.rejects(queued, /cancelled/)]);
        proc.kill();
        await failures;
        assert.strictEqual(session.status, 'Failed');
        assert.strictEqual(spawned.length, 1);
    });

    test('errors remain attached to execution records and clearing output does not discard session state', async () => {
        const first = session.execute('throw(message="Oops");');
        const proc = await waitForRequests(1);
        proc.reply({ ok: false, error: 'Oops' });
        await first;
        assert.strictEqual(session.executions[0].state, 'Failed');
        assert.strictEqual(session.executions[0].response.error, 'Oops');
        const next = session.execute('answer = 42;');
        await waitForRequests(2);
        session.clearHistory();
        proc.reply({ result: { name: 'result', type: 'Integer', value: '42', expandable: false } });
        await next;
        assert.deepStrictEqual(session.executions, [], 'late completion must not resurrect cleared history');
        assert.strictEqual(session.status, 'Ready');
        assert.strictEqual(session.lastResult.executionId, 2);
        assert.strictEqual(spawned.length, 1, 'clear output must not restart the runtime');
        const inspected = session.inspect([], undefined, { executionId: 2 });
        await waitForRequests(3);
        assert.strictEqual(proc.requests[2].executionId, 2);
        assert.strictEqual(proc.requests[2].action, 'inspect');
        proc.reply({ variables: [] });
        await inspected;
        session.stop();
        assert.strictEqual(session.lastResult, undefined);
    });

    test('timeout stops execution and discards state', async () => {
        const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const execution = session.execute('while (true) {}');
        await waitForRequests(1);
        const failed = assert.rejects(execution, /Timed out/);
        await clock.tickAsync(30000);
        await failed;
        assert.strictEqual(session.status, 'Stopped');
        clock.restore();
    });

    test('rejects untrusted workspaces, empty code, and invalid inspection paths', async () => {
        vscode.workspace.isTrusted = false;
        await assert.rejects(session.execute('1 + 1'), /trusted workspace/);
        await assert.rejects(session.execute(' '), /non-empty/);
        assert.throws(() => session.inspect(['x'.repeat(2049)]), /variable path/);
        assert.throws(() => session.inspect([], undefined, { scope: 'invalid' }), /supported scope/);
        assert.throws(() => session.inspect([], undefined, { scope: 'server', executionId: 1 }), /not both/);
        assert.throws(() => session.inspect([], undefined, { executionId: 0 }), /positive execution ID/);
        assert.strictEqual(spawned.length, 0);
    });
});
