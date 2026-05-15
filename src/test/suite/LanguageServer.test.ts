import * as assert from 'assert';
import * as sinon from 'sinon';

// Mock local dependencies that transitively need VS Code before importing them.
// The global vscode mock (loaded by runTestSimple.ts / runUnitTests.ts) handles 'vscode'.
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
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
