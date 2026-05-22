import * as assert from 'assert';
import * as sinon from 'sinon';

// Use the global vscode mock loaded by runTestSimple.ts / runUnitTests.ts.
const vscode = require('vscode');

// We'll use the real ExtensionConfig and stub what we need
delete require.cache[require.resolve('../../utils/Configuration')];
const { ExtensionConfig } = require('../../utils/Configuration');

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

// Track ignoreOldSettings changes manually so we don't rely on the real getter/setter
let ignoreOldSettingsValue = false;

// We'll create our own sandbox so other test files' sinon.restore() doesn't wipe us out
const migrationSandbox = sinon.createSandbox();

// Stubs that must survive across suites (load-time) use the dedicated sandbox
migrationSandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section: string) => ({
	inspect: (name: string) => inspectStore[section]?.[name] ?? {},
	update: (name: string, value: unknown, target: 1 | 2 | 3) => {
		updates.push({ key: `${section}.${name}`, value, target });
		inspectStore[section] ??= {};
		inspectStore[section][name] ??= {};
		inspectStore[section][name][targetToInspectKey[target]] = value;
		return Promise.resolve();
	}
}));

migrationSandbox.stub(vscode.window, 'showInformationMessage').resolves('Migrate');
migrationSandbox.stub(ExtensionConfig, 'ignoreOldSettings').get(() => ignoreOldSettingsValue);
migrationSandbox.stub(ExtensionConfig, 'ignoreOldSettings').set((value: boolean) => {
	ignoreOldSettingsValue = value;
});

delete require.cache[require.resolve('../../settingMigration')];
const { migrateSettings } = require('../../settingMigration');

const updates: Array<{ key: string; value: unknown; target: unknown }> = [];

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
		migrationSandbox.restore();
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
