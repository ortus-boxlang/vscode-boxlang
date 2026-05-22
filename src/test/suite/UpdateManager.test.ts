import * as assert from 'assert';
import * as sinon from 'sinon';

const vscode = require('vscode');
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockBvmrcVersion: string | null = null;
const outputLines: string[] = [];
const stateStore = new Map<string, unknown>();

const mockExtensionContext = {
    globalStorageUri: { fsPath: '/mock/global-storage' },
    globalState: {
        get<T>(key: string, defaultValue: T): T {
            return (stateStore.has(key) ? stateStore.get(key) : defaultValue) as T;
        },
        async update(key: string, value: unknown): Promise<void> {
            stateStore.set(key, value);
        }
    }
};

const mockExtensionConfig = {
    boxlangRuntimeVersionUpdateMode: 'manual' as 'auto' | 'prompt' | 'manual',
    boxlangMiniServerVersionUpdateMode: 'manual' as 'auto' | 'prompt' | 'manual',
    boxlangLSPVersionUpdateMode: 'auto' as 'auto' | 'prompt' | 'manual',
    boxlangDebuggerVersionUpdateMode: 'manual' as 'auto' | 'prompt' | 'manual',
    boxlangUpdatesPreRelease: false,
    boxlangVersion: '1.13.0-snapshot',
    boxlangMiniServerJarPath: '/mock/boxlang-miniserver-1.0.0.jar',
    boxlangLSPVersion: 'bx-lsp@1.9.0+8',
    boxlangDebuggerModuleVersion: '1.0.0-snapshot',
    boxlangDebuggerModuleName: 'bx-debugger',
    async updateBoxlangLSPVersion(_versionSpec: string): Promise<void> {
        return;
    }
};

const mockLSP = {
    async restart(): Promise<void> {
        return;
    }
};

let mockLatestMetadata = {
    latestVersion: { version: '1.10.0+9' },
    versions: [{ version: '1.9.0+8' }]
};

class MockForgeBoxClient {
    async getModuleMetadata(moduleName: string) {
        if (moduleName === 'bx-lsp') {
            return mockLatestMetadata;
        }

        return {
            latestVersion: { version: '1.0.0-snapshot' },
            versions: [{ version: '1.0.0-snapshot' }]
        };
    }
}

function compareBoxLangLspVersionsDescending(current: string, latest: string): number {
    const currentParts = current.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
    const latestParts = latest.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
    const maxLength = Math.max(currentParts.length, latestParts.length);

    for (let index = 0; index < maxLength; index++) {
        const currentPart = currentParts[index] ?? 0;
        const latestPart = latestParts[index] ?? 0;

        if (currentPart === latestPart) {
            continue;
        }

        return currentPart < latestPart ? 1 : -1;
    }

    return 0;
}

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

Module.prototype.require = function (id: string) {
    const requester = this?.filename || '';
    const fromUpdateManager = /[\\/]utils[\\/]UpdateManager\./.test(requester);

    if (fromUpdateManager && (id.endsWith('/Configuration') || id === './Configuration')) {
        return {
            ExtensionConfig: mockExtensionConfig,
            getBvmrcVersion: () => mockBvmrcVersion
        };
    }

    if (fromUpdateManager && (id.endsWith('/ForgeBoxClient') || id === './ForgeBoxClient')) {
        return { ForgeBoxClient: MockForgeBoxClient };
    }

    if (fromUpdateManager && (id.endsWith('/LanguageServer') || id === './LanguageServer')) {
        return mockLSP;
    }

    if (fromUpdateManager && (id.endsWith('/OutputChannels') || id === './OutputChannels')) {
        return {
            boxlangOutputChannel: {
                appendLine(message: string) {
                    outputLines.push(String(message));
                }
            }
        };
    }

    if (fromUpdateManager && (id.endsWith('/DownloadManager') || id === './DownloadManager')) {
        return {
            DownloadManager: {
                listS3MiniServerVersions: async () => [],
                downloadMiniServer: async () => undefined
            }
        };
    }

    if (fromUpdateManager && (id.endsWith('/versionManager') || id === './versionManager')) {
        return {
            getAvailableBoxLangVerions: async () => []
        };
    }

    if (fromUpdateManager && (id.endsWith('/context') || id === '../context')) {
        return {
            getExtensionContext: () => mockExtensionContext
        };
    }

    if (fromUpdateManager && (id.endsWith('/selectLSPVersion') || id === '../commands/lsp/selectLSPVersion')) {
        return { compareBoxLangLspVersionsDescending };
    }

    return originalRequire.apply(this, arguments);
};

