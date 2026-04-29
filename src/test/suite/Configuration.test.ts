import * as assert from 'assert';

const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];

const vscode = {
    ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
    },
    workspace: {
        workspaceFolders: [
            {
                uri: {
                    fsPath: '/workspace/project'
                }
            }
        ],
        getConfiguration: (section: string) => ({
            get: () => undefined,
            has: () => false,
            inspect: () => undefined,
            update: (key: string, value: unknown, target: unknown) => {
                configurationUpdates.push({ key: `${section}.${key}`, value, target });
                return Promise.resolve();
            }
        })
    }
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
    if (id === 'vscode') {
        return vscode;
    }
    if (id === './Java') {
        return {
            getJavaInstallDir: () => '/mock/java'
        };
    }
    return originalRequire.apply(this, arguments);
};

delete require.cache[require.resolve('../../utils/Configuration')];
const { ExtensionConfig } = require('../../utils/Configuration');

suite('Configuration Test Suite', () => {
    teardown(() => {
        configurationUpdates.length = 0;
    });

    test('boxlangLSPVersion writes to global settings even when a workspace is open', async () => {
        ExtensionConfig.boxlangLSPVersion = '1.2.3';

        assert.strictEqual(configurationUpdates.length, 1);
        assert.deepStrictEqual(configurationUpdates[0], {
            key: 'boxlang.lsp.lspVersion',
            value: '1.2.3',
            target: vscode.ConfigurationTarget.Global
        });
    });
});
