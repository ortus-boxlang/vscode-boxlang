import * as assert from 'assert';
import * as sinon from 'sinon';

const Module = require('module');
const originalRequire = Module.prototype.require;

const outputLines: string[] = [];
let cleanupCallCount = 0;
let setupWorkspaceCallCount = 0;
const mockLsp = {
    requestRestart: async () => undefined,
    shutdown: async () => undefined,
    startLSP: () => undefined,
    notifyConfigurationChanged: () => undefined
};

function installMainRequireHook() {
    Module.prototype.require = function (id: string) {
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

        if (fromMain && (id.endsWith('/views/ServerView') || id === './views/ServerView')) {
            return { boxlangServerTreeDataProvider: () => ({}) };
        }

        if (fromMain && id.startsWith('./')) {
            return {};
        }

        return originalRequire.apply(this, arguments);
    };
}

function loadMainModule() {
    return Module._load(require.resolve('../../main'), module, false);
}

suite('Main lifecycle test suite', () => {
    setup(() => {
        cleanupCallCount = 0;
        setupWorkspaceCallCount = 0;
        outputLines.length = 0;
        mockLsp.requestRestart = async () => undefined;
        mockLsp.shutdown = async () => undefined;
        mockLsp.startLSP = () => undefined;
        mockLsp.notifyConfigurationChanged = () => undefined;
        installMainRequireHook();
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
        assert.deepStrictEqual(shutdownStub.firstCall.args, ['deactivate()']);
    });
});