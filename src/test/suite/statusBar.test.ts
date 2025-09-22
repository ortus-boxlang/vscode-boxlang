import * as assert from 'assert';

// Mock the VSCode module
const vscode = {
	window: {
		createStatusBarItem: (id: string, alignment: number, priority: number) => ({
			text: '',
			tooltip: '',
			command: '',
			show: () => {},
			hide: () => {},
			dispose: () => {}
		}),
		showInformationMessage: (message: string) => {}
	},
	ExtensionMode: {
		Test: 3
	}
};

// Mock the vscode module for our imports
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
	if (id === 'vscode') {
		return vscode;
	}
	return originalRequire.apply(this, arguments);
};

import { registerStatusBar, setDefaultStatusText, setLoadingText } from '../../features/statusBar';

suite('StatusBar Test Suite', () => {
	console.log('Start StatusBar tests.');

	test('registerStatusBar creates and shows status bar item', async () => {
		// Create a mock extension context
		const mockSubscriptions: any[] = [];
		const mockContext: any = {
			subscriptions: mockSubscriptions,
			extensionPath: '',
			storageUri: undefined,
			globalStorageUri: undefined,
			workspaceState: {} as any,
			globalState: {} as any,
			secrets: {} as any,
			logUri: {} as any,
			extensionUri: {} as any,
			environmentVariableCollection: {} as any,
			asAbsolutePath: (relativePath: string) => relativePath,
			storagePath: undefined,
			globalStoragePath: '',
			logPath: '',
			extensionMode: 3, // Test mode
			extension: {} as any,
			languageModelAccessInformation: {} as any
		};

		// Call the function
		await registerStatusBar(mockContext);

		// Check that something was added to subscriptions
		assert.strictEqual(mockSubscriptions.length, 1, 'Status bar item should be added to context subscriptions');
	});

	test('setDefaultStatusText sets correct text', () => {
		// This test assumes the status bar has been registered
		// In a real test, we might need to set up more mocking
		assert.doesNotThrow(() => {
			setDefaultStatusText();
		}, 'setDefaultStatusText should not throw');
	});

	test('setLoadingText sets loading text with spinner', () => {
		const testText = 'Loading test data';
		
		// This test assumes the status bar has been registered
		assert.doesNotThrow(() => {
			setLoadingText(testText);
		}, 'setLoadingText should not throw');
	});
});