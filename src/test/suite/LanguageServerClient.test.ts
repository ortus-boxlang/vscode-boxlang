import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';

const Module = require('module');
const vscode = require('vscode');
const lspPath = require.resolve('../../utils/LanguageServer');
const clientLibrary = /[\\/]node_modules[\\/]vscode-(languageclient|languageserver-protocol|jsonrpc)[\\/]/;

suite('LanguageServer with the real language client', () => {
    let lsp: typeof import('../../utils/LanguageServer');
    let server: net.Server;
    let rpc: typeof import('vscode-jsonrpc/node');
    let connections: ReturnType<typeof rpc.createMessageConnection>[];
    let originalLibraryModules: Map<string, NodeModule>;
    let sockets: net.Socket[];
    let originalRequire: any;
    let originalLspModule: NodeModule | undefined;
    let originalPort: string | undefined;
    let originalApi: Map<string, any>;
    let initialize: () => Promise<any>;
    let initialized: Promise<void>;
    let notifyInitialized: () => void;
    let messages: sinon.SinonStub;
    let diagnostics: Set<object>;
    let channels: Set<object>;
    let tempDir: string;
    let managedProcesses: any[];

    setup(async () => {
        originalApi = new Map();
        lsp = undefined;
        originalLibraryModules = new Map(Object.entries(require.cache).filter(([file]) => clientLibrary.test(file)));
        for (const file of originalLibraryModules.keys()) { delete require.cache[file]; }
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-real-client-'));
        managedProcesses = [];
        diagnostics = new Set();
        channels = new Set();
        const output = vscode.window.createOutputChannel;
        sinon.stub(vscode.window, 'createOutputChannel').callsFake(() => {
            const channel = output();
            channel.dispose = () => channels.delete(channel);
            channels.add(channel);
            return channel;
        });
        const additions: Record<string, any> = {
            version: '1.99.0',
            env: { appName: 'test', language: 'en' },
            CodeActionKind: Object.fromEntries([
                ['Empty', ''], ['QuickFix', 'quickfix'], ['Refactor', 'refactor'],
                ['RefactorExtract', 'refactor.extract'], ['RefactorInline', 'refactor.inline'],
                ['RefactorRewrite', 'refactor.rewrite'], ['Source', 'source'],
                ['SourceOrganizeImports', 'source.organizeImports']
            ].map(([name, value]) => [name, { value }])),
            languages: { createDiagnosticCollection: () => {
                const collection = { dispose() { diagnostics.delete(collection); }, clear() {} };
                diagnostics.add(collection);
                return collection;
            } },
            workspace: {
                ...vscode.workspace,
                textDocuments: [],
                onDidOpenTextDocument: () => ({ dispose() {} }),
                onDidChangeTextDocument: () => ({ dispose() {} }),
                onDidCloseTextDocument: () => ({ dispose() {} }),
                onDidChangeConfiguration: () => ({ dispose() {} })
            }
        };
        for (const name of ['CodeLens', 'DocumentLink', 'CodeAction', 'SymbolInformation', 'CallHierarchyItem',
            'TypeHierarchyItem', 'Diagnostic', 'InlayHint', 'CancellationError']) {
            additions[name] = class {};
        }
        for (const [key, value] of Object.entries(additions)) {
            originalApi.set(key, vscode[key]);
            vscode[key] = value;
        }
        messages = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        connections = [];
        sockets = [];
        initialized = new Promise(resolve => { notifyInitialized = resolve; });
        initialize = () => new Promise(() => {});
        server = net.createServer(socket => {
            sockets.push(socket);
            const connection = rpc.createMessageConnection(new rpc.StreamMessageReader(socket), new rpc.StreamMessageWriter(socket));
            connections.push(connection);
            connection.onRequest('initialize', () => {
                notifyInitialized();
                return initialize();
            });
            connection.onRequest('shutdown', () => null);
            connection.onNotification('exit', () => socket.end());
            connection.onClose(() => connection.dispose());
            connection.listen();
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        originalPort = process.env.BOXLANG_LSP_PORT;
        process.env.BOXLANG_LSP_PORT = String((server.address() as net.AddressInfo).port);

        // Bypass other suites' global LanguageClient mock. Only VS Code and
        // unused JVM/download dependencies are mocked; transport and client are real.
        let realClient: typeof import('vscode-languageclient/node');
        originalRequire = Module.prototype.require;
        originalLspModule = require.cache[lspPath];
        Module.prototype.require = function (id: string) {
            // Other suites intercept any import ending in /main, including the
            // libraries' own entry points. Keep this dependency graph unmocked.
            if (id !== 'vscode' && clientLibrary.test(this.filename)) {
                return Module._load(id, this, false);
            }
            if (this.filename === lspPath) {
                if (id === 'vscode-languageclient/node') { return realClient; }
                if (id === '../context') {
                    return { getExtensionContext: () => ({ globalStorageUri: { fsPath: tempDir }, storageUri: { fsPath: tempDir } }) };
                }
                if (id === './BoxLang') {
                    return { startLSPProcess: async () => {
                        const index = managedProcesses.length;
                        const proc = Object.assign(new EventEmitter(), {
                            pid: 2147000000 + index, exitCode: null, signalCode: null,
                            kill(signal = 'SIGTERM') {
                                this.signalCode = signal;
                                proc.emit('exit', null, signal);
                                proc.emit('close');
                                sockets[index]?.destroy();
                                return true;
                            }
                        });
                        managedProcesses.push(proc);
                        return [proc, (server.address() as net.AddressInfo).port];
                    } };
                }
                if (id === './versionManager') { return { ensureBoxLangVersion: async () => '/mock/runtime.jar' }; }
                if (['./CommandBox', './ModuleManager'].includes(id)) { return {}; }
            }
            return originalRequire.apply(this, arguments);
        };
        rpc = Module._load(require.resolve('vscode-jsonrpc/node'), module, false);
        realClient = Module._load(require.resolve('vscode-languageclient/node'), module, false);
        delete require.cache[lspPath];
        lsp = Module._load(lspPath, module, false);
    });

    teardown(async () => {
        sockets?.forEach(socket => socket.destroy());
        connections?.forEach(connection => connection.dispose());
        if (lsp) { await lsp.shutdown('test cleanup'); }
        if (server) { await new Promise<void>(resolve => server.close(() => resolve())); }
        if (originalRequire) { Module.prototype.require = originalRequire; }
        if (originalLspModule) { require.cache[lspPath] = originalLspModule; } else { delete require.cache[lspPath]; }
        for (const file of Object.keys(require.cache)) {
            if (clientLibrary.test(file)) { delete require.cache[file]; }
        }
        for (const [file, savedModule] of originalLibraryModules) { require.cache[file] = savedModule; }
        if (originalPort === undefined) { delete process.env.BOXLANG_LSP_PORT; } else { process.env.BOXLANG_LSP_PORT = originalPort; }
        for (const [key, value] of originalApi) {
            if (value === undefined) { delete vscode[key]; } else { vscode[key] = value; }
        }
        sinon.restore();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    test('post-connect initialization failures consume exactly three recovery launches', async () => {
        delete process.env.BOXLANG_LSP_PORT;
        const config = require('../../utils/Configuration').ExtensionConfig;
        sinon.stub(config, 'boxlangLSPVersion').get(() => 'test-lsp');
        sinon.stub(config, 'boxLangLSPBoxLangVersion').get(() => 'test-runtime');
        sinon.stub(config, 'boxlangLSPBoxLangHome').get(() => path.join(tempDir, 'home'));
        sinon.stub(config, 'boxlangLSPModules').get(() => '');
        const moduleDir = path.join(tempDir, 'lspVersions', 'test-lsp');
        await fs.mkdir(moduleDir, { recursive: true });
        await fs.writeFile(path.join(moduleDir, 'box.json'), '{}');
        initialize = async () => ({ capabilities: {} });
        await lsp.startLSP();
        const initialChannels = channels.size;
        let failedInitializations = 0;
        initialize = async () => {
            failedInitializations++;
            throw new rpc.ResponseError(-32001, 'Test initialization failure');
        };
        const realSetTimeout = global.setTimeout;
        sinon.stub(global, 'setTimeout').callsFake(((callback, delay, ...args) =>
            realSetTimeout(callback, delay === 5000 ? 100 : delay, ...args)) as typeof setTimeout);
        const exhausted = new Promise<void>(resolve => {
            messages.callsFake(async (_message, ...actions) => {
                if (actions.includes('Restart LSP')) { resolve(); }
            });
        });
        managedProcesses[0].exitCode = 1;
        managedProcesses[0].emit('exit', 1, null);
        sockets[0].destroy();
        await exhausted;

        assert.strictEqual(failedInitializations, 3);
        assert.strictEqual(managedProcesses.length, 4);
        assert.strictEqual(diagnostics.size, 0);
        assert.strictEqual(channels.size, initialChannels);
        await assert.rejects(fs.access(path.join(tempDir, 'managed-lsp.pid')), { code: 'ENOENT' });
    });

    test('repeated pre-connection failures release diagnostics and do not accumulate output channels', async () => {
        const initialChannels = channels.size;
        process.env.BOXLANG_LSP_PORT = 'invalid';
        for (let attempt = 0; attempt < 3; attempt++) {
            await assert.rejects(lsp.startLSP(), /Invalid BOXLANG_LSP_PORT/);
            assert.strictEqual(diagnostics.size, 0, 'failed client retained a diagnostic collection');
            assert.strictEqual(channels.size, initialChannels, 'failed client retained an output channel');
        }
    });

    test('unexpected external disconnect is visible without restarting the external server', async () => {
        initialize = async () => ({ capabilities: {} });
        await lsp.startLSP();
        const notified = new Promise<void>(resolve => {
            messages.callsFake(async () => { resolve(); });
        });
        sockets[0].destroy();
        await notified;

        assert.match(messages.firstCall.args[0], /Connection to server got closed/);
        assert.strictEqual(sockets.length, 1);
        await lsp.shutdown('test cleanup');
        assert.strictEqual(diagnostics.size, 0);
    });

    test('cancellation rejects startup without leaking a library promise rejection', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (error: unknown) => { unhandled.push(error); };
        process.on('unhandledRejection', onUnhandled);
        try {
            const starting = lsp.startLSP().then(() => undefined, error => error);
            await Promise.race([initialized, starting.then(result => { throw result; })]);
            await lsp.shutdown('user shutdown');
            const result = await starting;
            await new Promise(resolve => setImmediate(resolve));
            assert.deepStrictEqual(unhandled, []);
            assert.ok(result instanceof Error, 'cancelled startup must reject');
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('intentional shutdown during initialization does not show a failure notification', async () => {
        const starting = lsp.startLSP().catch(error => error);
        await Promise.race([initialized, starting.then(result => { throw result; })]);
        await lsp.shutdown('user shutdown');
        await starting;

        assert.strictEqual(messages.callCount, 0, messages.getCalls().map(call => call.args[0]).join('\n'));
    });
});
