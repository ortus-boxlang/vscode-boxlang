import * as assert from 'assert';
import axios from 'axios';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as tar from 'tar';
import { ExtensionConfig } from '../../utils/Configuration';

const Module = require('module');
const javaModulePath = require.resolve('../../utils/Java');
const vscode = require('vscode');

suite('Java installation recovery', () => {
    let tempDir: string;
    let java: typeof import('../../utils/Java');
    let originalRequire: typeof Module.prototype.require;
    let originalJavaModule: NodeModule | undefined;
    let configuredHome: string | undefined;

    setup(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-java-'));
        configuredHome = undefined;
        sinon.stub(vscode.workspace, 'getConfiguration').callsFake(() => ({ get: () => configuredHome }));
        sinon.stub(axios, 'get').rejects(new Error('Download unavailable'));

        originalRequire = Module.prototype.require;
        originalJavaModule = require.cache[javaModulePath];
        Module.prototype.require = function (id: string) {
            // Isolate Java's unused legacy LSP dependency and bypass other suites'
            // global Java mocks, while exercising the real Configuration getters.
            if (this.filename === javaModulePath && id === '../utils/LanguageServer') {
                return {};
            }
            if (/[\\/]utils[\\/]Configuration\./.test(this.filename) && id === './Java') {
                return java;
            }
            return originalRequire.apply(this, arguments);
        };
        delete require.cache[javaModulePath];
        java = Module._load(javaModulePath, module, false);
    });

    teardown(async () => {
        Module.prototype.require = originalRequire;
        if (originalJavaModule) {
            require.cache[javaModulePath] = originalJavaModule;
        } else {
            delete require.cache[javaModulePath];
        }
        sinon.restore();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    for (const useJavaHome of [true, false]) {
        test(`failed download allows setup to continue using ${useJavaHome ? 'JAVA_HOME' : 'system java'}`, async () => {
            const originalJavaHome = process.env.JAVA_HOME;
            const systemHome = path.join(tempDir, 'system-jdk');
            if (useJavaHome) {
                process.env.JAVA_HOME = systemHome;
            } else {
                delete process.env.JAVA_HOME;
            }

            try {
                await java.setupLocalJavaInstall({ globalStorageUri: { fsPath: tempDir } } as any);

                assert.strictEqual(java.getJavaInstallDir(), null);
                const binary = process.platform === 'win32' ? 'java.exe' : 'java';
                assert.strictEqual(ExtensionConfig.boxlangJavaExecutable,
                    useJavaHome ? path.join(systemHome, 'bin', binary) : binary);
            } finally {
                if (originalJavaHome === undefined) {
                    delete process.env.JAVA_HOME;
                } else {
                    process.env.JAVA_HOME = originalJavaHome;
                }
            }
        });
    }

    test('publishes a successfully installed Java home and reuses it on the next setup', async () => {
        const binary = process.platform === 'win32' ? 'java.exe' : 'java';
        const sourceHome = path.join(tempDir, 'jdk-21');
        await fs.mkdir(path.join(sourceHome, 'bin'), { recursive: true });
        await fs.writeFile(path.join(sourceHome, 'bin', binary), 'downloaded Java', { mode: 0o755 });
        const archive = path.join(tempDir, 'jdk.tar.gz');
        await tar.c({ file: archive, cwd: tempDir, gzip: true }, ['jdk-21']);
        const download = axios.get as sinon.SinonStub;
        download.onFirstCall().resolves({ data: [{ binaries: [{ package: { link: 'https://example.test/jdk.tar.gz' } }] }] });
        download.onSecondCall().resolves({ data: createReadStream(archive) });

        await java.setupLocalJavaInstall({ globalStorageUri: { fsPath: tempDir } } as any);
        const installedHome = path.join(tempDir, 'java_install');
        assert.strictEqual(java.getJavaInstallDir(), installedHome);
        assert.strictEqual(await fs.readFile(ExtensionConfig.boxlangJavaExecutable, 'utf8'), 'downloaded Java');

        await java.setupLocalJavaInstall({ globalStorageUri: { fsPath: tempDir } } as any);
        assert.strictEqual(java.getJavaInstallDir(), installedHome);
        assert.strictEqual(download.callCount, 2, 'second setup must not download again');
    });

    test('preserves the nested installation selected by Download Java', async () => {
        configuredHome = path.join(tempDir, 'java_install', 'jdk-21');
        const executable = path.join(configuredHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
        await fs.mkdir(path.dirname(executable), { recursive: true });
        await fs.writeFile(executable, 'existing Java installation', { mode: 0o755 });

        await java.setupLocalJavaInstall({ globalStorageUri: { fsPath: tempDir } } as any);

        assert.strictEqual(await fs.readFile(executable, 'utf8'), 'existing Java installation');
        assert.strictEqual(ExtensionConfig.boxlangJavaExecutable, executable);
    });
});
