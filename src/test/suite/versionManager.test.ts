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
const { setupVersionManagement, ensureBoxLangVersion, getAvailableBoxLangVerions, getConfiguredBoxLangJarPath } = require('../../utils/versionManager');
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

    test('cached available versions restore dates and preserve S3 identity', async () => {
        const lastModified = '2026-10-12T00:00:00.000Z';
        fs.writeFileSync(path.join(testTempDir, 'boxlang_version_cache.json'), JSON.stringify([{
            name: 'boxlang-1.18.0', url: 'https://example.com/runtime.jar', lastModified, etag: 'runtime-etag'
        }]));
        const fetch = sinon.stub(DownloadManager, 'listS3BoxLangVersions');

        const [version] = await getAvailableBoxLangVerions();

        assert.ok(version.lastModified instanceof Date);
        assert.strictEqual(version.lastModified.toISOString(), lastModified);
        assert.strictEqual(version.etag, 'runtime-etag');
        assert.strictEqual(fetch.called, false);
    });

    for (const force of [false, true]) {
        test(`S3 failure uses stale cached versions (force=${force}) without refreshing cache age`, async () => {
            const cachePath = path.join(testTempDir, 'boxlang_version_cache.json');
            fs.writeFileSync(cachePath, JSON.stringify([{
                name: 'boxlang-1.18.0', url: 'https://example.com/runtime.jar', lastModified: '2026-10-12T00:00:00Z', etag: 'cached-etag'
            }]));
            const expired = new Date(Date.now() - 60 * 60 * 1000);
            fs.utimesSync(cachePath, expired, expired);
            const originalMtime = fs.statSync(cachePath).mtimeMs;
            const fetch = sinon.stub(DownloadManager, 'listS3BoxLangVersions').rejects(new Error('S3 timeout'));

            const [version] = await getAvailableBoxLangVerions(force);

            assert.strictEqual(version.name, 'boxlang-1.18.0');
            assert.strictEqual(version.lastModified.toISOString(), '2026-10-12T00:00:00.000Z');
            assert.strictEqual(version.etag, 'cached-etag');
            assert.strictEqual(fetch.callCount, 1);
            assert.strictEqual(fs.statSync(cachePath).mtimeMs, originalMtime);
        });
    }

    test('S3 failure without a usable cache still rejects', async () => {
        fs.writeFileSync(path.join(testTempDir, 'boxlang_version_cache.json'), 'invalid JSON');
        sinon.stub(DownloadManager, 'listS3BoxLangVersions').rejects(new Error('S3 timeout'));

        await assert.rejects(getAvailableBoxLangVerions(), /S3 timeout/);
    });

    test('configured installed runtime does not need S3 discovery', async () => {
        const versionDir = path.join(testTempDir, 'boxlang_versions', 'boxlang-1.18.0');
        fs.mkdirSync(versionDir, { recursive: true });
        const jarPath = path.join(versionDir, 'boxlang-1.18.0.jar');
        fs.writeFileSync(jarPath, 'installed runtime');
        fs.writeFileSync(path.join(versionDir, 'version.json'), JSON.stringify({ name: 'boxlang-1.18.0' }));
        sinon.stub(ExtensionConfig, 'boxlangJarPath').get(() => undefined);
        sinon.stub(ExtensionConfig, 'boxlangVersion').get(() => '1.18.0');
        const fetch = sinon.stub(DownloadManager, 'listS3BoxLangVersions').rejects(new Error('S3 timeout'));

        assert.strictEqual(await getConfiguredBoxLangJarPath(), jarPath);
        assert.strictEqual(fetch.called, false);
    });

    test('configured runtime discovery failure falls back to the bundled jar', async () => {
        sinon.stub(ExtensionConfig, 'boxlangJarPath').get(() => undefined);
        sinon.stub(ExtensionConfig, 'boxlangVersion').get(() => '1.18.0');
        sinon.stub(ExtensionConfig, 'includedBoxLangJarPath').get(() => '/bundled/boxlang.jar');
        sinon.stub(DownloadManager, 'listS3BoxLangVersions').rejects(new Error('S3 timeout'));

        assert.strictEqual(await getConfiguredBoxLangJarPath(), '/bundled/boxlang.jar');
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
