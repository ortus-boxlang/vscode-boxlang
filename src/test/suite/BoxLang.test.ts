import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as sinon from 'sinon';

// Use the global vscode mock loaded by runTestSimple.ts / runUnitTests.ts.
// We only need to mock ProcessTracker here so we can simulate child process
// events without actually spawning anything.
const Module = require('module');
const originalRequire = Module.prototype.require;

// Track mock processes created by tests
let lastMockProcess: any = null;
let lastSpawnOptions: any = null;

function createMockProcess() {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.pid = 12345 + Math.floor(Math.random() * 1000);
    mockProcess.killed = false;
    mockProcess.exitCode = null;
    mockProcess.signalCode = null;
    mockProcess.kill = () => {
        mockProcess.killed = true;
        mockProcess.exitCode = 0;
        return true;
    };
    lastMockProcess = mockProcess;
    return mockProcess;
}

Module.prototype.require = function (id: string) {
    if (id.endsWith('/ProcessTracker') || id === './ProcessTracker') {
        return {
            trackedSpawn: (...args: any[]) => {
                lastSpawnOptions = args[2];
                const proc = createMockProcess();
                // Model Node's native spawn({ signal, killSignal }) support.
                lastSpawnOptions.signal?.addEventListener('abort', () => {
                    proc.kill(lastSpawnOptions.killSignal);
                    proc.emit('error', lastSpawnOptions.signal.reason);
                }, { once: true });
                return proc;
            },
            cleanupTrackedProcesses: () => { }
        };
    }
    return originalRequire.apply(this, arguments);
};

const ConfigurationModule = require('../../utils/Configuration');
const { ExtensionConfig } = ConfigurationModule;

// Force re-evaluation so our ProcessTracker intercept below is used
// (LanguageServer.test.ts may have loaded BoxLang.js before our intercept was active)
delete require.cache[require.resolve('../../utils/BoxLang')];
const { startLSPProcess, BoxLangWithHome, BoxLang } = require('../../utils/BoxLang');



