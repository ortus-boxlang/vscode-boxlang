/**
 * Mock VS Code API for unit tests
 * This allows testing utilities without loading the full VS Code extension host
 */

// Create a mock vscode module
const mockVSCode = {
    window: {
        createOutputChannel: () => ({
            append: () => {},
            appendLine: () => {},
            clear: () => {},
            dispose: () => {},
            hide: () => {},
            show: () => {}
        }),
        createStatusBarItem: () => ({
            text: '',
            tooltip: '',
            command: '',
            show: () => {},
            hide: () => {},
            dispose: () => {}
        }),
        showInformationMessage: () => Promise.resolve(undefined),
        showWarningMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined)
    },
    ExtensionMode: {
        Production: 1,
        Development: 2,
        Test: 3
    },
    Uri: {
        file: (path: string) => ({ fsPath: path, path }),
        parse: (uri: string) => ({ fsPath: uri, path: uri })
    },
    workspace: {
        getConfiguration: () => ({
            get: () => undefined,
            has: () => false,
            inspect: () => undefined,
            update: () => Promise.resolve()
        }),
        workspaceFolders: []
    },
    ProgressLocation: {
        Notification: 15,
        Window: 10,
        SourceControl: 1
    }
};

// Intercept require('vscode') calls
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id: string) {
    if (id === 'vscode') {
        return mockVSCode;
    }
    return originalRequire.apply(this, arguments);
};

export default mockVSCode;
