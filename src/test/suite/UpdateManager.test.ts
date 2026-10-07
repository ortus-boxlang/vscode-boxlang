import * as assert from 'assert';
import { createLSPInstallation } from '../mocks/lspInstallation';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { getLSPUpdateChannel, readLSPUpdate } from '../../utils/SharedLSPUpdates';

const vscode = require('vscode');
const Module = require('module');
const originalRequire = Module.prototype.require;

let mockBvmrcVersion: string | null = null;
let mockDebuggerVersion = '1.0.0-snapshot';
let mockDebuggerLatestVersion = '1.1.0';
let mockDebuggerVersions = ['1.1.0'];
let mockDebuggerBinaryHash: string | undefined;
let mockVersionUpdatedDate = '2026-01-01T00:00:00Z';
let mockRuntimeS3Versions: Array<{ version: string; url: string; date: Date; etag?: string }> = [];
let mockMiniServerS3Versions: Array<{ version: string; url: string; date: Date; etag?: string }> = [];
let moduleVersionMetadataCalls = 0;
let debuggerVersionUpdate: ((version: string) => void) | undefined;
let installLSP: ((directory: string) => Promise<void>) | undefined;
const outputLines: string[] = [];
const stateStore = new Map<string, unknown>();

const mockExtensionContext = {
    extension: { packageJSON: { version: '1.28.0' } },
    globalStorageUri: { fsPath: '/mock/global-storage' },
    subscriptions: [] as Array<{ dispose(): void }>,
    globalState: {
        get<T>(key: string, defaultValue: T): T {
            return (stateStore.has(key) ? stateStore.get(key) : defaultValue) as T;
        },
        async update(key: string, value: unknown): Promise<void> {
            stateStore.set(key, value);
        }
    }
};

const mockExtensionConfig = {
    boxlangRuntimeVersionUpdateMode: 'manual' as 'auto' | 'prompt' | 'manual',
    boxlangMiniServerVersionUpdateMode: 'manual' as 'auto' | 'prompt' | 'manual',
    boxlangLSPVersionUpdateMode: 'auto' as 'auto' | 'prompt' | 'manual',
    boxlangDebuggerVersionUpdateMode: 'manual' as 'auto' | 'prompt' | 'manual',
    boxlangUpdatesPreRelease: false,
    boxlangVersion: '1.13.0-snapshot',
    boxlangMiniServerJarPath: '/mock/boxlang-miniserver-1.0.0.jar',
    boxlangLSPVersion: 'bx-lsp@1.9.0+8',
    boxlangLSPUsesSharedUpdates: true,
    get boxlangDebuggerModuleVersion() {
        return mockDebuggerVersion;
    },
    set boxlangDebuggerModuleVersion(version: string) {
        mockDebuggerVersion = version;
        debuggerVersionUpdate?.(version);
    },
    boxlangDebuggerModuleName: 'bx-debugger',
    async updateBoxlangLSPVersion(_versionSpec: string): Promise<void> {
        return;
    }
};

const mockLSP = {
    async restart(): Promise<void> {
        return;
    }
};

let mockLatestMetadata: {
    latestVersion: { version: string; binaryHash?: string };
    versions: Array<{ version: string; binaryHash?: string }>;
} = {
    latestVersion: { version: '1.10.0+9' },
    versions: [{ version: '1.9.0+8' }]
};

class MockForgeBoxClient {
    async getModuleMetadata(moduleName: string) {
        if (moduleName === 'bx-lsp') {
            return mockLatestMetadata;
        }

        return {
            latestVersion: { version: mockDebuggerLatestVersion, binaryHash: mockDebuggerBinaryHash },
            versions: mockDebuggerVersions.map(version => ({ version, binaryHash: mockDebuggerBinaryHash }))
        };
    }

    async getModuleVersionMetadata(_moduleName: string, version: string) {
        moduleVersionMetadataCalls++;
        return { version, updatedDate: mockVersionUpdatedDate };
    }
}

function compareBoxLangLspVersionsDescending(current: string, latest: string): number {
    const currentParts = current.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
    const latestParts = latest.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
    const maxLength = Math.max(currentParts.length, latestParts.length);

    for (let index = 0; index < maxLength; index++) {
        const currentPart = currentParts[index] ?? 0;
        const latestPart = latestParts[index] ?? 0;

        if (currentPart === latestPart) {
            continue;
        }

        return currentPart < latestPart ? 1 : -1;
    }

    return 0;
}

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

