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
            this.state = 1;
        }).catch(error => {
            this.state = 1;
            throw error;
        });
    }

    dispose() {
        this.disposed = true;
        this.transport?.reader?.destroy?.();
        if (this.transport?.writer && this.transport.writer !== this.transport.reader) {
            this.transport.writer.destroy?.();
        }

        return this.stop();
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
        return { startLSPProcess: async () => [fakeLspProcess, fakeLspPort] };
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

    async function setupManagedLspEnvironment() {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-language-server-'));
        const globalStoragePath = path.join(tempDir, 'globalStorage');
        const versionSpec = 'bx-lsp@1.9.0+8';
        const lspModuleDir = path.join(globalStoragePath, 'lspVersions', versionSpec, 'bx-lsp');
        const lspHome = path.join(tempDir, 'lsp-home');

        await fs.mkdir(lspModuleDir, { recursive: true });
        await fs.writeFile(path.join(lspModuleDir, 'box.json'), JSON.stringify({ boxlang: { minimumVersion: '1.13.0-snapshot' } }));

        mockExtensionContext = {
            globalStorageUri: { fsPath: globalStoragePath }
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
    }

    setup(() => {
        MockLanguageClient.instances.length = 0;
        MockLanguageClient.stopHandler = undefined;
        sinon.stub(ExtensionConfig, 'boxlangJavaExecutable').get(() => 'java');
        sinon.stub(ExtensionConfig, 'boxlangMaxHeapSize').get(() => 512);
        sinon.stub(ExtensionConfig, 'boxlangLSPJVMArgs').get(() => '');
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

    test('stop should force-kill the LSP process when client shutdown times out', async () => {
        await setupManagedLspEnvironment();

        MockLanguageClient.stopHandler = async () => {
            throw new Error('Stopping the server timed out');
        };

        startLSP();
        await MockLanguageClient.instances[0].startPromise;

        await stop();

        assert.strictEqual(MockLanguageClient.instances[0].stopTimeout, 10000);
        assert.deepStrictEqual(fakeLspProcess.killSignals, ['SIGTERM']);
        assert.strictEqual(MockLanguageClient.instances[0].disposed, true);
    });

    test('requestRestart should wait for stop and the configured delay before starting again', async () => {
        await setupManagedLspEnvironment();

        startLSP();
        await MockLanguageClient.instances[0].startPromise;

        const clock = sinon.useFakeTimers();
        const stopDeferred = createDeferred<void>();

        try {
            MockLanguageClient.stopHandler = async () => stopDeferred.promise;

            const restartPromise = requestRestart('test restart');

            await Promise.resolve();
            await clock.tickAsync(5000);
            assert.strictEqual(MockLanguageClient.instances.length, 1);

            stopDeferred.resolve();
            fakeLspProcess.exitCode = 0;
            fakeLspProcess.signalCode = 'SIGTERM';

            await Promise.resolve();
            await clock.tickAsync(4999);
            assert.strictEqual(MockLanguageClient.instances.length, 1);

            await clock.tickAsync(1);
            await restartPromise;
            await MockLanguageClient.instances[1].startPromise;

            assert.strictEqual(MockLanguageClient.instances.length, 2);
        } finally {
            clock.restore();
        }
    });

    test('shutdown should cancel a pending delayed restart', async () => {
        await setupManagedLspEnvironment();

        startLSP();
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

        startLSP();
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

        startLSP();

        await assert.doesNotReject(stop());
    });

    test('startLSP should disable automatic restart for externally managed LSP connections', async () => {
        lspServer = net.createServer((socket) => {
            socket.on('error', () => undefined);
        });

        await new Promise<void>((resolve) => lspServer.listen(0, '127.0.0.1', () => resolve()));
        const port = (lspServer.address() as net.AddressInfo).port;

        process.env.BOXLANG_LSP_PORT = String(port);

        startLSP();
        await MockLanguageClient.instances[0].startPromise;

        const errorHandler = MockLanguageClient.instances[0].clientOptions?.errorHandler;

        assert.ok(errorHandler);
        assert.deepStrictEqual(await errorHandler.error(new Error('socket reset')), { action: ErrorAction.Continue });
        assert.deepStrictEqual(await errorHandler.closed(), { action: CloseAction.DoNotRestart });
    });
});
