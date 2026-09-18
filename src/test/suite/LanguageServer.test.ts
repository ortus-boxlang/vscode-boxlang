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
let startLSPProcessImpl: (...args: any[]) => Promise<any[]>;
let ensureBoxLangVersionImpl: () => Promise<string>;

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

async function waitUntil(condition: () => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;

    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('waitUntil timed out');
        }

        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

class MockLanguageClient {
    static instances: MockLanguageClient[] = [];
    static stopHandler: ((timeout: number) => Promise<void>) | undefined;
    // When set, start() fails after the server options resolved, like a failed initialize request.
    static failAfterConnect: Error | undefined;
    // Runs right before failAfterConnect is thrown, so a test can change the process state first.
    static beforeFailAfterConnect: (() => void) | undefined;

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

            if (MockLanguageClient.failAfterConnect) {
                // The real client does not dispose the connection when initialize fails,
                // so the transport is left open on purpose here.
                MockLanguageClient.beforeFailAfterConnect?.();
                this.state = 1;
                throw MockLanguageClient.failAfterConnect;
            }

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
    // When true, kill() only records the signal and the test emits exit/close itself later.
    deferExit = false;

    kill(signal?: NodeJS.Signals) {
        const normalizedSignal = signal ?? 'SIGTERM';
        this.killSignals.push(normalizedSignal);
        this.killed = true;

        if (this.deferExit) {
            return true;
        }

        this.exitWith(normalizedSignal);
        return true;
    }

    exitWith(signal: NodeJS.Signals) {
        this.signalCode = signal;
        this.exitCode = 0;
        this.emit('exit', 0, signal);
        this.emit('close', 0, signal);
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
        return { startLSPProcess: (...args: any[]) => startLSPProcessImpl(...args) };
    }
    if (fromLanguageServer && (id.endsWith('/versionManager') || id === './versionManager')) {
        return { ensureBoxLangVersion: () => ensureBoxLangVersionImpl() };
    }
    if (fromLanguageServer && (id.endsWith('/main') || id === './main')) {
        return { extensionContext: {}, CFML_LANGUAGE_ID: 'cfml', BL_LANGUAGE_ID: 'boxlang' };
    }
    return originalRequire.apply(this, arguments);
};

const { ExtensionConfig } = require('../../utils/Configuration');
const { getLanguageClient, getLSPServerConfig, requestRestart, shutdown, startLSP, stop } = require('../../utils/LanguageServer');
const { CloseAction, ErrorAction } = require('vscode-languageclient/node');

