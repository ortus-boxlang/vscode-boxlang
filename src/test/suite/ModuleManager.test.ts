import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { DownloadManager } from '../../utils/DownloadManager';
import { ForgeBoxClient } from '../../utils/ForgeBoxClient';
import { ModuleManager } from '../../utils/ModuleManager';
// CommandBox import removed - it has VS Code dependencies
// Fallback tests are skipped in unit test mode

suite('ModuleManager Test Suite', () => {
    let manager: ModuleManager;
    let downloadStub: sinon.SinonStub;
    const testTempDir = path.join(__dirname, 'temp-module-test');
    const testBoxLangHome = path.join(testTempDir, 'boxlang-home');

    setup(() => {
        manager = new ModuleManager(true); // Native mode enabled

        // Create temp directories
        if (!fs.existsSync(testTempDir)) {
            fs.mkdirSync(testTempDir, { recursive: true });
        }
        if (!fs.existsSync(testBoxLangHome)) {
            fs.mkdirSync(testBoxLangHome, { recursive: true });
        }
    });

    teardown(() => {
        sinon.restore();
        // Clean up
        if (fs.existsSync(testTempDir)) {
            fs.rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    suite('parseModuleSpec', () => {
        test('should parse module spec with version', async () => {
            // Use private method via reflection
            const parseMethod = (manager as any).parseModuleSpec.bind(manager);
            const [slug, version] = parseMethod('bx-lsp@1.5.0');

            assert.strictEqual(slug, 'bx-lsp');
            assert.strictEqual(version, '1.5.0');
        });

        test('should parse module spec without version', async () => {
            const parseMethod = (manager as any).parseModuleSpec.bind(manager);
            const [slug, version] = parseMethod('bx-lsp');

            assert.strictEqual(slug, 'bx-lsp');
            assert.strictEqual(version, undefined);
        });
    });

    suite('installModule (native mode)', () => {
        test('should install module successfully', async () => {
            // Stub ForgeBox client
            const forgeBoxClientStub = sinon.stub(ForgeBoxClient.prototype, 'getDownloadURL')
                .resolves('https://forgebox.io/downloads/bx-lsp.zip');

            // Stub download and extract
            downloadStub = sinon.stub(DownloadManager, 'downloadAndExtract').callsFake(async (_url, dest) => {
                fs.mkdirSync(dest, { recursive: true });
                fs.writeFileSync(
                    path.join(dest, 'box.json'),
                    JSON.stringify({ name: 'bx-lsp', version: '1.5.0' })
                );
            });

            const result = await manager.installModule('bx-lsp@1.5.0', testBoxLangHome, false);

            assert.strictEqual(result, true);
            assert.ok(forgeBoxClientStub.calledWith('bx-lsp', '1.5.0'));
            assert.ok(downloadStub.calledOnce);
        });

        test('should clean existing module before installing', async () => {
            const modulePath = path.join(testBoxLangHome, 'modules', 'bx-lsp');

            // Create existing module directory
            fs.mkdirSync(modulePath, { recursive: true });
            fs.writeFileSync(path.join(modulePath, 'old-file.txt'), 'old content');

            sinon.stub(ForgeBoxClient.prototype, 'getDownloadURL')
                .resolves('https://forgebox.io/downloads/bx-lsp.zip');

            downloadStub = sinon.stub(DownloadManager, 'downloadAndExtract').callsFake(async (url, dest) => {
                // Create box.json after "extraction"
                fs.mkdirSync(dest, { recursive: true });
                fs.writeFileSync(
                    path.join(dest, 'box.json'),
                    JSON.stringify({ name: 'bx-lsp' })
                );
            });

            await manager.installModule('bx-lsp', testBoxLangHome, false);

            // Old file should be gone
            assert.ok(!fs.existsSync(path.join(modulePath, 'old-file.txt')));
        });

        test('should validate installation by checking box.json', async () => {
            sinon.stub(ForgeBoxClient.prototype, 'getDownloadURL')
                .resolves('https://forgebox.io/downloads/bx-lsp.zip');

            // Simulate extraction without creating box.json
            downloadStub = sinon.stub(DownloadManager, 'downloadAndExtract').resolves();

            await assert.rejects(
                async () => await manager.installModule('bx-lsp', testBoxLangHome, false),
                /Module installation failed: box.json not found/
            );
        });

        test.skip('should fallback to CommandBox on native failure (SKIPPED - requires VS Code)', async () => {
            // This test requires CommandBox which has VS Code dependencies
            // Run in full VS Code extension test environment instead
        });

        test('should throw error when fallback disabled', async () => {
            sinon.stub(ForgeBoxClient.prototype, 'getDownloadURL')
                .rejects(new Error('Network error'));

            await assert.rejects(
                async () => await manager.installModule('bx-lsp', testBoxLangHome, false),
                /Network error/
            );
        });
    });

    suite('installModuleToDir', () => {
        test('should install module to custom directory', async () => {
            const customDir = path.join(testTempDir, 'custom-install');

            sinon.stub(ForgeBoxClient.prototype, 'getDownloadURL')
                .resolves('https://forgebox.io/downloads/bx-lsp.zip');

            downloadStub = sinon.stub(DownloadManager, 'downloadAndExtract').callsFake(async (_url, dest) => {
                fs.mkdirSync(path.join(dest, 'bx-lsp'), { recursive: true });
                fs.writeFileSync(
                    path.join(dest, 'bx-lsp', 'box.json'),
                    JSON.stringify({ name: 'bx-lsp' })
                );
            });

            await manager.installModuleToDir('bx-lsp', customDir, false);

            assert.ok(downloadStub.calledWith('https://forgebox.io/downloads/bx-lsp.zip', customDir));
        });
    });

    suite('uninstallModule', () => {
        test('should remove module directory', async () => {
            const modulePath = path.join(testBoxLangHome, 'modules', 'bx-lsp');

            // Create module to uninstall
            fs.mkdirSync(modulePath, { recursive: true });
            fs.writeFileSync(path.join(modulePath, 'box.json'), '{}');

            const result = await manager.uninstallModule('bx-lsp', testBoxLangHome, false);

            assert.strictEqual(result, true);
            assert.ok(!fs.existsSync(modulePath));
        });

        test('should succeed when module already uninstalled', async () => {
            const result = await manager.uninstallModule('nonexistent', testBoxLangHome, false);

            assert.strictEqual(result, true);
        });

        test.skip('should fallback to CommandBox on error (SKIPPED - requires VS Code)', async () => {
            // This test requires CommandBox which has VS Code dependencies
            // Run in full VS Code extension test environment instead
        });
    });

    suite('listModules', () => {
        test('should list modules from ForgeBox', async () => {
            const mockModules = [
                {
                    slug: 'bx-lsp',
                    title: 'BoxLang LSP',
                    summary: 'Language Server',
                    version: '1.5.0',
                    latestVersion: { version: '1.5.0', downloadURL: '', isActive: true, createDate: '' },
                    versions: [],
                    downloads: 100,
                    isActive: true,
                    createDate: '',
                    modifyDate: '',
                    description: ''
                }
            ];

            sinon.stub(ForgeBoxClient.prototype, 'listBoxLangModules').resolves(mockModules);

            const modules = await manager.listModules(false);

            assert.strictEqual(modules.length, 1);
            assert.strictEqual(modules[0].slug, 'bx-lsp');
        });

        test.skip('should fallback to CommandBox for listing (SKIPPED - requires VS Code)', async () => {
            // This test requires CommandBox which has VS Code dependencies
            // Run in full VS Code extension test environment instead
        });
    });

    suite('getModuleMinimumBoxLangVersion', () => {
        test('should read minimum version from box.json', async () => {
            const moduleDir = path.join(testTempDir, 'test-module');
            fs.mkdirSync(moduleDir, { recursive: true });
            fs.writeFileSync(
                path.join(moduleDir, 'box.json'),
                JSON.stringify({
                    name: 'test-module',
                    boxlang: {
                        minimumVersion: '1.3.0'
                    }
                })
            );

            const version = await manager.getModuleMinimumBoxLangVersion(moduleDir);

            assert.strictEqual(version, '1.3.0');
        });

        test('should return null when box.json missing', async () => {
            const version = await manager.getModuleMinimumBoxLangVersion('/nonexistent');

            assert.strictEqual(version, null);
        });

        test('should fallback to boxlang.version if minimumVersion not set', async () => {
            const moduleDir = path.join(testTempDir, 'test-module-2');
            fs.mkdirSync(moduleDir, { recursive: true });
            fs.writeFileSync(
                path.join(moduleDir, 'box.json'),
                JSON.stringify({
                    name: 'test-module',
                    boxlang: {
                        version: '1.2.0'
                    }
                })
            );

            const version = await manager.getModuleMinimumBoxLangVersion(moduleDir);

            assert.strictEqual(version, '1.2.0');
        });
    });

    suite('CommandBox mode', () => {
        test.skip('should use CommandBox when native mode disabled (SKIPPED - requires VS Code)', async () => {
            // This test requires CommandBox which has VS Code dependencies
            // Run in full VS Code extension test environment instead
        });
    });
});