Module.prototype.require = function (id: string) {
    const requester = this?.filename || '';
    const fromUpdateManager = /[\\/]utils[\\/]UpdateManager\./.test(requester);

    if (fromUpdateManager && (id.endsWith('/Configuration') || id === './Configuration')) {
        return {
            ExtensionConfig: mockExtensionConfig,
            getBvmrcVersion: () => mockBvmrcVersion,
            setSharedLSPVersion: () => undefined
        };
    }

    if (fromUpdateManager && (id.endsWith('/ForgeBoxClient') || id === './ForgeBoxClient')) {
        return { ForgeBoxClient: MockForgeBoxClient };
    }

    if (fromUpdateManager && (id.endsWith('/ModuleManager') || id === './ModuleManager')) {
        return { ModuleManager: class {
            async installModuleToDir(_spec: string, directory: string) {
                await installLSP?.(directory);
                await createLSPInstallation(directory);
            }
        } };
    }

    if (fromUpdateManager && (id.endsWith('/LanguageServer') || id === './LanguageServer')) {
        return mockLSP;
    }

    if (fromUpdateManager && (id.endsWith('/OutputChannels') || id === './OutputChannels')) {
        return {
            boxlangOutputChannel: {
                appendLine(message: string) {
                    outputLines.push(String(message));
                }
            }
        };
    }

    if (fromUpdateManager && (id.endsWith('/DownloadManager') || id === './DownloadManager')) {
        return {
            DownloadManager: {
                listS3MiniServerVersions: async () => mockMiniServerS3Versions,
                downloadMiniServer: async () => undefined
            }
        };
    }

    if (fromUpdateManager && (id.endsWith('/versionManager') || id === './versionManager')) {
        return {
            getAvailableBoxLangVerions: async () => mockRuntimeS3Versions.map(version => ({
                ...version,
                name: `boxlang-${version.version}`,
                lastModified: version.date
            }))
        };
    }

    if (fromUpdateManager && (id.endsWith('/context') || id === '../context')) {
        return {
            getExtensionContext: () => mockExtensionContext
        };
    }

    if (fromUpdateManager && (id.endsWith('/selectLSPVersion') || id === '../commands/lsp/selectLSPVersion')) {
        return { compareBoxLangLspVersionsDescending };
    }

    return originalRequire.apply(this, arguments);
};

delete require.cache[require.resolve('../../utils/UpdateManager')];
const { checkAllUpdates, setupSharedLSPUpdates, adoptSharedLSPUpdate } = require('../../utils/UpdateManager');
const publishedLSPUpdate = () => readLSPUpdate(mockExtensionContext.globalStorageUri.fsPath,
    getLSPUpdateChannel(mockExtensionContext.extension.packageJSON.version));
let savedInfoMessage: any;