suite('BoxLang LSP Process Test Suite', () => {
    setup(() => {
        lastSpawnOptions = null;
        sinon.stub(ExtensionConfig, 'boxlangJavaExecutable').get(() => 'java');
        sinon.stub(ExtensionConfig, 'boxlangMaxHeapSize').get(() => 512);
        sinon.stub(ExtensionConfig, 'boxlangLSPJVMArgs').get(() => '');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should reject when child process exits before printing port', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.emit('exit', 1);
        }, 10);

        await assert.rejects(
            promise,
            /LSP process exited with code 1 before opening port/
        );
    });

    test('should reject when child process errors before printing port', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.emit('error', new Error('spawn ENOENT'));
        }, 10);

        await assert.rejects(
            promise,
            /LSP process failed to start: spawn ENOENT/
        );
    });

    test('should resolve when child process prints listening port', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.stdout.emit('data', 'Listening on port: 8080\n');
        }, 10);

        const result = await promise;
        assert.strictEqual(result[0], lastMockProcess);
        assert.strictEqual(result[1], '8080');
    });

    test('should find the listening port when the banner is written to stderr', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.stderr.emit('data', 'Listening on port: 8081\n');
        }, 10);

        const result = await promise;
        assert.strictEqual(result[1], '8081');
    });

    test('should reject when javaExecutable is not configured', async () => {
        // Restore default stubs from setup() and use a local sandbox for this test
        sinon.restore();
        const localSandbox = sinon.createSandbox();
        localSandbox.stub(ExtensionConfig, 'boxlangJavaExecutable').get(() => undefined);
        localSandbox.stub(ExtensionConfig, 'boxlangMaxHeapSize').get(() => 512);
        localSandbox.stub(ExtensionConfig, 'boxlangLSPJVMArgs').get(() => '');

        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        await assert.rejects(
            promise,
            /Java executable not found.*boxlang\.java\.javaHome/
        );

        localSandbox.restore();
    });

    test('should clean up event listeners after resolving', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.stdout.emit('data', 'Listening on port: 8080\n');
        }, 10);

        const [proc] = await promise;
        // After resolve, the persistent crash-monitoring listeners remain active so
        // that unexpected LSP crashes produce diagnostic output.  There must be
        // exactly 1 listener per event (the persistent one); the startup listener
        // must have been removed.
        assert.strictEqual(proc.stdout.listenerCount('data'), 1, 'stdout should have 1 persistent data listener');
        assert.strictEqual(proc.stderr.listenerCount('data'), 1, 'stderr should have 1 persistent data listener');
        assert.strictEqual(proc.listenerCount('error'), 1, 'should have 1 persistent error listener');
        assert.strictEqual(proc.listenerCount('exit'), 1, 'should have 1 persistent exit listener');
        assert.strictEqual(proc.listenerCount('close'), 1, 'should have 1 persistent close listener');
    });

    test('should clean up event listeners after rejecting on exit', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.emit('exit', 1);
        }, 10);

        await assert.rejects(
            promise,
            /LSP process exited with code 1 before opening port/
        );

        assert.strictEqual(lastMockProcess.stdout.listenerCount('data'), 0, 'stdout data listener should be removed');
        assert.strictEqual(lastMockProcess.stderr.listenerCount('data'), 0, 'stderr data listener should be removed');
        assert.strictEqual(lastMockProcess.listenerCount('error'), 0, 'error listener should be removed');
        assert.strictEqual(lastMockProcess.listenerCount('exit'), 0, 'exit listener should be removed');
        assert.strictEqual(lastMockProcess.listenerCount('close'), 0, 'close listener should be removed');
    });

    test('should preserve the host environment for the LSP process', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.stdout.emit('data', 'Listening on port: 8080\\n');
        }, 10);

        await promise;
        assert.strictEqual(lastSpawnOptions.env.PATH, process.env.PATH);
        assert.strictEqual(lastSpawnOptions.env.BOXLANG_HOME, '/mock/home');
        assert.strictEqual(lastSpawnOptions.env.CLASSPATH, '/mock/boxlang.jar');
    });

    test('should terminate the process when startup times out', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar', 100);

        await assert.rejects(
            promise,
            /LSP process failed to start within 100ms/
        );

        assert.strictEqual(lastMockProcess.stdout.listenerCount('data'), 0, 'stdout data listener should be removed');
        assert.strictEqual(lastMockProcess.stderr.listenerCount('data'), 0, 'stderr data listener should be removed');
        assert.strictEqual(lastMockProcess.listenerCount('error'), 0, 'error listener should be removed');
        assert.strictEqual(lastMockProcess.listenerCount('exit'), 0, 'exit listener should be removed');
        assert.strictEqual(lastMockProcess.listenerCount('close'), 0, 'close listener should be removed');
        assert.strictEqual(lastMockProcess.killed, true);
    });

    test('cancelling before the port banner terminates startup without waiting for its timeout', async () => {
        const cancellation = new AbortController();
        const startup = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar', 50, cancellation.signal);
        cancellation.abort();

        await assert.rejects(startup, /aborted/);
        assert.strictEqual(lastMockProcess.killed, true);
    });

    test('startup timeout kills a process that ignores SIGTERM', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar', 10);
        lastMockProcess.kill = (signal: NodeJS.Signals) => {
            if (signal === 'SIGKILL') {
                lastMockProcess.signalCode = signal;
                lastMockProcess.emit('exit', null, signal);
            }
            return true;
        };

        await assert.rejects(promise, /failed to start within 10ms/);
        assert.strictEqual(lastMockProcess.signalCode, 'SIGKILL');
    });

    test('should still find port after large output if port is within last 100KB', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        // Emit 150KB of garbage, then port message in the last chunk
        const garbage = 'x'.repeat(150 * 1024);
        setTimeout(() => {
            lastMockProcess.stdout.emit('data', garbage);
        }, 10);

        setTimeout(() => {
            lastMockProcess.stdout.emit('data', 'Listening on port: 9090\n');
        }, 20);

        const result = await promise;
        assert.strictEqual(result[0], lastMockProcess);
        assert.strictEqual(result[1], '9090');
    });

    test('BoxLangWithHome.startLSP should reject when javaExecutable is not configured', async () => {
        sinon.restore();
        const localSandbox = sinon.createSandbox();
        localSandbox.stub(ExtensionConfig, 'boxlangJavaExecutable').get(() => undefined);
        localSandbox.stub(ExtensionConfig, 'boxlangMaxHeapSize').get(() => 512);
        localSandbox.stub(ExtensionConfig, 'boxlangLSPJVMArgs').get(() => '');

        const boxLangWithHome = new BoxLangWithHome('/mock/home');
        const promise = boxLangWithHome.startLSP();

        await assert.rejects(
            promise,
            /Java executable not found.*boxlang\.java\.javaHome/
        );

        localSandbox.restore();
    });

    test('BoxLang.startLSP should reject when javaExecutable is not configured', async () => {
        sinon.restore();
        const localSandbox = sinon.createSandbox();
        localSandbox.stub(ExtensionConfig, 'boxlangJavaExecutable').get(() => undefined);
        localSandbox.stub(ExtensionConfig, 'boxlangMaxHeapSize').get(() => 512);
        localSandbox.stub(ExtensionConfig, 'boxlangLSPJVMArgs').get(() => '');

        const promise = BoxLang.startLSP();

        await assert.rejects(
            promise,
            /Java executable not found.*boxlang\.java\.javaHome/
        );

        localSandbox.restore();
    });
});
