import * as assert from 'assert';

// Use the global vscode mock loaded by runTestSimple.ts / runUnitTests.ts.
// We manually replace workspace.getConfiguration to verify writes.
const vscode = require('vscode');

suite('Configuration Test Suite', () => {
    const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];
    let originalGetConfiguration: any;
    let originalWorkspaceFolders: any;

    setup(() => {
        configurationUpdates.length = 0;
        originalGetConfiguration = vscode.workspace.getConfiguration;
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;

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
        vscode.workspace.workspaceFolders = originalWorkspaceFolders;
    });

    test('updateBoxlangLSPVersion writes to global settings even when a workspace is open', async () => {
        const { ExtensionConfig } = require('../../utils/Configuration');

        await ExtensionConfig.updateBoxlangLSPVersion('1.2.3');

        assert.strictEqual(configurationUpdates.length, 1);
        assert.deepStrictEqual(configurationUpdates[0], {
            key: 'boxlang.lsp.lspVersion',
            value: '1.2.3',
            target: vscode.ConfigurationTarget.Global
        });
    });

    test('shared LSP versions apply only to unpinned, extension-managed update modes', () => {
        const { ExtensionConfig, setSharedLSPVersion } = require('../../utils/Configuration');
        vscode.workspace.workspaceFolders = [];
        setSharedLSPVersion('bx-lsp@1.15.0+14');
        try {
            for (const scenario of [
                { mode: 'auto', pinned: undefined, external: false, shared: true },
                { mode: 'prompt', pinned: undefined, external: false, shared: true },
                { mode: 'manual', pinned: undefined, external: false, shared: false },
                { mode: 'auto', pinned: 'bx-lsp@1.10.0+9', external: false, shared: false },
                { mode: 'auto', pinned: undefined, external: true, shared: false }
            ]) {
                if (scenario.external) process.env.BOXLANG_LSP_PORT = '5000';
                else delete process.env.BOXLANG_LSP_PORT;
                vscode.workspace.getConfiguration = () => ({
                    get: key => key === 'versionUpdateMode' ? scenario.mode : 'bx-lsp@1.10.0+9',
                    inspect: () => ({ workspaceValue: scenario.pinned })
                });
                assert.strictEqual(ExtensionConfig.boxlangLSPVersion,
                    scenario.shared ? 'bx-lsp@1.15.0+14' : 'bx-lsp@1.10.0+9', JSON.stringify(scenario));
            }
        } finally {
            delete process.env.BOXLANG_LSP_PORT;
            setSharedLSPVersion(undefined);
        }
    });

    test('boxlangDebuggerModuleVersion writes to global settings even when a workspace is open', async () => {
        const { ExtensionConfig } = require('../../utils/Configuration');

        vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/mock/workspace' } }];
        ExtensionConfig.boxlangDebuggerModuleVersion = '1.2.3';
        await Promise.resolve();

        assert.strictEqual(configurationUpdates.length, 1);
        assert.deepStrictEqual(configurationUpdates[0], {
            key: 'boxlang.debugger.moduleVersion',
            value: '1.2.3',
            target: vscode.ConfigurationTarget.Global
        });
    });
});