suite('UpdateManager Test Suite', () => {
    setup(async () => {
        mockExtensionContext.globalStorageUri.fsPath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-updates-'));
        installLSP = undefined;
        savedInfoMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async () => undefined;
        outputLines.length = 0;
        stateStore.clear();
        mockExtensionContext.extension.packageJSON.version = '1.28.0';
        mockBvmrcVersion = null;
        mockDebuggerVersion = '1.0.0-snapshot';
        mockDebuggerLatestVersion = '1.1.0';
        mockDebuggerVersions = ['1.1.0'];
        mockDebuggerBinaryHash = undefined;
        mockVersionUpdatedDate = '2026-01-01T00:00:00Z';
        mockRuntimeS3Versions = [];
        mockMiniServerS3Versions = [];
        moduleVersionMetadataCalls = 0;
        debuggerVersionUpdate = undefined;
        delete process.env.BOXLANG_LSP_PORT;
        mockLatestMetadata = {
            latestVersion: { version: '1.10.0+9' },
            versions: [{ version: '1.9.0+8' }]
        };

        mockExtensionConfig.boxlangRuntimeVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangMiniServerVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'auto';
        mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangUpdatesPreRelease = false;
        mockExtensionConfig.boxlangLSPVersion = 'bx-lsp@1.9.0+8';
        mockExtensionConfig.boxlangLSPUsesSharedUpdates = true;
    });

    teardown(async () => {
        delete process.env.BOXLANG_LSP_PORT;
        mockExtensionContext.subscriptions.splice(0).forEach(subscription => subscription.dispose());
        sinon.restore();
        vscode.window.showInformationMessage = savedInfoMessage;
        await fs.rm(mockExtensionContext.globalStorageUri.fsPath, { recursive: true, force: true });
    });

    test('runtime and MiniServer pair available releases and fall back when unmatched', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-update-manager-'));
        const originalStoragePath = mockExtensionContext.globalStorageUri.fsPath;
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        const originalWithProgress = vscode.window.withProgress;
        const configurationUpdates: Array<{ section: string; key: string; value: unknown }> = [];

        mockExtensionContext.globalStorageUri.fsPath = storagePath;
        mockExtensionConfig.boxlangRuntimeVersionUpdateMode = 'auto';
        mockExtensionConfig.boxlangMiniServerVersionUpdateMode = 'auto';
        mockExtensionConfig.boxlangVersion = '1.17.5';
        mockExtensionConfig.boxlangMiniServerJarPath = '/mock/boxlang-miniserver-1.17.5.jar';
        mockRuntimeS3Versions = [
            { version: '1.18.0', url: 'runtime-1.18.jar', date: new Date('2026-09-28T00:00:00Z') },
            { version: '1.17.6', url: 'runtime-1.17.6.jar', date: new Date('2026-09-25T00:00:00Z') },
            { version: '1.17.5', url: 'runtime-1.17.5.jar', date: new Date('2026-09-14T00:00:00Z') }
        ];
        mockMiniServerS3Versions = [
            { version: '1.17.6', url: 'mini-1.17.6.jar', date: new Date('2026-09-25T01:00:00Z') },
            { version: '1.17.5', url: 'mini-1.17.5.jar', date: new Date('2026-09-14T01:00:00Z') }
        ];
        vscode.workspace.getConfiguration = (section: string) => ({
            update: async (key: string, value: unknown) => { configurationUpdates.push({ section, key, value }); }
        });
        vscode.window.withProgress = async (_options: unknown, task: () => Promise<unknown>) => task();

        try {
            await checkAllUpdates(true);
            assert.ok(configurationUpdates.some(update => update.section === 'boxlang' && update.key === 'boxlangVersion' && update.value === '1.17.6'));
            assert.ok(mockExtensionConfig.boxlangMiniServerJarPath.endsWith('boxlang-miniserver-1.17.6.jar'));

            configurationUpdates.length = 0;
            mockExtensionContext.extension.packageJSON.version = '1.27.0';
            mockExtensionConfig.boxlangVersion = '1.17.6';
            mockExtensionConfig.boxlangMiniServerJarPath = '/mock/boxlang-miniserver-1.17.6.jar';
            mockRuntimeS3Versions = [
                { version: '1.19.0-snapshot', url: 'runtime-1.19-snapshot.jar', date: new Date('2026-09-29T00:00:00Z') },
                { version: '1.18.0-snapshot', url: 'runtime-1.18-snapshot.jar', date: new Date('2026-09-28T00:00:00Z') },
                { version: '1.17.6', url: 'runtime-1.17.6.jar', date: new Date('2026-09-25T00:00:00Z') }
            ];
            mockMiniServerS3Versions = [
                { version: '1.18.0-snapshot', url: 'mini-1.18-snapshot.jar', date: new Date('2026-09-28T01:00:00Z') },
                { version: '1.17.6', url: 'mini-1.17.6.jar', date: new Date('2026-09-25T01:00:00Z') }
            ];

            await checkAllUpdates(true);
            assert.ok(configurationUpdates.some(update => update.section === 'boxlang' && update.key === 'boxlangVersion' && update.value === '1.18.0-snapshot'));
            assert.ok(mockExtensionConfig.boxlangMiniServerJarPath.endsWith('boxlang-miniserver-1.18.0-snapshot.jar'));

            configurationUpdates.length = 0;
            mockExtensionContext.extension.packageJSON.version = '1.28.0';
            mockExtensionConfig.boxlangVersion = '1.19.0-snapshot';
            mockExtensionConfig.boxlangMiniServerJarPath = '/mock/boxlang-miniserver-1.19.0-snapshot.jar';
            mockRuntimeS3Versions = [
                { version: '1.18.0', url: 'runtime-1.18.jar', date: new Date('2026-09-28T00:00:00Z') },
                { version: '1.17.6', url: 'runtime-1.17.6.jar', date: new Date('2026-09-25T00:00:00Z') }
            ];
            mockMiniServerS3Versions = [
                { version: '1.17.5', url: 'mini-1.17.5.jar', date: new Date('2026-09-14T01:00:00Z') },
                { version: '1.17.4', url: 'mini-1.17.4.jar', date: new Date('2026-09-11T01:00:00Z') }
            ];

            await checkAllUpdates(true);
            assert.ok(configurationUpdates.some(update => update.section === 'boxlang' && update.key === 'boxlangVersion' && update.value === '1.18.0'));
            assert.ok(mockExtensionConfig.boxlangMiniServerJarPath.endsWith('boxlang-miniserver-1.17.5.jar'));
        } finally {
            mockExtensionContext.globalStorageUri.fsPath = originalStoragePath;
            vscode.workspace.getConfiguration = originalGetConfiguration;
            vscode.window.withProgress = originalWithProgress;
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('runtime S3 ETag detects a republished version', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-update-manager-'));
        const originalStoragePath = mockExtensionContext.globalStorageUri.fsPath;
        const originalGetConfiguration = vscode.workspace.getConfiguration;

        try {
            mockExtensionContext.globalStorageUri.fsPath = storagePath;
            vscode.workspace.getConfiguration = () => ({ update: async () => undefined });
            mockExtensionConfig.boxlangRuntimeVersionUpdateMode = 'auto';
            mockExtensionConfig.boxlangMiniServerVersionUpdateMode = 'manual';
            mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
            mockExtensionConfig.boxlangVersion = '1.17.6';
            mockRuntimeS3Versions = [{
                version: '1.17.6', url: 'runtime.jar', date: new Date('2026-09-29T00:00:00Z'), etag: '&quot;new-runtime-etag&quot;'
            }];
            const versionDir = path.join(storagePath, 'boxlang_versions', 'boxlang-1.17.6');
            await fs.mkdir(versionDir, { recursive: true });
            await fs.writeFile(path.join(versionDir, 'version.json'), JSON.stringify({ name: 'boxlang-1.17.6', etag: '&quot;old-runtime-etag&quot;' }));

            await checkAllUpdates(true);

            assert.deepStrictEqual(stateStore.get('boxlang.updates.pendingRuntimeRefresh'), {
                versionSpec: 'boxlang-1.17.6',
                forceRefresh: true,
                etag: '&quot;new-runtime-etag&quot;',
                lastModified: '2026-09-29T00:00:00.000Z'
            }, outputLines.join('\\n'));
        } finally {
            mockExtensionContext.globalStorageUri.fsPath = originalStoragePath;
            vscode.workspace.getConfiguration = originalGetConfiguration;
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('MiniServer S3 ETag refreshes same-version jars into a new cache path', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-update-manager-'));
        const originalStoragePath = mockExtensionContext.globalStorageUri.fsPath;
        const originalWithProgress = vscode.window.withProgress;

        try {
            mockExtensionContext.globalStorageUri.fsPath = storagePath;
            mockExtensionConfig.boxlangRuntimeVersionUpdateMode = 'manual';
            mockExtensionConfig.boxlangMiniServerVersionUpdateMode = 'auto';
            mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
            const oldDir = path.join(storagePath, 'miniserverVersions', 'boxlang-miniserver-1.17.6');
            const oldJar = path.join(oldDir, 'boxlang-miniserver-1.17.6.jar');
            await fs.mkdir(oldDir, { recursive: true });
            await fs.writeFile(oldJar, 'old jar');
            await fs.writeFile(path.join(oldDir, 'version.json'), JSON.stringify({ version: '1.17.6', etag: 'old-mini-etag' }));
            mockExtensionConfig.boxlangMiniServerJarPath = oldJar;
            mockMiniServerS3Versions = [{
                version: '1.17.6', url: 'mini.jar', date: new Date('2026-09-29T00:00:00Z'), etag: 'new-mini-etag'
            }];
            vscode.window.withProgress = async (_options: unknown, task: () => Promise<unknown>) => task();

            await checkAllUpdates(true);

            assert.notStrictEqual(mockExtensionConfig.boxlangMiniServerJarPath, oldJar);
            assert.strictEqual(
                JSON.parse(await fs.readFile(path.join(path.dirname(mockExtensionConfig.boxlangMiniServerJarPath), 'version.json'), 'utf8')).etag,
                'new-mini-etag'
            );
        } finally {
            mockExtensionContext.globalStorageUri.fsPath = originalStoragePath;
            vscode.window.withProgress = originalWithProgress;
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('automatic LSP updates finish installing before restarting and do not prompt or change global version settings', async () => {
        const { readLSPUpdate } = require('../../utils/SharedLSPUpdates');
        const started = createDeferred<void>();
        const finish = createDeferred<void>();
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
        const restartStub = sinon.stub(mockLSP, 'restart');
        const messages = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        mockLatestMetadata.latestVersion.binaryHash = 'ready-build';
        let downloads = 0;
        installLSP = async () => { downloads++; started.resolve(); await finish.promise; };
        const updating = checkAllUpdates(true);
        try {
            await Promise.race([started.promise, updating]);
            assert.strictEqual(await readLSPUpdate(mockExtensionContext.globalStorageUri.fsPath, 'stable'), undefined);
            assert.strictEqual(restartStub.called, false, 'restart must wait for a complete installation');
            finish.resolve();
            await updating;
            const update = await readLSPUpdate(mockExtensionContext.globalStorageUri.fsPath, 'stable');
            assert.strictEqual(update?.versionSpec, 'bx-lsp@1.10.0+9');
            await checkAllUpdates(true);
            assert.strictEqual(downloads, 1, 'a repeated check reuses the published build');
            assert.strictEqual(restartStub.calledOnce, true);
            assert.strictEqual(messages.called, false);
            assert.strictEqual(persistStub.called, false, 'manual windows must not be changed by auto updates');
        } finally {
            finish.resolve();
            await updating;
        }
    });

    test('a published same-version build is adopted quietly once by the window watcher, while manual mode opts out', async () => {
        const { installLSPBuild, publishLSPUpdate } = require('../../utils/SharedLSPUpdates');
        const storagePath = mockExtensionContext.globalStorageUri.fsPath;
        mockExtensionContext.extension.packageJSON.version = '1.27.0';
        const restarted = createDeferred<void>();
        const restartStub = sinon.stub(mockLSP, 'restart').callsFake(async () => { restarted.resolve(); });
        const messages = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        const download = createLSPInstallation;
        const versionSpec = 'bx-lsp@1.15.0-snapshot';
        mockExtensionConfig.boxlangLSPVersion = versionSpec;
        const initial = await installLSPBuild(storagePath, versionSpec, { binaryHash: 'initial-build' }, download);
        await publishLSPUpdate(storagePath, 'prerelease', initial, 'now');
        await setupSharedLSPUpdates(mockExtensionContext);
        assert.strictEqual(restartStub.called, false, 'activation uses the ready build without an extra restart');
        const build = await installLSPBuild(storagePath, versionSpec, { binaryHash: 'new-build' }, download);
        await publishLSPUpdate(storagePath, 'prerelease', build, 'now');
        let timeout: ReturnType<typeof setTimeout>;
        try {
            await Promise.race([restarted.promise, new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('Window did not adopt the published LSP build')), 1000);
            })]);
            await adoptSharedLSPUpdate();
            assert.strictEqual(restartStub.callCount, 1);
            assert.strictEqual(messages.called, false);
            mockExtensionConfig.boxlangLSPUsesSharedUpdates = false;
            const next = await installLSPBuild(storagePath, build.versionSpec, { binaryHash: 'next-build' }, download);
            await publishLSPUpdate(storagePath, 'prerelease', next, 'now');
            await adoptSharedLSPUpdate();
            assert.strictEqual(restartStub.callCount, 1);
        } finally {
            clearTimeout(timeout);
        }
    });

    test('republished LSP snapshot with the same version triggers an update', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-update-manager-'));
        const originalStoragePath = mockExtensionContext.globalStorageUri.fsPath;

        try {
            mockExtensionContext.globalStorageUri.fsPath = storagePath;
            mockExtensionContext.extension.packageJSON.version = '1.27.0';
            mockExtensionConfig.boxlangLSPVersion = 'bx-lsp@1.14.0-snapshot';
            mockLatestMetadata = {
                latestVersion: { version: '1.14.0+13' },
                versions: [{ version: '1.14.0-snapshot' }]
            };
            mockVersionUpdatedDate = '2026-09-23T16:02:22+00:00';
            const installedDir = path.join(storagePath, 'lspVersions', 'bx-lsp@1.14.0-snapshot');
            await fs.mkdir(installedDir, { recursive: true });
            await fs.writeFile(path.join(installedDir, 'version.json'), JSON.stringify({ updatedDate: '2026-09-22T17:25:42+00:00' }));

            const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
            const restartStub = sinon.stub(mockLSP, 'restart');

            await checkAllUpdates(true);

            assert.strictEqual(persistStub.called, false);
            assert.strictEqual(restartStub.calledOnce, true);
            assert.strictEqual(moduleVersionMetadataCalls, 1);
            const update = await publishedLSPUpdate();
            assert.strictEqual(update?.versionSpec, 'bx-lsp@1.14.0-snapshot');
            assert.strictEqual(update?.updatedDate, '2026-09-23T16:02:22+00:00');
            assert.strictEqual(JSON.parse(await fs.readFile(path.join(installedDir, 'version.json'), 'utf8')).updatedDate,
                '2026-09-22T17:25:42+00:00');
        } finally {
            mockExtensionContext.globalStorageUri.fsPath = originalStoragePath;
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('up-to-date LSP cache is not refreshed again for the same ForgeBox updatedDate', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-update-manager-'));
        const originalStoragePath = mockExtensionContext.globalStorageUri.fsPath;

        try {
            mockExtensionContext.globalStorageUri.fsPath = storagePath;
            mockExtensionConfig.boxlangLSPVersion = 'bx-lsp@1.10.0+9';
            mockLatestMetadata = {
                latestVersion: { version: '1.10.0+9' },
                versions: [{ version: '1.9.0+8' }]
            };
            const installedDir = path.join(storagePath, 'lspVersions', 'bx-lsp@1.10.0+9');
            await createLSPInstallation(installedDir);
            await fs.writeFile(path.join(installedDir, 'version.json'), JSON.stringify({ updatedDate: mockVersionUpdatedDate }));
            const restartStub = sinon.stub(mockLSP, 'restart');

            await checkAllUpdates(true);

            assert.strictEqual(restartStub.called, false);
            assert.strictEqual(stateStore.has('boxlang.updates.pendingLSPRefresh'), false);
        } finally {
            mockExtensionContext.globalStorageUri.fsPath = originalStoragePath;
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('binaryHash detects a republished snapshot without a version-detail request', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-update-manager-'));
        const originalStoragePath = mockExtensionContext.globalStorageUri.fsPath;

        try {
            mockExtensionContext.globalStorageUri.fsPath = storagePath;
            mockExtensionContext.extension.packageJSON.version = '1.27.0';
            mockExtensionConfig.boxlangLSPVersion = 'bx-lsp@1.15.0-snapshot';
            mockLatestMetadata = {
                latestVersion: { version: '1.14.0+13' },
                versions: [{ version: '1.15.0-snapshot', binaryHash: 'new-hash' }]
            };
            const installedDir = path.join(storagePath, 'lspVersions', 'bx-lsp@1.15.0-snapshot');
            await fs.mkdir(installedDir, { recursive: true });
            await fs.writeFile(path.join(installedDir, 'version.json'), JSON.stringify({ binaryHash: 'old-hash' }));
            const restartStub = sinon.stub(mockLSP, 'restart');

            await checkAllUpdates(true);

            assert.strictEqual(restartStub.calledOnce, true);
            assert.strictEqual(moduleVersionMetadataCalls, 0);
            const update = await publishedLSPUpdate();
            assert.strictEqual(update?.versionSpec, 'bx-lsp@1.15.0-snapshot');
            assert.strictEqual(update?.binaryHash, 'new-hash');
            assert.strictEqual(JSON.parse(await fs.readFile(path.join(installedDir, 'version.json'), 'utf8')).binaryHash, 'old-hash');
        } finally {
            mockExtensionContext.globalStorageUri.fsPath = originalStoragePath;
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('republished debugger snapshot with the same version triggers an update', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-update-manager-'));
        const originalStoragePath = mockExtensionContext.globalStorageUri.fsPath;

        try {
            mockExtensionContext.globalStorageUri.fsPath = storagePath;
            mockExtensionContext.extension.packageJSON.version = '1.27.0';
            mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
            mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'auto';
            mockDebuggerVersion = '1.14.0-snapshot';
            mockDebuggerLatestVersion = '1.14.0-snapshot';
            mockDebuggerVersions = ['1.14.0-snapshot'];
            mockVersionUpdatedDate = '2026-09-23T16:02:22+00:00';
            const installedDir = path.join(storagePath, 'debuggerVersions', 'bx-debugger@1.14.0-snapshot');
            await fs.mkdir(installedDir, { recursive: true });
            await fs.writeFile(path.join(installedDir, 'version.json'), JSON.stringify({ updatedDate: '2026-09-22T17:25:42+00:00' }));

            await checkAllUpdates(true);

            assert.strictEqual(mockDebuggerVersion, '1.14.0-snapshot');
            assert.deepStrictEqual(stateStore.get('boxlang.updates.pendingDebuggerRefresh'), {
                versionSpec: 'bx-debugger@1.14.0-snapshot',
                forceRefresh: true,
                updatedDate: '2026-09-23T16:02:22+00:00'
            });
        } finally {
            mockExtensionContext.globalStorageUri.fsPath = originalStoragePath;
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('binaryHash detects a republished debugger snapshot without a version-detail request', async () => {
        const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-update-manager-'));
        const originalStoragePath = mockExtensionContext.globalStorageUri.fsPath;

        try {
            mockExtensionContext.globalStorageUri.fsPath = storagePath;
            mockExtensionContext.extension.packageJSON.version = '1.27.0';
            mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
            mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'auto';
            mockDebuggerVersion = '1.15.0-snapshot';
            mockDebuggerLatestVersion = '1.15.0-snapshot';
            mockDebuggerVersions = ['1.15.0-snapshot'];
            mockDebuggerBinaryHash = 'debugger-new-hash';
            const installedDir = path.join(storagePath, 'debuggerVersions', 'bx-debugger@1.15.0-snapshot');
            await fs.mkdir(installedDir, { recursive: true });
            await fs.writeFile(path.join(installedDir, 'version.json'), JSON.stringify({ binaryHash: 'debugger-old-hash' }));

            await checkAllUpdates(true);

            assert.strictEqual(moduleVersionMetadataCalls, 0);
            assert.deepStrictEqual(stateStore.get('boxlang.updates.pendingDebuggerRefresh'), {
                versionSpec: 'bx-debugger@1.15.0-snapshot',
                forceRefresh: true,
                binaryHash: 'debugger-new-hash'
            });
        } finally {
            mockExtensionContext.globalStorageUri.fsPath = originalStoragePath;
            await fs.rm(storagePath, { recursive: true, force: true });
        }
    });

    test('pre-release extension should prefer the newest LSP snapshot even when ForgeBox latest is stable', async () => {
        mockExtensionContext.extension.packageJSON.version = '1.27.0';
        mockLatestMetadata = {
            latestVersion: { version: '1.10.0+9' },
            versions: [
                { version: '1.10.0-snapshot+9' },
                { version: '1.10.0-snapshot+10' },
                { version: '1.10.0+11' }
            ]
        };
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');

        await checkAllUpdates(true);

        assert.strictEqual(persistStub.called, false);
        assert.strictEqual((await publishedLSPUpdate())?.versionSpec, 'bx-lsp@1.10.0-snapshot+10');
    });

    test('release extension should select the highest stable LSP version regardless of ForgeBox order', async () => {
        mockExtensionConfig.boxlangUpdatesPreRelease = true;
        mockLatestMetadata = {
            latestVersion: { version: '1.10.0+9' },
            versions: [
                { version: '1.12.0-snapshot+1' },
                { version: '1.10.0+10' }
            ]
        };
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');

        await checkAllUpdates(true);

        assert.strictEqual(persistStub.called, false);
        assert.strictEqual((await publishedLSPUpdate())?.versionSpec, 'bx-lsp@1.10.0+10');
    });

    test('release LSP switches from a newer snapshot to the stable stream', async () => {
        mockExtensionConfig.boxlangLSPVersion = 'bx-lsp@1.12.0-snapshot+1';
        mockLatestMetadata = {
            latestVersion: { version: '1.10.0+9' },
            versions: [{ version: '1.11.0+10' }]
        };
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');

        await checkAllUpdates(true);

        assert.strictEqual(persistStub.called, false);
        assert.strictEqual((await publishedLSPUpdate())?.versionSpec, 'bx-lsp@1.11.0+10');
    });

    test('prompt mode waits for shared approval rather than following another window\'s automatic update', async () => {
        const { installLSPBuild, publishLSPUpdate } = require('../../utils/SharedLSPUpdates');
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'prompt';
        const storagePath = mockExtensionContext.globalStorageUri.fsPath;
        const build = await installLSPBuild(storagePath, 'bx-lsp@1.10.0+9', { binaryHash: 'ready-build' }, createLSPInstallation);
        const restartStub = sinon.stub(mockLSP, 'restart');
        await publishLSPUpdate(storagePath, 'stable', build, 'now');
        await adoptSharedLSPUpdate();
        assert.strictEqual(restartStub.called, false, 'auto mode cannot consent on behalf of prompt-mode windows');
        mockExtensionConfig.boxlangLSPVersion = build.versionSpec;
        mockLatestMetadata.latestVersion.binaryHash = 'ready-build';
        const messages = sinon.stub(vscode.window, 'showInformationMessage').resolves('Update Now');
        await checkAllUpdates(true);
        assert.strictEqual(messages.calledOnce, true, 'an already-downloaded same-version build still needs prompt-mode approval');
        assert.strictEqual((await publishedLSPUpdate())?.approved, true);
        assert.strictEqual(restartStub.calledOnce, true);
    });

    test('prompt mode offers a given LSP build only once, even on repeated checks', async () => {
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'prompt';
        const messages = sinon.stub(vscode.window, 'showInformationMessage').resolves('Skip');
        await checkAllUpdates(true);
        await checkAllUpdates(true);
        assert.strictEqual(messages.callCount, 1);
    });

    test('next-restart updates publish a ready build without restarting or changing global settings', async () => {
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'prompt';
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
        const restartStub = sinon.stub(mockLSP, 'restart');
        const originalShowInformationMessage = vscode.window.showInformationMessage;
        let infoCallCount = 0;

        vscode.window.showInformationMessage = async () => {
            infoCallCount++;
            return 'Update on Next Restart';
        };

        try {
            await checkAllUpdates(true);
        } finally {
            vscode.window.showInformationMessage = originalShowInformationMessage;
        }

        assert.strictEqual(infoCallCount, 1);
        assert.strictEqual(persistStub.called, false);
        assert.strictEqual(restartStub.called, false);
        const update = await publishedLSPUpdate();
        assert.strictEqual(update?.versionSpec, 'bx-lsp@1.10.0+9');
        assert.strictEqual(update?.timing, 'restart');
    });

    test('checkAllUpdates should retry the LSP update when restart fails and the user chooses Retry', async () => {
        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
        const restartStub = sinon.stub(mockLSP, 'restart');
        const errorStub = sinon.stub(vscode.window, 'showErrorMessage');

        restartStub.onFirstCall().rejects(new Error('Stopping the server timed out'));
        restartStub.onSecondCall().resolves();
        errorStub.resolves('Retry');

        await checkAllUpdates(true);

        assert.strictEqual(persistStub.called, false);
        assert.strictEqual(restartStub.callCount, 2);
        assert.strictEqual(errorStub.calledOnce, true);
    });

    test('pre-release debugger updates prefer snapshots when both streams are available', async () => {
        mockExtensionContext.extension.packageJSON.version = '1.27.0';
        mockDebuggerLatestVersion = '1.0.0';
        mockDebuggerVersions = ['1.2.0-snapshot', '1.1.0'];
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'auto';

        await checkAllUpdates(true);

        assert.strictEqual(mockDebuggerVersion, '1.2.0-snapshot');
    });

    test('pre-release debugger moves from stable to the latest snapshot stream', async () => {
        mockExtensionContext.extension.packageJSON.version = '1.27.0';
        mockDebuggerVersion = '1.3.0';
        mockDebuggerLatestVersion = '1.2.0';
        mockDebuggerVersions = ['1.2.0-snapshot', '1.1.0'];
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'auto';

        await checkAllUpdates(true);

        assert.strictEqual(mockDebuggerVersion, '1.2.0-snapshot');
    });

    test('release debugger moves from a newer snapshot to the latest stable stream', async () => {
        mockDebuggerVersion = '1.2.0-snapshot';
        mockDebuggerLatestVersion = '1.1.0';
        mockDebuggerVersions = ['1.1.0'];
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'auto';

        await checkAllUpdates(true);

        assert.strictEqual(mockDebuggerVersion, '1.1.0');
    });

    test('release debugger updates from a snapshot to the same stable version', async () => {
        mockDebuggerVersion = '1.0.0-snapshot';
        mockDebuggerLatestVersion = '1.0.0';
        mockDebuggerVersions = ['1.0.0'];
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'auto';

        await checkAllUpdates(true);

        assert.strictEqual(mockDebuggerVersion, '1.0.0');
    });

    test('automatic debugger updates write global settings to the stable fallback on pre-release builds', async () => {
        mockExtensionContext.extension.packageJSON.version = '1.27.0';
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];

        vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/mock/workspace' } }];
        vscode.workspace.getConfiguration = (section: string) => ({
            get: () => undefined,
            has: () => false,
            inspect: () => undefined,
            update: (key: string, value: unknown, target: unknown) => {
                configurationUpdates.push({ key: `${section}.${key}`, value, target });
                return Promise.resolve();
            }
        });

        const { ExtensionConfig: actualExtensionConfig } = require('../../utils/Configuration');
        debuggerVersionUpdate = version => {
            actualExtensionConfig.boxlangDebuggerModuleVersion = version;
        };
        mockExtensionConfig.boxlangLSPVersionUpdateMode = 'manual';
        mockExtensionConfig.boxlangDebuggerVersionUpdateMode = 'auto';

        try {
            await checkAllUpdates(true);
        } finally {
            debuggerVersionUpdate = undefined;
            vscode.workspace.getConfiguration = originalGetConfiguration;
            vscode.workspace.workspaceFolders = originalWorkspaceFolders;
        }

        assert.deepStrictEqual(configurationUpdates, [{
            key: 'boxlang.debugger.moduleVersion',
            value: '1.1.0',
            target: vscode.ConfigurationTarget.Global
        }]);
    });

    test('checkAllUpdates should skip LSP updates when BOXLANG_LSP_PORT is set', async () => {
        process.env.BOXLANG_LSP_PORT = '7777';

        const persistStub = sinon.stub(mockExtensionConfig, 'updateBoxlangLSPVersion');
        const restartStub = sinon.stub(mockLSP, 'restart');

        await checkAllUpdates(true);

        assert.strictEqual(persistStub.called, false);
        assert.strictEqual(restartStub.called, false);
        assert.strictEqual(
            outputLines.includes('BoxLang UpdateManager: skipping LSP update check because BOXLANG_LSP_PORT is set'),
            true
        );
    });
});