suite('LanguageServer Test Suite', () => {
    let tempDir: string;
    let lspServer: net.Server;
    let processKillStub: sinon.SinonStub;
    const serverSockets = new Set<net.Socket>();

    async function startFakeLspServer() {
        lspServer = net.createServer((socket) => {
            socket.on('error', () => undefined);
            serverSockets.add(socket);
            socket.once('close', () => serverSockets.delete(socket));
        });

        await new Promise<void>((resolve) => lspServer.listen(0, '127.0.0.1', () => resolve()));
    }

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

        await startFakeLspServer();
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
        MockLanguageClient.stopHandler = undefined;
        MockLanguageClient.failAfterConnect = undefined;
        MockLanguageClient.beforeFailAfterConnect = undefined;
        startLSPProcessImpl = async (_home, _module, _jar, options) => {
            options?.onSpawn?.(fakeLspProcess);
            return [fakeLspProcess, fakeLspPort];
        };
        ensureBoxLangVersionImpl = async () => '/mock/boxlang.jar';
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
            // A failed start can leave a client socket open; server.close() would wait on it.
            serverSockets.forEach(socket => socket.destroy());
            serverSockets.clear();
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

    test('requestRestart should wait for stop and the configured delay before starting again', async () => {
        await setupManagedLspEnvironment();

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        const stopDeferred = createDeferred<void>();

        MockLanguageClient.stopHandler = async () => stopDeferred.promise;

        const restartPromise = requestRestart('test restart', 0);

        await Promise.resolve();
        assert.strictEqual(MockLanguageClient.instances.length, 1);

        stopDeferred.resolve();
        fakeLspProcess.exitCode = 0;
        fakeLspProcess.signalCode = 'SIGTERM';
        fakeLspProcess.emit('exit', 0, 'SIGTERM');
        fakeLspProcess.emit('close', 0, 'SIGTERM');

        await restartPromise;
        await MockLanguageClient.instances[1].startPromise;

        assert.strictEqual(MockLanguageClient.instances.length, 2);
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

    test('stop should wait for an in-flight start and then stop the LSP process it produced', async () => {
        await setupManagedLspEnvironment();

        // Hold the LSP process in its "booting" phase until the test releases it.
        const spawnRequested = createDeferred<void>();
        const spawnResult = createDeferred<any[]>();
        startLSPProcessImpl = () => {
            spawnRequested.resolve();
            return spawnResult.promise;
        };

        MockLanguageClient.stopHandler = async () => {
            fakeLspProcess.exitCode = 0;
            fakeLspProcess.emit('exit', 0, null);
            fakeLspProcess.emit('close', 0, null);
        };

        await startLSP();
        await spawnRequested.promise;

        let stopSettled = false;
        const stopPromise = stop().then(() => {
            stopSettled = true;
        });

        await new Promise(resolve => setTimeout(resolve, 20));
        assert.strictEqual(stopSettled, false, 'stop should wait while the LSP process is still starting');

        spawnResult.resolve([fakeLspProcess, fakeLspPort]);
        await stopPromise;

        assert.strictEqual(MockLanguageClient.instances[0].stopTimeout, 10000, 'client.stop should run once the client is running');
        assert.strictEqual(fakeLspProcess.exitCode, 0, 'the LSP process that finished booting should be stopped');
    });

    test('requestRestart during startup should not spawn a second LSP process while the first is still starting', async () => {
        await setupManagedLspEnvironment();

        const firstProcess = fakeLspProcess;
        const secondProcess = new FakeChildProcess();
        secondProcess.pid = 4343;
        let runningProcess = firstProcess;

        const spawnRequested = [createDeferred<void>(), createDeferred<void>()];
        const spawnResults = [createDeferred<any[]>(), createDeferred<any[]>()];
        let spawnCount = 0;
        let firstProcessExitedBeforeSecondSpawn: boolean | undefined;

        startLSPProcessImpl = () => {
            const index = spawnCount++;

            if (index === 1) {
                firstProcessExitedBeforeSecondSpawn = firstProcess.exitCode !== null;
            }

            spawnRequested[index].resolve();
            return spawnResults[index].promise;
        };

        MockLanguageClient.stopHandler = async () => {
            runningProcess.exitCode = 0;
            runningProcess.emit('exit', 0, null);
            runningProcess.emit('close', 0, null);
        };

        await startLSP();
        await spawnRequested[0].promise;

        const restartPromise = requestRestart('restart during startup', 0);
        await new Promise(resolve => setTimeout(resolve, 20));

        assert.strictEqual(spawnCount, 1, 'a second LSP process must not be spawned while the first is still starting');

        spawnResults[0].resolve([firstProcess, fakeLspPort]);
        await restartPromise;
        await spawnRequested[1].promise;

        runningProcess = secondProcess;
        spawnResults[1].resolve([secondProcess, fakeLspPort]);
        await MockLanguageClient.instances[1].startPromise;

        assert.strictEqual(spawnCount, 2);
        assert.strictEqual(firstProcessExitedBeforeSecondSpawn, true, 'the first LSP process should be stopped before the second one is spawned');
    });

    test('a failed client start should terminate the LSP process it already spawned', async () => {
        const { workspaceStoragePath } = await setupManagedLspEnvironment();
        MockLanguageClient.failAfterConnect = new Error('initialize failed');

        await startLSP();
        await MockLanguageClient.instances[0].startPromise.catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 20));

        assert.deepStrictEqual(fakeLspProcess.killSignals, ['SIGTERM']);
        await assert.rejects(fs.access(path.join(workspaceStoragePath, 'managed-lsp.pid')), 'the managed pid file should be removed');
    });

    test('a failed client start should remove the pid file even if the LSP process already died', async () => {
        const { workspaceStoragePath } = await setupManagedLspEnvironment();
        MockLanguageClient.failAfterConnect = new Error('initialize failed');

        // The process dies after opening its port but before the client gives up, so the crash
        // monitor has already cleared the global process reference by the time cleanup runs.
        MockLanguageClient.beforeFailAfterConnect = () => {
            fakeLspProcess.exitCode = 1;
            fakeLspProcess.emit('exit', 1, null);
            fakeLspProcess.emit('close', 1, null);
        };

        await startLSP();
        await MockLanguageClient.instances[0].startPromise.catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 20));

        assert.deepStrictEqual(fakeLspProcess.killSignals, [], 'an already-dead process should not be signalled');
        await assert.rejects(fs.access(path.join(workspaceStoragePath, 'managed-lsp.pid')), 'the managed pid file should be removed');
    });

    test('a failed client start should not report the cleanup kill as a crash', async () => {
        await setupManagedLspEnvironment();
        MockLanguageClient.failAfterConnect = new Error('initialize failed');

        await startLSP();
        await MockLanguageClient.instances[0].startPromise.catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 20));

        // The library keeps its connection open after a failed start, so killing the process
        // makes it call closed(). That must be treated as intentional, not as a crash.
        const errorHandler = MockLanguageClient.instances[0].clientOptions?.errorHandler;
        assert.ok(errorHandler);
        assert.deepStrictEqual(await errorHandler.closed(), { action: CloseAction.DoNotRestart, handled: true });
    });

    /**
     * A startLSPProcess mock for a process that has been spawned but never prints its port.
     * It rejects only when the process is killed, like the real helper does.
     */
    function bootingForeverProcess() {
        startLSPProcessImpl = (_home, _module, _jar, options) => {
            options?.onSpawn?.(fakeLspProcess);

            return new Promise<any[]>((_resolve, reject) => {
                fakeLspProcess.once('exit', () => reject(new Error('LSP process was terminated by SIGTERM before opening port')));
            });
        };
    }

    test('stop should stop waiting for a hung start after the given time and kill the process it spawned', async () => {
        const { workspaceStoragePath } = await setupManagedLspEnvironment();
        bootingForeverProcess();

        await startLSP();
        await waitUntil(() => fakeLspProcess.listenerCount('exit') > 0);

        const startedAt = Date.now();
        await stop({ startSettleTimeoutMs: 20 });

        assert.ok(Date.now() - startedAt < 1500, 'stop should not wait for the full startup timeout');
        assert.deepStrictEqual(fakeLspProcess.killSignals, ['SIGTERM'], 'the booting process should be killed');
        assert.strictEqual(getLanguageClient(), undefined);
        await assert.rejects(fs.access(path.join(workspaceStoragePath, 'managed-lsp.pid')), 'the pid file should be removed once the process is gone');
    });

    test('shutdown should not wait long for a start that is still booting', async function () {
        this.timeout(5000);
        await setupManagedLspEnvironment();
        bootingForeverProcess();

        await startLSP();
        await waitUntil(() => fakeLspProcess.listenerCount('exit') > 0);

        const startedAt = Date.now();
        await shutdown('test shutdown during boot');

        assert.ok(Date.now() - startedAt < 3000, 'shutdown should give up on the booting start quickly');
        assert.deepStrictEqual(fakeLspProcess.killSignals, ['SIGTERM']);
        assert.strictEqual(getLanguageClient(), undefined);
    });

    test('an abandoned start that finishes later should shut down the client and process it produced', async () => {
        const { workspaceStoragePath } = await setupManagedLspEnvironment();

        // From stop()'s point of view nothing has been spawned yet when it gives up.
        const spawnResult = createDeferred<any[]>();
        let spawnOptions: any;
        startLSPProcessImpl = (_home, _module, _jar, options) => {
            spawnOptions = options;
            return spawnResult.promise;
        };

        MockLanguageClient.stopHandler = async () => {
            fakeLspProcess.exitWith('SIGTERM');
        };

        await startLSP();
        await waitUntil(() => spawnOptions !== undefined);
        await stop({ startSettleTimeoutMs: 20 });

        assert.strictEqual(getLanguageClient(), undefined, 'stop should release the abandoned client');

        // Now the abandoned start finishes booting.
        spawnOptions.onSpawn(fakeLspProcess);
        spawnResult.resolve([fakeLspProcess, fakeLspPort]);
        await MockLanguageClient.instances[0].startPromise;
        await waitUntil(() => fakeLspProcess.exitCode !== null);
        // The pid file is removed right after the process exits; give that a moment.
        await new Promise(resolve => setTimeout(resolve, 50));

        assert.strictEqual(MockLanguageClient.instances[0].stopTimeout, 10000, 'the abandoned client should be stopped');
        await assert.rejects(fs.access(path.join(workspaceStoragePath, 'managed-lsp.pid')), 'the pid file should be removed');
    });

    test('an abandoned start should not spawn a process once it gets past the setup steps', async () => {
        await setupManagedLspEnvironment();

        // Hold the start in a setup step that runs before the process is spawned.
        const versionReady = createDeferred<string>();
        ensureBoxLangVersionImpl = () => versionReady.promise;

        let spawnCount = 0;
        startLSPProcessImpl = async (_home, _module, _jar, options) => {
            spawnCount++;
            options?.onSpawn?.(fakeLspProcess);
            return [fakeLspProcess, fakeLspPort];
        };

        await startLSP();
        await new Promise(resolve => setTimeout(resolve, 20));
        await stop({ startSettleTimeoutMs: 20 });

        versionReady.resolve('/mock/boxlang.jar');
        await MockLanguageClient.instances[0].startPromise.catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 20));

        assert.strictEqual(spawnCount, 0, 'an abandoned start must not spawn a process');
    });

    test('stop should fail and keep the pid file when the LSP process cannot be killed', async function () {
        this.timeout(8000);
        const { workspaceStoragePath } = await setupManagedLspEnvironment();
        // A process that ignores every signal.
        fakeLspProcess.deferExit = true;

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        await assert.rejects(stop(), /is still running after termination attempts/);

        assert.deepStrictEqual(fakeLspProcess.killSignals, ['SIGTERM', 'SIGKILL']);
        assert.strictEqual(
            await fs.readFile(path.join(workspaceStoragePath, 'managed-lsp.pid'), 'utf8'),
            String(fakeLspProcess.pid),
            'the pid file should be kept so the next start can retry the kill'
        );
    });

    test('requestRestart during a failed start should wait for the failed LSP process to exit before spawning again', async () => {
        await setupManagedLspEnvironment();
        MockLanguageClient.failAfterConnect = new Error('initialize failed');

        const firstProcess = fakeLspProcess;
        firstProcess.deferExit = true;
        const secondProcess = new FakeChildProcess();
        secondProcess.pid = 4343;

        let spawnCount = 0;
        let firstProcessExitedBeforeSecondSpawn: boolean | undefined;
        const secondSpawnRequested = createDeferred<void>();

        startLSPProcessImpl = async (_home, _module, _jar, options) => {
            const index = spawnCount++;

            if (index === 0) {
                options?.onSpawn?.(firstProcess);
                return [firstProcess, fakeLspPort];
            }

            firstProcessExitedBeforeSecondSpawn = firstProcess.exitCode !== null;
            secondSpawnRequested.resolve();
            // Let the second start succeed.
            MockLanguageClient.failAfterConnect = undefined;
            options?.onSpawn?.(secondProcess);
            return [secondProcess, fakeLspPort];
        };

        MockLanguageClient.stopHandler = async () => {
            secondProcess.exitWith('SIGTERM');
        };

        await startLSP();
        // The failed start is now killing the first process, but the process has not exited yet.
        await waitUntil(() => firstProcess.killed);

        const restartPromise = requestRestart('restart during failed start', 0);
        await new Promise(resolve => setTimeout(resolve, 20));

        assert.strictEqual(spawnCount, 1, 'a replacement must not be spawned while the failed LSP process is still being killed');

        firstProcess.exitWith('SIGTERM');
        await restartPromise;
        await secondSpawnRequested.promise;
        await MockLanguageClient.instances[1].startPromise;

        assert.strictEqual(spawnCount, 2);
        assert.strictEqual(firstProcessExitedBeforeSecondSpawn, true, 'the failed LSP process should be gone before the second one is spawned');
    });

    test('a failed external client start should close the socket it opened', async () => {
        await startFakeLspServer();
        const port = (lspServer.address() as net.AddressInfo).port;

        process.env.BOXLANG_LSP_PORT = String(port);
        MockLanguageClient.failAfterConnect = new Error('initialize failed');

        await startLSP();
        await MockLanguageClient.instances[0].startPromise.catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 20));

        const socket = MockLanguageClient.instances[0].transport.reader as net.Socket;
        assert.strictEqual(socket.destroyed, true, 'the external socket should be closed after the failed start');

        const errorHandler = MockLanguageClient.instances[0].clientOptions?.errorHandler;
        assert.ok(errorHandler);
        assert.deepStrictEqual(await errorHandler.closed(), { action: CloseAction.DoNotRestart, handled: true });

        await assert.doesNotReject(stop());
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
        await startFakeLspServer();
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
        await startFakeLspServer();
        const port = (lspServer.address() as net.AddressInfo).port;

        process.env.BOXLANG_LSP_PORT = String(port);

        await startLSP();

        await assert.doesNotReject(stop());
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

    test('startLSP should disable automatic restart for externally managed LSP connections', async () => {
        await startFakeLspServer();
        const port = (lspServer.address() as net.AddressInfo).port;

        process.env.BOXLANG_LSP_PORT = String(port);

        await startLSP();
        await MockLanguageClient.instances[0].startPromise;

        const errorHandler = MockLanguageClient.instances[0].clientOptions?.errorHandler;

        assert.ok(errorHandler);
        assert.deepStrictEqual(await errorHandler.error(new Error('socket reset')), { action: ErrorAction.Continue });
        assert.deepStrictEqual(await errorHandler.closed(), { action: CloseAction.DoNotRestart });
    });
});
