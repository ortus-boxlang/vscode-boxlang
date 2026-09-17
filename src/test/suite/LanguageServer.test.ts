import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';

// Mock local dependencies that transitively need VS Code before importing them.
// The global vscode mock (loaded by runTestSimple.ts / runUnitTests.ts) handles 'vscode'.
const Module = require('module');
const originalRequire = Module.prototype.require;
let mockExtensionContext: any;
let fakeLspProcess: any;
let fakeLspPort = 0;
let lspStartError: Error | undefined;
let beforeLspBanner: ((signal?: AbortSignal) => Promise<void>) | undefined;

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

class MockLanguageClient {
    static instances: MockLanguageClient[] = [];
    static stopHandler: ((timeout: number) => Promise<void>) | undefined;
    static initializeHandler: ((transport: any) => Promise<void>) | undefined;

    readonly serverOptions: any;
    readonly clientOptions: any;
    state = 1;
    stopTimeout: number | undefined;
    disposed = false;
    startPromise: Promise<void> = Promise.resolve();
    transport: any;

    constructor(_id: string, _name: string, serverOptions: any, clientOptions?: any) {
        this.serverOptions = serverOptions;
        this.clientOptions = clientOptions;
        MockLanguageClient.instances.push(this);
    }

    start() {
        this.state = 3;
        this.startPromise = Promise.resolve().then(async () => {
            if (this.serverOptions) {
                this.transport = await this.serverOptions();
            }

            await MockLanguageClient.initializeHandler?.(this.transport);
            this.state = 2;
        });

        return this.startPromise;
    }

    stop(timeout = 2000) {
        if (this.state === 1) {
            return Promise.resolve();
        }

        if (this.state === 3) {
            return Promise.reject(new Error("Client is not running and can't be stopped. It's current state is: starting"));
        }

        this.stopTimeout = timeout;
        return Promise.resolve(
            MockLanguageClient.stopHandler ? MockLanguageClient.stopHandler(timeout) : Promise.resolve()
        ).then(() => {
            this.destroyTransport();
            this.state = 1;
        }).catch(error => {
            this.destroyTransport();
            this.state = 1;
            throw error;
        });
    }

    dispose() {
        this.disposed = true;
        this.destroyTransport();

        return this.stop();
    }

    destroyTransport() {
        this.transport?.reader?.destroy?.();
        if (this.transport?.writer && this.transport.writer !== this.transport.reader) {
            this.transport.writer.destroy?.();
        }
    }

    sendNotification() {
        return undefined;
    }
}

class FakeChildProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    pid = 4242;
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    killed = false;
    killSignals: NodeJS.Signals[] = [];

    kill(signal?: NodeJS.Signals) {
        const normalizedSignal = signal ?? 'SIGTERM';
        this.killSignals.push(normalizedSignal);
        this.killed = true;
        this.signalCode = normalizedSignal;
        this.exitCode = 0;
        this.emit('exit', 0, normalizedSignal);
        this.emit('close', 0, normalizedSignal);
        return true;
    }
}

Module.prototype.require = function (id: string) {
    const requester = this?.filename || '';
    const fromLanguageServer = /[\\/]utils[\\/]LanguageServer\./.test(requester);

    if (id.endsWith('/Java') || id.endsWith('\\Java') || id === './Java') {
        return { getJavaInstallDir: () => '/mock/java' };
    }
    if (id === 'vscode-languageclient/node') {
        return {
            LanguageClient: MockLanguageClient,
            ServerOptions: class { },
            ErrorAction: {
                Continue: 1,
                Shutdown: 2
            },
            CloseAction: {
                DoNotRestart: 1,
                Restart: 2
            }
        };
    }
    if (id.endsWith('/entities/component') || id === './entities/component') {
        return {
            COMPONENT_EXT: '.cfc',
            COMPONENT_FILE_GLOB: '**/*.cfc'
        };
    }
    if (fromLanguageServer && (id.endsWith('/context') || id === '../context')) {
        return { getExtensionContext: () => mockExtensionContext };
    }
    if (fromLanguageServer && (id.endsWith('/BoxLang') || id === './BoxLang')) {
        return {
            startLSPProcess: async (_home, _modules, _runtime, _timeout, signal?: AbortSignal) => {
                await beforeLspBanner?.(signal);
                if (lspStartError) {
                    throw lspStartError;
                }
                if (fakeLspProcess?.exitCode !== null) {
                    fakeLspProcess = new FakeChildProcess();
                }
                return [fakeLspProcess, fakeLspPort];
            }
        };
    }
    if (fromLanguageServer && (id.endsWith('/versionManager') || id === './versionManager')) {
        return { ensureBoxLangVersion: async () => '/mock/boxlang.jar' };
    }
    if (fromLanguageServer && (id.endsWith('/main') || id === './main')) {
        return { extensionContext: {}, CFML_LANGUAGE_ID: 'cfml', BL_LANGUAGE_ID: 'boxlang' };
    }
    return originalRequire.apply(this, arguments);
};

