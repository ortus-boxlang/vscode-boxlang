import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';

// Mock local dependencies that transitively need VS Code before importing them.
// The global vscode mock (loaded by runTestSimple.ts / runUnitTests.ts) handles 'vscode'.
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
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

    setup(async () => {
        if (!fs.existsSync(testTempDir)) {
            fs.mkdirSync(testTempDir, { recursive: true });
        }

        mockContext = {
            globalStorageUri: { fsPath: testTempDir }
        };

        await setupVersionManagement(mockContext);
    });

    teardown(() => {
        sinon.restore();
        if (fs.existsSync(testTempDir)) {
            fs.rmSync(testTempDir, { recursive: true, force: true, maxRetries: 3 });
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
