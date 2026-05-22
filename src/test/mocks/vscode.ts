/**
 * Mock VS Code API for unit tests
 * This allows testing utilities without loading the full VS Code extension host
 */

// Conditional classes to avoid errors when modules try to extend them
class MockEventEmitter {
    private listeners: Array<(data: any) => void> = [];
    event: any;
    constructor() {
        this.event = (listener: (data: any) => void) => {
            this.listeners.push(listener);
            return { dispose: () => {} };
        };
    }
    fire(data: any) { this.listeners.forEach(l => l(data)); }
    dispose() {}
}

class MockCancellationTokenSource {
    token = {
        isCancellationRequested: false,
        onCancellationRequested: { event: () => ({ dispose: () => {} }) }
    };
    cancel() {}
    dispose() {}
}

class MockTreeItem {
    constructor(label?: string, collapsibleState?: any) {}
}

class MockCompletionItem {
    constructor(label: string) {}
}

class MockPosition {
    constructor(line: number, character: number) {}
}

class MockRange {
    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {}
}

// Create a mock vscode module
const mockVSCode = {
    ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
    },
    ExtensionMode: {
        Production: 1,
        Development: 2,
        Test: 3
    },
    EventEmitter: MockEventEmitter,
    CancellationTokenSource: MockCancellationTokenSource,
    TreeItem: MockTreeItem,
    TreeItemCollapsibleState: {
        Collapsed: 1,
        Expanded: 2,
        None: 0
    },
    CompletionItem: MockCompletionItem,
    Position: MockPosition,
    Range: MockRange,
    Uri: {
        file: (path: string) => ({ fsPath: path, path }),
        parse: (uri: string) => ({ fsPath: uri, path: uri })
    },
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
        createTerminal: () => ({ show: () => {}, dispose: () => {} }),
        terminals: [],
        showInformationMessage: () => Promise.resolve(undefined),
        showWarningMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined)
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
    },
    lm: {
        registerTool: () => ({ dispose: () => {} })
    },
    chat: {
        createChatParticipant: () => ({ dispose: () => {} })
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
