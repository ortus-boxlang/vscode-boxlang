import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { DownloadManager } from '../../utils/DownloadManager';

// Mock local dependencies that transitively need VS Code before importing them.
// The global vscode mock (loaded by runTestSimple.ts / runUnitTests.ts) handles 'vscode'.
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
    const requester = this?.filename || '';
    if (requester.includes('/utils/versionManager') && id === './Server') {
        return { getAvailableServerNames: () => [], getServerData: () => undefined };
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
const fileUtil = require('../../utils/fileUtil');
const { ExtensionConfig } = require('../../utils/Configuration');
const { setupVersionManagement, ensureBoxLangVersion } = require('../../utils/versionManager');
const { PENDING_RUNTIME_REFRESH_KEY } = require('../../utils/versionUpdateState');

suite('versionManager Test Suite', () => {
    const testTempDir = path.join(__dirname, 'temp-version-test');
    let mockContext: any;
    const state = new Map<string, unknown>();

    setup(async () => {
        if (!fs.existsSync(testTempDir)) {
            fs.mkdirSync(testTempDir, { recursive: true });
        }

        state.clear();
        mockContext = {
            globalStorageUri: { fsPath: testTempDir },
            globalState: {
                get<T>(key: string, defaultValue?: T): T | undefined {
                    return state.has(key) ? state.get(key) as T : defaultValue;
                },
                async update(key: string, value: unknown): Promise<void> {
                    if (value === undefined) state.delete(key);
                    else state.set(key, value);
                }
            }
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

        test('refreshes a same-version runtime install when the S3 ETag changes', async () => {
            const versionDir = path.join(testTempDir, 'boxlang_versions', 'boxlang-1.9.0');
            fs.mkdirSync(versionDir, { recursive: true });
            fs.writeFileSync(path.join(versionDir, 'boxlang-1.9.0.jar'), 'old jar');
            fs.writeFileSync(path.join(versionDir, 'version.json'), JSON.stringify({ name: 'boxlang-1.9.0', etag: 'old-etag' }));
            state.set(PENDING_RUNTIME_REFRESH_KEY, { versionSpec: 'boxlang-1.9.0', forceRefresh: true, etag: 'new-etag' });
            sinon.stub(DownloadManager, 'listS3BoxLangVersions').resolves([{
                version: '1.9.0',
                url: 'https://example.com/boxlang-1.9.0.jar',
                date: new Date(),
                etag: 'new-etag'
            }]);
            sinon.stub(fileUtil, 'downloadFile').callsFake(async (_url: string, target: string) => {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, 'new jar');
                return target;
            });

            const result = await ensureBoxLangVersion('1.9.0');
            const metadata = JSON.parse(fs.readFileSync(path.join(versionDir, 'version.json'), 'utf8'));

            assert.strictEqual(result, path.join(versionDir, 'boxlang-1.9.0.jar'));
            assert.strictEqual(fs.readFileSync(result, 'utf8'), 'new jar');
            assert.strictEqual(metadata.etag, 'new-etag');
            assert.strictEqual(state.has(PENDING_RUNTIME_REFRESH_KEY), false);
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
