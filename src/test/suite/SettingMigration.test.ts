import * as assert from 'assert';

const updates: Array<{ key: string; value: unknown; target: unknown }> = [];
let ignoreOldSettingsValue = false;

type InspectValue = {
    globalValue?: unknown;
    workspaceValue?: unknown;
    workspaceFolderValue?: unknown;
};

const inspectStore: Record<string, Record<string, InspectValue>> = {
    'boxlang.cfml': {
        mappings: {
            workspaceValue: [
                {
                    logicalPath: '/models',
                    directoryPath: './src/models',
                    isPhysicalDirectoryPath: false
                }
            ]
        }
    },
    boxlang: {
        mappings: {}
    }
};

const targetToInspectKey = {
    1: 'globalValue',
    2: 'workspaceValue',
    3: 'workspaceFolderValue'
} as const;

const vscode = {
    ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
    },
    window: {
        showInformationMessage: () => Promise.resolve('Migrate')
    },
    workspace: {
        getConfiguration: (section: string) => ({
            inspect: (name: string) => inspectStore[section]?.[name] ?? {},
            update: (name: string, value: unknown, target: 1 | 2 | 3) => {
                updates.push({ key: `${section}.${name}`, value, target });
                inspectStore[section] ??= {};
                inspectStore[section][name] ??= {};
                inspectStore[section][name][targetToInspectKey[target]] = value;
                return Promise.resolve();
            }
        })
    }
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
    if (id === 'vscode') {
        return vscode;
    }
    if (id === '../utils/Configuration') {
        return {
            ExtensionConfig: {
                get ignoreOldSettings() {
                    return ignoreOldSettingsValue;
                },
                set ignoreOldSettings(value: boolean) {
                    ignoreOldSettingsValue = value;
                }
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

delete require.cache[require.resolve('../../settingMigration')];
const { migrateSettings } = require('../../settingMigration');

suite('Setting Migration Test Suite', () => {
    teardown(() => {
        updates.length = 0;
        ignoreOldSettingsValue = false;
        inspectStore['boxlang.cfml'].mappings = {
            workspaceValue: [
                {
                    logicalPath: '/models',
                    directoryPath: './src/models',
                    isPhysicalDirectoryPath: false
                }
            ]
        };
        inspectStore.boxlang.mappings = {};
    });

    test('migrates boxlang.cfml.mappings to boxlang.mappings at workspace scope', async () => {
        await migrateSettings(true);

        assert.strictEqual(updates.length, 1);
        assert.deepStrictEqual(updates[0], {
            key: 'boxlang.mappings',
            value: {
                '/models': './src/models'
            },
            target: vscode.ConfigurationTarget.Workspace
        });
        assert.strictEqual(ignoreOldSettingsValue, true);
    });
});