const { ExtensionConfig } = require('../../utils/Configuration');
const { getLSPServerConfig, requestRestart, shutdown, startLSP, stop } = require('../../utils/LanguageServer');
const { CloseAction, ErrorAction } = require('vscode-languageclient/node');

suite('LanguageServer Test Suite', () => {
    let tempDir: string;
    let lspServer: net.Server;
    let processKillStub: sinon.SinonStub;

    async function setupManagedLspEnvironment() {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-language-server-'));
        const globalStoragePath = path.join(tempDir, 'globalStorage');
        const workspaceStoragePath = path.join(tempDir, 'workspaceStorage');
        const versionSpec = 'bx-lsp@1.9.0+8';
        const lspModuleDir = path.join(globalStoragePath, 'lspVersions', versionSpec, 'bx-lsp');
        const lspHome = path.join(tempDir, 'lsp-home');

        await fs.mkdir(lspModuleDir, { recursive: true });
        await fs.writeFile(path.join(lspModuleDir, 'box.json'), JSON.stringify({ boxlang: { minimumVersion: '1.13.0-snapshot' } }));

        mockExtensionContext = {
            globalStorageUri: { fsPath: globalStoragePath },
            storageUri: { fsPath: workspaceStoragePath }
        };

        lspServer = net.createServer((socket) => {
            socket.on('error', () => undefined);
        });

        await new Promise<void>((resolve) => lspServer.listen(0, '127.0.0.1', () => resolve()));
        fakeLspPort = (lspServer.address() as net.AddressInfo).port;
        fakeLspProcess = new FakeChildProcess();

        sinon.stub(ExtensionConfig, 'boxlangLSPVersion').get(() => versionSpec);
        sinon.stub(ExtensionConfig, 'boxlangLSPBoxLangHome').get(() => lspHome);
        sinon.stub(ExtensionConfig, 'boxLangLSPBoxLangVersion').get(() => '1.13.0-snapshot');
        sinon.stub(ExtensionConfig, 'boxlangLSPModules').get(() => '');

        return { globalStoragePath, workspaceStoragePath };
    }

    setup(() => {
        MockLanguageClient.instances.length = 0;
        lspStartError = undefined;
        beforeLspBanner = undefined;
        MockLanguageClient.stopHandler = undefined;
        MockLanguageClient.initializeHandler = undefined;
        sinon.stub(ExtensionConfig, 'boxlangJavaExecutable').get(() => 'java');
        sinon.stub(ExtensionConfig, 'boxlangMaxHeapSize').get(() => 512);
        sinon.stub(ExtensionConfig, 'boxlangLSPJVMArgs').get(() => '');
        processKillStub = sinon.stub(process, 'kill').callThrough();
        processKillStub.withArgs(4242, 0).throws(Object.assign(new Error('mock process not found'), { code: 'ESRCH' }));
        processKillStub.withArgs(4242).returns(true);
    });

    teardown(async () => {
        try {
            await stop();
        } catch {
            // ignore cleanup errors from tests that intentionally break shutdown
        }

        delete process.env.BOXLANG_LSP_PORT;

        if (lspServer) {
            await new Promise<void>((resolve) => lspServer.close(() => resolve()));
        }

        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }

        mockExtensionContext = undefined;
        fakeLspProcess = undefined;
        fakeLspPort = 0;
        sinon.restore();
    });

    test('getLSPServerConfig should reject when LSP version is not configured', async () => {
        sinon.stub(ExtensionConfig, 'boxlangLSPVersion').get(() => undefined);

        const serverOptions = getLSPServerConfig();

        await assert.rejects(
            serverOptions(),
            /boxlang\.lsp\.lspVersion is not configured/
        );
    });

    test('getLSPServerConfig should throw InvalidLSPInstallationError when LSP version is not configured', async () => {
        sinon.stub(ExtensionConfig, 'boxlangLSPVersion').get(() => undefined);

        const serverOptions = getLSPServerConfig();

        await assert.rejects(
            serverOptions(),
            (err: any) => err.name === 'InvalidLSPInstallationError' && /boxlang\.lsp\.lspVersion is not configured/.test(err.message)
        );
    });

    test('startLSP should not terminate a managed LSP owned by another workspace', async () => {
        const { globalStoragePath, workspaceStoragePath } = await setupManagedLspEnvironment();
        await fs.mkdir(globalStoragePath, { recursive: true });
        await fs.writeFile(path.join(globalStoragePath, 'managed-lsp.pid'), '4242');
        processKillStub.withArgs(4242, 0).returns(true);

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        sinon.assert.neverCalledWith(processKillStub, 4242, 0);
        sinon.assert.neverCalledWith(processKillStub, 4242);
        assert.strictEqual(
            await fs.readFile(path.join(workspaceStoragePath, 'managed-lsp.pid'), 'utf8'),
            String(fakeLspProcess.pid)
        );
    });

    test('failed startup with an invalid port terminates the process and removes its PID file', async () => {
        const { workspaceStoragePath } = await setupManagedLspEnvironment();
        fakeLspPort = 70000;

        await assert.rejects(startLSP(), /invalid port/);

        assert.strictEqual(fakeLspProcess.killed, true);
        await assert.rejects(fs.access(path.join(workspaceStoragePath, 'managed-lsp.pid')), { code: 'ENOENT' });
    });

    test('stop should force-kill the LSP process when client shutdown times out', async () => {
        await setupManagedLspEnvironment();

        MockLanguageClient.stopHandler = async () => {
            throw new Error('Stopping the server timed out');
        };

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        await stop();

        assert.strictEqual(MockLanguageClient.instances[0].stopTimeout, 10000);
        assert.deepStrictEqual(fakeLspProcess.killSignals, ['SIGTERM']);
        assert.strictEqual(MockLanguageClient.instances[0].disposed, false);
    });

    test('requestRestart orders stop, other-process cleanup, delay, then start', async () => {
        await setupManagedLspEnvironment();
        await startLSP();
        const events: string[] = [];
        const stopping = createDeferred<void>();
        const finishStop = createDeferred<void>();
        const cleaned = createDeferred<void>();
        MockLanguageClient.stopHandler = async () => {
            events.push('stopping');
            stopping.resolve();
            await finishStop.promise;
            fakeLspProcess.kill();
            events.push('stopped');
        };
        const restarting = requestRestart('test restart', 25, () => {
            events.push('cleanup');
            assert.strictEqual(MockLanguageClient.instances.length, 1);
            cleaned.resolve();
        });
        await stopping.promise;
        assert.deepStrictEqual(events, ['stopping']);
        finishStop.resolve();
        await cleaned.promise;
        assert.deepStrictEqual(events, ['stopping', 'stopped', 'cleanup']);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(MockLanguageClient.instances.length, 1, 'restart delay must precede client creation');
        await restarting;
        assert.strictEqual(MockLanguageClient.instances.length, 2);
    });

    for (const action of ['shutdown', 'restart']) {
        test(`${action} cancels JVM startup before the port banner`, async () => {
            await setupManagedLspEnvironment();
            const launched = createDeferred<void>();
            const banner = createDeferred<void>();
            const startingProcess = fakeLspProcess;
            beforeLspBanner = signal => {
                signal?.addEventListener('abort', () => {
                    startingProcess.kill('SIGKILL');
                    banner.reject(signal.reason);
                }, { once: true });
                launched.resolve();
                return banner.promise;
            };
            const initialStart = startLSP().then(() => undefined, error => error);
            await launched.promise;
            beforeLspBanner = undefined;
            const interruption = action === 'shutdown' ? shutdown('test') : requestRestart('test', 0);
            let timeout: ReturnType<typeof setTimeout>;
            try {
                await Promise.race([
                    interruption,
                    new Promise((_resolve, reject) => {
                        timeout = setTimeout(() => reject(new Error('Lifecycle still waiting for port banner')), 500);
                    })
                ]);
                assert.match((await initialStart).message, /aborted/);
                assert.strictEqual(startingProcess.killed, true);
                assert.strictEqual(MockLanguageClient.instances.length, action === 'shutdown' ? 1 : 2);
            } finally {
                clearTimeout(timeout);
                banner.reject(new Error('test cleanup'));
                await initialStart;
                await interruption;
            }
        });

        test(`${action} interrupts a server that connects but never finishes initialization`, async () => {
            await setupManagedLspEnvironment();
            const connected = createDeferred<void>();
            MockLanguageClient.initializeHandler = transport => new Promise((_resolve, reject) => {
                transport.reader.once('close', () => reject(new Error('Initialization connection closed')));
                connected.resolve();
            });

            const initialStart = startLSP().then(() => undefined, error => error);
            await connected.promise;
            const startingClient = MockLanguageClient.instances[0];
            const startingProcess = fakeLspProcess;
            MockLanguageClient.initializeHandler = undefined;
            const interruption = action === 'shutdown' ? shutdown('test') : requestRestart('test', 0);
            let timeout: ReturnType<typeof setTimeout>;

            try {
                await Promise.race([
                    interruption,
                    new Promise((_resolve, reject) => {
                        timeout = setTimeout(() => reject(new Error('Lifecycle blocked by initialization')), 500);
                    })
                ]);
                assert.match((await initialStart).message, /Initialization connection closed/);
                assert.strictEqual(startingProcess.killed, true);
                assert.strictEqual(MockLanguageClient.instances.length, action === 'shutdown' ? 1 : 2);
            } finally {
                clearTimeout(timeout);
                startingClient.destroyTransport();
                await initialStart;
                await interruption;
            }
        });
    }

    test('cancelling during connection backoff stops immediately without another attempt', async () => {
        await setupManagedLspEnvironment();
        await new Promise<void>(resolve => lspServer.close(() => resolve()));
        const cancellation = new AbortController();
        const connectionFailed = createDeferred<void>();
        let attempts = 0;
        const options = getLSPServerConfig(socket => {
            attempts++;
            socket.once('error', () => connectionFailed.resolve());
        }, undefined, cancellation.signal);
        const connecting = options().then(() => undefined, error => error);
        await connectionFailed.promise;
        await new Promise(resolve => setTimeout(resolve, 10)); // first retry is now waiting 100ms
        cancellation.abort();
        let timeout: ReturnType<typeof setTimeout>;
        try {
            const error = await Promise.race([
                connecting,
                new Promise((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('Cancellation waited for retry backoff')), 50);
                })
            ]);
            assert.match(error.message, /aborted/);
            assert.strictEqual(attempts, 1);
        } finally {
            clearTimeout(timeout);
            fakeLspProcess.kill();
            await connecting;
        }
    });

    test('startLSP should ignore duplicate starts while the client is still starting', async () => {
        await setupManagedLspEnvironment();

        const firstStart = startLSP();
        const secondStart = startLSP();
        const [firstClient, secondClient] = await Promise.all([firstStart, secondStart]);

        assert.strictEqual(secondClient, firstClient);
        await MockLanguageClient.instances[0].startPromise;
        assert.strictEqual(MockLanguageClient.instances.length, 1);
    });

    test('startLSP should not create an extra client while a restart is stopping', async () => {
        await setupManagedLspEnvironment();

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        const stopDeferred = createDeferred<void>();
        MockLanguageClient.stopHandler = async () => stopDeferred.promise;

        const restartPromise = requestRestart('test restart', 0);
        await Promise.resolve();

        const startPromise = startLSP('startup signal during restart');
        await Promise.resolve();

        assert.strictEqual(MockLanguageClient.instances.length, 1);

        stopDeferred.resolve();
        fakeLspProcess.exitCode = 0;
        fakeLspProcess.signalCode = 'SIGTERM';
        fakeLspProcess.emit('exit', 0, 'SIGTERM');
        fakeLspProcess.emit('close', 0, 'SIGTERM');

        await restartPromise;
        await startPromise;
        await MockLanguageClient.instances[1].startPromise;

        assert.strictEqual(MockLanguageClient.instances.length, 2);
    });

    test('shutdown should cancel a pending delayed restart', async () => {
        await setupManagedLspEnvironment();

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        const clock = sinon.useFakeTimers();

        try {
            MockLanguageClient.stopHandler = async () => {
                fakeLspProcess.exitCode = 0;
                fakeLspProcess.signalCode = 'SIGTERM';
            };

            const restartPromise = requestRestart('test restart');

            await Promise.resolve();
            await Promise.resolve();

            const shutdownPromise = shutdown('test shutdown');

            await restartPromise;
            await shutdownPromise;
            await clock.tickAsync(5000);

            assert.strictEqual(MockLanguageClient.instances.length, 1);
        } finally {
            clock.restore();
        }
    });

    test('stop should disconnect from an externally managed LSP without sending shutdown', async () => {
        lspServer = net.createServer((socket) => {
            socket.on('error', () => undefined);
        });

        await new Promise<void>((resolve) => lspServer.listen(0, '127.0.0.1', () => resolve()));
        const port = (lspServer.address() as net.AddressInfo).port;

        process.env.BOXLANG_LSP_PORT = String(port);

        let stopCallCount = 0;
        MockLanguageClient.stopHandler = async () => {
            stopCallCount += 1;
        };

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        await stop();

        assert.strictEqual(stopCallCount, 0);
        assert.strictEqual(MockLanguageClient.instances[0].stopTimeout, undefined);
        assert.strictEqual(MockLanguageClient.instances[0].disposed, false);
    });

    test('stop should not reject for an externally managed LSP that is still starting', async () => {
        lspServer = net.createServer((socket) => {
            socket.on('error', () => undefined);
        });

        await new Promise<void>((resolve) => lspServer.listen(0, '127.0.0.1', () => resolve()));
        const port = (lspServer.address() as net.AddressInfo).port;

        process.env.BOXLANG_LSP_PORT = String(port);
        const connected = createDeferred<void>();
        MockLanguageClient.initializeHandler = transport => new Promise((_resolve, reject) => {
            transport.reader.once('close', () => reject(new Error('Initialization connection closed')));
            connected.resolve();
        });
        const initialStart = startLSP().then(() => undefined, error => error);
        await connected.promise;

        await assert.doesNotReject(stop());
        assert.match((await initialStart).message, /Initialization connection closed/);
        assert.strictEqual(MockLanguageClient.instances[0].stopTimeout, undefined);
    });

    test('stop should mark managed LSP connection errors as intentionally handled', async () => {
        await setupManagedLspEnvironment();

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        const errorHandler = MockLanguageClient.instances[0].clientOptions?.errorHandler;
        assert.ok(errorHandler);

        const stopPromise = stop();

        assert.deepStrictEqual(await errorHandler.error(new Error('write after end')), { action: ErrorAction.Continue, handled: true });
        assert.deepStrictEqual(await errorHandler.closed(), { action: CloseAction.DoNotRestart, handled: true });

        await stopPromise;
    });

    test('failed recovery launches use the three-attempt budget and then offer crash actions', async () => {
        await setupManagedLspEnvironment();
        await startLSP();

        const realSetTimeout = global.setTimeout;
        sinon.stub(global, 'setTimeout').callsFake(((callback, delay, ...args) =>
            realSetTimeout(callback, delay === 5000 ? 0 : delay, ...args)) as typeof setTimeout);
        const prompted = createDeferred<void>();
        const showError = sinon.stub(require('vscode').window, 'showErrorMessage').callsFake(async () => {
            prompted.resolve();
            return undefined;
        });
        lspStartError = new Error('Recovery JVM failed before opening port');
        const crashedClient = MockLanguageClient.instances[0];
        fakeLspProcess.exitCode = 1;
        fakeLspProcess.emit('exit', 1, null);
        crashedClient.destroyTransport();
        crashedClient.state = 1;
        crashedClient.clientOptions.errorHandler.closed();
        let timeout: ReturnType<typeof setTimeout>;

        try {
            await Promise.race([
                prompted.promise,
                new Promise((_resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('Recovery stopped without offering crash actions')), 500);
                })
            ]);
            assert.strictEqual(MockLanguageClient.instances.length, 4, 'initial start plus three recovery launches');
            assert.deepStrictEqual(showError.firstCall.args.slice(1), ['Restart LSP', 'Show Output']);
        } finally {
            clearTimeout(timeout);
            await shutdown('test cleanup');
        }
    });

    test('startLSP should disable automatic restart for externally managed LSP connections', async () => {
        lspServer = net.createServer((socket) => {
            socket.on('error', () => undefined);
        });

        await new Promise<void>((resolve) => lspServer.listen(0, '127.0.0.1', () => resolve()));
        const port = (lspServer.address() as net.AddressInfo).port;

        process.env.BOXLANG_LSP_PORT = String(port);

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        const errorHandler = MockLanguageClient.instances[0].clientOptions?.errorHandler;

        assert.ok(errorHandler);
        assert.deepStrictEqual(await errorHandler.error(new Error('socket reset')), { action: ErrorAction.Continue, handled: true });
        assert.deepStrictEqual(await errorHandler.closed(), { action: CloseAction.DoNotRestart, handled: false });
    });
});
