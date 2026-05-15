import * as assert from 'assert';
import * as sinon from 'sinon';

// Mock vscode before any imports that need it
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

const mockVSCode = {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    EventEmitter: MockEventEmitter,
    CompletionItem: class { constructor() {} },
    Uri: { file: (p: string) => ({ fsPath: p }), parse: (p: string) => ({ fsPath: p }) },
    TreeItem: class { constructor() {} },
    TreeItemCollapsibleState: { Expanded: 1, Collapsed: 2, None: 0 },
    window: {
        createOutputChannel: () => ({
            append: () => {},
            appendLine: () => {},
            clear: () => {},
            dispose: () => {},
            hide: () => {},
            show: () => {}
        })
    },
    workspace: {
        getConfiguration: () => ({
            get: () => undefined,
            has: () => false,
            inspect: () => undefined,
            update: () => Promise.resolve()
        }),
        workspaceFolders: []
    }
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
    if (id === 'vscode') {
        return mockVSCode;
    }
    if (id.endsWith('/Java') || id.endsWith('\\Java') || id === './Java') {
        return { getJavaInstallDir: () => '/mock/java' };
    }
    if (id.endsWith('/entities/component') || id === './entities/component') {
        return {
            COMPONENT_EXT: '.cfc',
            COMPONENT_FILE_GLOB: '**/*.cfc'
        };
    }
    if (id.endsWith('/main') || id === './main') {
        return { extensionContext: {}, CFML_LANGUAGE_ID: 'cfml', BL_LANGUAGE_ID: 'boxlang' };
    }
    return originalRequire.apply(this, arguments);
};

const { ExtensionConfig } = require('../../utils/Configuration');
const { getLSPServerConfig } = require('../../utils/LanguageServer');

suite('LanguageServer Test Suite', () => {
    setup(() => {
        sinon.stub(ExtensionConfig, 'boxlangJavaExecutable').get(() => 'java');
        sinon.stub(ExtensionConfig, 'boxlangMaxHeapSize').get(() => 512);
        sinon.stub(ExtensionConfig, 'boxlangLSPJVMArgs').get(() => '');
    });

    teardown(() => {
        sinon.restore();
    });

    test('getLSPServerConfig should reject when LSP version is not configured', async () => {
        sinon.stub(ExtensionConfig, 'boxlangLSPVersion').get(() => undefined);

        const serverOptions = getLSPServerConfig();

        await assert.rejects(
            serverOptions(),
            /boxlang\.lsp\.lspVersion is not configured/
        );
    });
});
