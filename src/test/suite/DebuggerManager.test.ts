import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const Module = require('module');
const originalRequire = Module.prototype.require;
let storagePath = '';
let installCalls = 0;
const state = new Map<string, unknown>();

const mockExtensionConfig = {
    boxlangDebuggerModuleName: 'bx-debugger',
    boxlangDebuggerModuleVersion: '1.14.0-snapshot',
    get boxlangDebuggerVersionSpec() {
        return `${this.boxlangDebuggerModuleName}@${this.boxlangDebuggerModuleVersion}`;
    },
    get boxlangDebuggerBoxLangHome() {
        return path.join(storagePath, 'debugger-home');
    }
};

class MockModuleManager {
    async installModuleToDir(versionSpec: string, versionDir: string) {
        installCalls++;
        const moduleDir = path.join(versionDir, versionSpec.split('@')[0]);
        await fs.mkdir(moduleDir, { recursive: true });
        await fs.writeFile(path.join(moduleDir, 'box.json'), '{}');
    }
}

Module.prototype.require = function (id: string) {
    const requester = this?.filename || '';
    if (!/[\\/]utils[\\/]DebuggerManager\./.test(requester)) {
        return originalRequire.apply(this, arguments);
    }
    if (id.endsWith('/Configuration') || id === './Configuration') {
        return { ExtensionConfig: mockExtensionConfig };
    }
    if (id.endsWith('/context') || id === '../context') {
        return { getExtensionContext: () => ({
            globalStorageUri: { fsPath: storagePath },
            globalState: {
                get<T>(key: string, defaultValue?: T): T | undefined {
                    return state.has(key) ? state.get(key) as T : defaultValue;
                },
                async update(key: string, value: unknown): Promise<void> {
                    if (value === undefined) state.delete(key);
                    else state.set(key, value);
                }
            }
        }) };
    }
    if (id.endsWith('/ModuleManager') || id === './ModuleManager') {
        return { ModuleManager: MockModuleManager };
    }
    if (id.endsWith('/ForgeBoxClient') || id === './ForgeBoxClient') {
        return {
            ForgeBoxClient: class {
                async getModuleMetadata() {
                    return { latestVersion: { version: '1.14.0+3' }, versions: [{ version: '1.14.0-snapshot', binaryHash: 'debugger-test-hash' }] };
                }
            }
        };
    }
    if (id.endsWith('/versionManager') || id === './versionManager') {
        return { getConfiguredBoxLangJarPath: async () => '/mock/boxlang.jar' };
    }
    if (id.endsWith('/OutputChannels') || id === './OutputChannels') {
        return { boxlangOutputChannel: { appendLine() { } } };
    }
    return originalRequire.apply(this, arguments);
};

const { ensureConfiguredDebuggerModule } = require('../../utils/DebuggerManager');
const { PENDING_DEBUGGER_REFRESH_KEY } = require('../../utils/versionUpdateState');

suite('DebuggerManager Test Suite', () => {
    let versionDir: string;

    setup(async () => {
        storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-debugger-manager-'));
        state.clear();
        installCalls = 0;
        versionDir = path.join(storagePath, 'debuggerVersions', 'bx-debugger@1.14.0-snapshot');
        const moduleDir = path.join(versionDir, 'bx-debugger');
        await fs.mkdir(moduleDir, { recursive: true });
        await fs.writeFile(path.join(moduleDir, 'box.json'), '{}');
        state.set(PENDING_DEBUGGER_REFRESH_KEY, {
            versionSpec: 'bx-debugger@1.14.0-snapshot',
            forceRefresh: true,
            updatedDate: '2026-09-23T16:02:22+00:00'
        });
    });

    teardown(async () => {
        await fs.rm(storagePath, { recursive: true, force: true });
    });

    test('refreshes the cached debugger module after a same-version ForgeBox update', async () => {
        const installed = await ensureConfiguredDebuggerModule();
        const metadata = JSON.parse(await fs.readFile(path.join(versionDir, 'version.json'), 'utf8'));

        assert.strictEqual(installCalls, 1);
        assert.strictEqual(installed.versionSpec, 'bx-debugger@1.14.0-snapshot');
        assert.strictEqual(metadata.updatedDate, '2026-09-23T16:02:22+00:00');
        assert.strictEqual(metadata.binaryHash, 'debugger-test-hash');
        assert.strictEqual(state.has(PENDING_DEBUGGER_REFRESH_KEY), false);
    });
});
