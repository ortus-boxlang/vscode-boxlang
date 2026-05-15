import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';

// Mock vscode and local dependencies before any imports that transitively need them
const mockVSCode = {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    EventEmitter: class {
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
    },
    CancellationTokenSource: class {
        token = { isCancellationRequested: false, onCancellationRequested: { event: () => ({ dispose: () => {} }) } };
        cancel() {}
        dispose() {}
    },
    Uri: { file: (p: string) => ({ fsPath: p, path: p }), parse: (p: string) => ({ fsPath: p, path: p }) },
    TreeItem: class { constructor() {} },
    TreeItemCollapsibleState: { Expanded: 1, Collapsed: 2, None: 0 },
    Position: class { constructor() {} },
    Range: class { constructor() {} },
    window: {
        createOutputChannel: () => ({
            append: () => {},
            appendLine: () => {},
            clear: () => {},
            dispose: () => {},
            hide: () => {},
            show: () => {}
        }),
        createTerminal: () => ({ show: () => {}, dispose: () => {} }),
        terminals: []
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
            COMPONENT_FILE_GLOB: '**/*.cfc',
            getApplicationUri: () => null,
            getServerUri: () => null
        };
    }
    if (id.endsWith('/main') || id === './main') {
        return { extensionContext: {}, CFML_LANGUAGE_ID: 'cfml', BL_LANGUAGE_ID: 'boxlang' };
    }
    return originalRequire.apply(this, arguments);
};

// Now safe to require modules that transitively load Java.ts
const { ExtensionConfig } = require('../../utils/Configuration');
const { setupVersionManagement, ensureBoxLangVersion } = require('../../utils/versionManager');

suite('versionManager Test Suite', () => {
    const testTempDir = path.join(__dirname, 'temp-version-test');
    let mockContext: any;

    setup(() => {
        if (!fs.existsSync(testTempDir)) {
            fs.mkdirSync(testTempDir, { recursive: true });
        }

        mockContext = {
            globalStorageUri: { fsPath: testTempDir }
        };

        setupVersionManagement(mockContext);
    });

    teardown(() => {
        sinon.restore();
        if (fs.existsSync(testTempDir)) {
            fs.rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    suite('ensureBoxLangVersion', () => {
        test('should return bundled JAR path when version is empty string', async () => {
            const includedPath = path.join(testTempDir, 'bundled', 'boxlang.jar');
            sinon.stub(ExtensionConfig, 'includedBoxLangJarPath').get(() => includedPath);

            const result = await ensureBoxLangVersion('');

            assert.strictEqual(result, includedPath);
        });

        test('should return bundled JAR path when version is "boxlang-"', async () => {
            const includedPath = path.join(testTempDir, 'bundled', 'boxlang.jar');
            sinon.stub(ExtensionConfig, 'includedBoxLangJarPath').get(() => includedPath);

            const result = await ensureBoxLangVersion('boxlang-');

            assert.strictEqual(result, includedPath);
        });

        test('should return installed version JAR when version exists locally', async () => {
            const versionDir = path.join(testTempDir, 'boxlang_versions', 'boxlang-1.9.0');
            fs.mkdirSync(versionDir, { recursive: true });
            const jarPath = path.join(versionDir, 'boxlang-1.9.0.jar');
            fs.writeFileSync(jarPath, 'fake jar');
            fs.writeFileSync(
                path.join(versionDir, 'version.json'),
                JSON.stringify({ name: 'boxlang-1.9.0', url: 'http://test', lastModified: new Date().toISOString() })
            );

            const result = await ensureBoxLangVersion('1.9.0');

            assert.strictEqual(result, jarPath);
        });
    });
});
