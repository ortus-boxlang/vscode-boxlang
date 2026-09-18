import * as assert from 'assert';
import * as sinon from 'sinon';

const Module = require('module');
const originalRequire = Module.prototype.require;
const loadModule = Module._load;

const outputLines: string[] = [];
let cleanupCallCount = 0;
let setupWorkspaceCallCount = 0;
const mockLsp = {
    LSP_DEACTIVATE_START_SETTLE_MS: 1000,
    requestRestart: async () => undefined,
    shutdown: async () => undefined,
    startLSP: () => Promise.resolve(undefined),
    notifyConfigurationChanged: () => undefined
};

function mainLifecycleRequireHook(this: { filename?: string }, id: string) {
    const requester = this?.filename || '';
    const fromMain = /[\\/]main\./.test(requester);

    if (fromMain && (id.endsWith('/utils/LanguageServer') || id === './utils/LanguageServer')) {
        return mockLsp;
    }

    if (fromMain && (id.endsWith('/utils/ProcessTracker') || id === './utils/ProcessTracker')) {
        return {
            cleanupTrackedProcesses: () => {
                cleanupCallCount += 1;
            }
        };
    }

    if (fromMain && (id.endsWith('/utils/workspaceSetup') || id === './utils/workspaceSetup')) {
        return {
            setupWorkspace: async () => {
                setupWorkspaceCallCount += 1;
            }
        };
    }

    if (fromMain && (id.endsWith('/utils/OutputChannels') || id === './utils/OutputChannels')) {
        return {
            boxlangOutputChannel: {
                appendLine(message: string) {
                    outputLines.push(String(message));
                }
            }
        };
    }

    if (fromMain && (id.endsWith('/views/ServerHomesView') || id === './views/ServerHomesView')) {
        return { boxlangServerHomeTreeDataProvider: () => ({}) };
    }

    return originalRequire.apply(this, arguments);
}

function installMainLifecycleRequireHook() {
    Module.prototype.require = mainLifecycleRequireHook;
}

function loadMainModule() {
    installMainLifecycleRequireHook();
    delete require.cache[require.resolve('../../main')];
    return loadModule('../../main', module, false);
}

installMainLifecycleRequireHook();

suite('Main lifecycle test suite', () => {
    setup(() => {
        cleanupCallCount = 0;
        setupWorkspaceCallCount = 0;
        outputLines.length = 0;
        mockLsp.requestRestart = async () => undefined;
        mockLsp.shutdown = async () => undefined;
        mockLsp.startLSP = () => Promise.resolve(undefined);
        mockLsp.notifyConfigurationChanged = () => undefined;
        installMainLifecycleRequireHook();
        delete require.cache[require.resolve('../../main')];
    });

    teardown(() => {
        Module.prototype.require = originalRequire;
        delete require.cache[require.resolve('../../main')];
        sinon.restore();
    });

    test('restartAllProcesses delegates restart scheduling to LanguageServer after cleanup', async () => {
        const requestRestartStub = sinon.stub().resolves();

        mockLsp.requestRestart = requestRestartStub;

        const main = loadMainModule();
        await main.restartAllProcesses('test restart');

        assert.strictEqual(cleanupCallCount, 1);
        assert.strictEqual(requestRestartStub.callCount, 1);
        assert.deepStrictEqual(requestRestartStub.firstCall.args, ['test restart']);
        assert.strictEqual(setupWorkspaceCallCount, 0);
    });

    test('deactivate delegates shutdown to LanguageServer and cleans up tracked processes', async () => {
        const shutdownStub = sinon.stub().resolves();

        mockLsp.shutdown = shutdownStub;

        const main = loadMainModule();
        await main.deactivate();

        assert.strictEqual(cleanupCallCount, 1);
        assert.strictEqual(shutdownStub.callCount, 1);
        // Deactivation must not wait long for a language server that is still starting.
        assert.deepStrictEqual(shutdownStub.firstCall.args, ['deactivate()', { startSettleTimeoutMs: 1000 }]);
    });
});