delete require.cache[require.resolve('../../utils/UpdateManager')];
const { checkAllUpdates } = require('../../utils/UpdateManager');

suite('UpdateManager Test Suite', () => {
    setup(() => {
        outputLines.length = 0;
        stateStore.clear();
        mockBvmrcVersion = null;
        delete process.env.BOXLANG_LSP_PORT;
        mockLatestMetadata = {
            latestVersion: { version: '1.10.0+9' },
            versions: [{ version: '1.9.0+8' }]
        };

        mockExtensionConfig.boxlangRuntimeVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangMiniServerVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'auto';
        mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangUpdatesPreRelease = false;
        mockExtensionConfig.boxlangLSPVersion = 'bx-lsp@1.9.0+8';
    });

    teardown(() => {
        delete process.env.BOXLANG_LSP_PORT;
        sinon.restore();
    });

    test('checkAllUpdates should persist the new LSP version before restarting in auto mode', async () => {
        const order: string[] = [];
        const persistDeferred = createDeferred<void>();
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
        const restartStub = sinon.stub(mockLSP, 'restart');

        persistStub.callsFake(async (versionSpec: string) => {
            order.push(`persist:${versionSpec}:start`);
            await persistDeferred.promise;
            order.push(`persist:${versionSpec}:done`);
        });
        restartStub.callsFake(async () => {
            order.push('restart');
        });

        const updatePromise = checkAllUpdates(true);

        await new Promise<void>(resolve => setImmediate(resolve));

        assert.strictEqual(persistStub.calledOnceWithExactly('bx-lsp@1.10.0+9'), true);
        assert.strictEqual(restartStub.called, false);

        persistDeferred.resolve();
        await updatePromise;

        assert.deepStrictEqual(order, [
            'persist:bx-lsp@1.10.0+9:start',
            'persist:bx-lsp@1.10.0+9:done',
            'restart'
        ]);
    });

    test('checkAllUpdates should update the configured LSP version without restarting when prompt mode selects next restart', async () => {
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'prompt';
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
        const restartStub = sinon.stub(mockLSP, 'restart');
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        let infoCallCount = 0;

        vscode.window.showInformationMessage = async () => {
            infoCallCount++;
            return 'Update on Next Restart';
        };

        try {
            await checkAllUpdates(true);
        } finally {
            vscode.window.showInformationMessage = originalShowInformationMessage;
        }

        assert.strictEqual(infoCallCount, 1);
        assert.strictEqual(persistStub.calledOnceWithExactly('bx-lsp@1.10.0+9'), true);
        assert.strictEqual(restartStub.called, false);
    });

    test('checkAllUpdates should retry the LSP update when restart fails and the user chooses Retry', async () => {
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
        const restartStub = sinon.stub(mockLSP, 'restart');
        const errorStub = sinon.stub(vscode.window, 'showErrorMessage');

        restartStub.onFirstCall().rejects(new Error('Stopping the server timed out'));
        restartStub.onSecondCall().resolves();
        errorStub.resolves('Retry');

        await checkAllUpdates(true);

        assert.strictEqual(persistStub.callCount, 2);
        assert.strictEqual(restartStub.callCount, 2);
        assert.strictEqual(errorStub.calledOnce, true);
    });

    test('checkAllUpdates should skip LSP updates when BOXLANG_LSP_PORT is set', async () => {
        process.env.BOXLANG_LSP_PORT = '7777';

        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
        const restartStub = sinon.stub(mockLSP, 'restart');

        await checkAllUpdates(true);

        assert.strictEqual(persistStub.called, false);
        assert.strictEqual(restartStub.called, false);
        assert.strictEqual(
            outputLines.includes('BoxLang UpdateManager: skipping LSP update check because BOXLANG_LSP_PORT is set'),
            true
        );
    });
});