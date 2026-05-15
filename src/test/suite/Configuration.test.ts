import * as assert from 'assert';

// Use the global vscode mock loaded by runTestSimple.ts / runUnitTests.ts.
// We manually replace workspace.getConfiguration to verify writes.
const vscode = require('vscode');

suite('Configuration Test Suite', () => {
    const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];
    let originalGetConfiguration: any;

    setup(() => {
        configurationUpdates.length = 0;
        originalGetConfiguration = vscode.workspace.getConfiguration;

        vscode.workspace.getConfiguration = (section: string) => ({
            get: () => undefined,
            has: () => false,
            inspect: () => undefined,
            update: (key: string, value: unknown, target: unknown) => {
                configurationUpdates.push({ key: `${section}.${key}`, value, target });
                return Promise.resolve();
            }
        });
    });

    teardown(() => {
        configurationUpdates.length = 0;
        vscode.workspace.getConfiguration = originalGetConfiguration;
    });

    test('boxlangLSPVersion writes to global settings even when a workspace is open', async () => {
        const { ExtensionConfig } = require('../../utils/Configuration');

        ExtensionConfig.boxlangLSPVersion = '1.2.3';

        assert.strictEqual(configurationUpdates.length, 1);
        assert.deepStrictEqual(configurationUpdates[0], {
            key: 'boxlang.lsp.lspVersion',
            value: '1.2.3',
            target: vscode.ConfigurationTarget.Global
        });
    });
});
