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

function createMockProcess() {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.pid = 12345 + Math.floor(Math.random() * 1000);
    mockProcess.killed = false;
    mockProcess.exitCode = null;
    lastMockProcess = mockProcess;
    return mockProcess;
}

Module.prototype.require = function(id: string) {
    if (id.endsWith('/ProcessTracker') || id === './ProcessTracker') {
        return {
            trackedSpawn: (...args: any[]) => {
                const proc = createMockProcess();
                return proc;
            },
            cleanupTrackedProcesses: () => {}
        };
    }
    return originalRequire.apply(this, arguments);
};

const ConfigurationModule = require('../../utils/Configuration');
const { ExtensionConfig } = ConfigurationModule;

// Force re-evaluation so our ProcessTracker intercept below is used
// (LanguageServer.test.ts may have loaded BoxLang.js before our intercept was active)
delete require.cache[require.resolve('../../utils/BoxLang')];
const { startLSPProcess } = require('../../utils/BoxLang');



suite('BoxLang LSP Process Test Suite', () => {
    setup(() => {
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
});
