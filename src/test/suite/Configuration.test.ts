import * as assert from 'assert';

// Use the global vscode mock loaded by runTestSimple.ts / runUnitTests.ts.
// We manually replace workspace.getConfiguration to verify writes.
const vscode = require('vscode');

suite('Configuration Test Suite', () => {
    const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];
    let originalGetConfiguration: any;
    let originalWorkspaceFolders: any;
    let originalActiveTextEditor: any;

    setup(() => {
        configurationUpdates.length = 0;
        originalGetConfiguration = vscode.workspace.getConfiguration;
        originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        originalActiveTextEditor = vscode.window.activeTextEditor;
        vscode.window.activeTextEditor = undefined;

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
        vscode.window.activeTextEditor = originalActiveTextEditor;
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

    test('manual LSP selection preserves the most specific existing settings scope', async () => {
        const { ExtensionConfig } = require('../../utils/Configuration');
        const folderUri = { fsPath: '/mock/workspace' };
        const activeUri = { fsPath: '/mock/other-project/test.bx' };
        vscode.workspace.workspaceFolders = [{ uri: folderUri }];
        for (const scenario of [
            { folder: undefined, workspace: undefined, target: vscode.ConfigurationTarget.Global },
            { folder: undefined, workspace: 'bx-lsp@1.0.0', target: vscode.ConfigurationTarget.Workspace },
            { folder: 'bx-lsp@1.0.0', workspace: 'bx-lsp@0.9.0', target: vscode.ConfigurationTarget.WorkspaceFolder }
        ]) {
            for (const active of [false, true]) {
                configurationUpdates.length = 0;
                vscode.window.activeTextEditor = active ? { document: { uri: activeUri } } : undefined;
                vscode.workspace.getConfiguration = (section: string, resource: unknown) => {
                    assert.strictEqual(section, 'boxlang.lsp');
                    assert.strictEqual(resource, active ? activeUri : folderUri);
                    return {
                        inspect: () => ({ workspaceValue: scenario.workspace, workspaceFolderValue: scenario.folder }),
                        update: (key: string, value: unknown, target: unknown) => {
                            configurationUpdates.push({ key: `${section}.${key}`, value, target });
                            return Promise.resolve();
                        }
                    };
                };

                await ExtensionConfig.updateBoxlangLSPVersion('bx-lsp@1.16.0+15');

                assert.deepStrictEqual(configurationUpdates, [{
                    key: 'boxlang.lsp.lspVersion', value: 'bx-lsp@1.16.0+15', target: scenario.target
                }]);
            }
        }
    });

    test('LSP startup reads the folder override from the same resource used for selection', () => {
        const { ExtensionConfig } = require('../../utils/Configuration');
        const folderUri = { fsPath: '/mock/workspace' };
        vscode.workspace.workspaceFolders = [{ uri: folderUri }];
        vscode.workspace.getConfiguration = (_section: string, resource: unknown) => ({
            inspect: () => ({ workspaceFolderValue: 'bx-lsp@1.16.0+15' }),
            get: (key: string) => key === 'versionUpdateMode' ? 'auto'
                : resource === folderUri ? 'bx-lsp@1.16.0+15' : 'bx-lsp@1.10.0+9'
        });

        assert.strictEqual(ExtensionConfig.boxlangLSPVersion, 'bx-lsp@1.16.0+15');
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
