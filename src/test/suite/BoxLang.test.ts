import * as assert from 'assert';
import { EventEmitter } from 'events';
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
    Uri: { file: (p: string) => ({ fsPath: p }), parse: (p: string) => ({ fsPath: p }) },
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

// Track mock processes created by tests
let lastMockProcess: any = null;

function createMockProcess() {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.pid = 12345 + Math.floor(Math.random() * 1000);
    mockProcess.killed = false;
    mockProcess.exitCode = null;
    lastMockProcess = mockProcess;
    return mockProcess;
}

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
    if (id.endsWith('/ProcessTracker') || id === './ProcessTracker') {
        return {
            trackedSpawn: (...args: any[]) => {
                const proc = createMockProcess();
                return proc;
            },
            cleanupTrackedProcesses: () => {}
        };
    }
    return originalRequire.apply(this, arguments);
};

const { ExtensionConfig } = require('../../utils/Configuration');
const { startLSPProcess } = require('../../utils/BoxLang');

suite('BoxLang LSP Process Test Suite', () => {
    setup(() => {
        sinon.stub(ExtensionConfig, 'boxlangJavaExecutable').get(() => 'java');
        sinon.stub(ExtensionConfig, 'boxlangMaxHeapSize').get(() => 512);
        sinon.stub(ExtensionConfig, 'boxlangLSPJVMArgs').get(() => '');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should reject when child process exits before printing port', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.emit('exit', 1);
        }, 10);

        await assert.rejects(
            promise,
            /LSP process exited with code 1 before opening port/
        );
    });

    test('should reject when child process errors before printing port', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.emit('error', new Error('spawn ENOENT'));
        }, 10);

        await assert.rejects(
            promise,
            /LSP process failed to start: spawn ENOENT/
        );
    });

    test('should resolve when child process prints listening port', async () => {
        const promise = startLSPProcess('/mock/home', '/mock/modules', '/mock/boxlang.jar');

        setTimeout(() => {
            lastMockProcess.stdout.emit('data', 'Listening on port: 8080\n');
        }, 10);

        const result = await promise;
        assert.strictEqual(result[0], lastMockProcess);
        assert.strictEqual(result[1], '8080');
    });
});
