import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import mockVSCode from "../mocks/vscode";
import {
    deleteServer,
    exportServerConfig,
    getServerConfigUri,
    getServerData,
    setupServers,
    updateServerConfig,
    updateServerProperty
} from "../../utils/Server";


function mockWorkspace(configFiles: string[]) {
    const workspace = mockVSCode.workspace as any;
    const originalFindFiles = workspace.findFiles;
    const originalCreateFileSystemWatcher = workspace.createFileSystemWatcher;

    workspace.findFiles = async () => configFiles.map(fsPath => ({ fsPath }));
    workspace.createFileSystemWatcher = () => ({
        onDidCreate: () => undefined,
        onDidChange: () => undefined,
        onDidDelete: () => undefined,
        dispose: () => undefined
    });

    return () => {
        workspace.findFiles = originalFindFiles;
        workspace.createFileSystemWatcher = originalCreateFileSystemWatcher;
    };
}

// Servers created through the UI live in workspace storage; miniserver.json files are an optional extra source
suite("Server configuration test suite", () => {
    test("stores UI-created servers in workspace storage, not the workspace", async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boxlang-server-"));
        const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boxlang-storage-"));
        const originalWorkspaceFolders = mockVSCode.workspace.workspaceFolders;
        const restoreWorkspace = mockWorkspace([]);

        try {
            mockVSCode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot } }] as any;
            await setupServers({ subscriptions: [], storageUri: { fsPath: storageRoot } } as any);
            updateServerConfig({
                name: "MiniServer",
                host: "localhost",
                port: 8080,
                directory: "./",
                type: "miniserver",
                debugMode: false,
                configFile: ""
            });

            const storedConfig = path.join(storageRoot, "boxlang_server.json");
            assert.ok(!fs.existsSync(path.join(workspaceRoot, "miniserver.json")));

            updateServerProperty("MiniServer", "port", "9090");
            assert.strictEqual(JSON.parse(fs.readFileSync(storedConfig, "utf8")).MiniServer.port, 9090);
            deleteServer("MiniServer");
            assert.deepStrictEqual(JSON.parse(fs.readFileSync(storedConfig, "utf8")), {});
        }
        finally {
            restoreWorkspace();
            mockVSCode.workspace.workspaceFolders = originalWorkspaceFolders;
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
            fs.rmSync(storageRoot, { recursive: true, force: true });
        }
    });

    test("exports a stored server into a miniserver.json file", async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boxlang-server-"));
        const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boxlang-storage-"));
        const configFile = path.join(workspaceRoot, "miniserver.json");
        const restoreWorkspace = mockWorkspace([]);

        try {
            await setupServers({ subscriptions: [], storageUri: { fsPath: storageRoot } } as any);
            updateServerConfig({
                name: "exported",
                host: "localhost",
                port: 8080,
                directory: workspaceRoot,
                type: "miniserver",
                debugMode: false,
                configFile: ""
            });

            exportServerConfig("exported", configFile);

            assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).port, 8080);
            assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(storageRoot, "boxlang_server.json"), "utf8")), {});
            assert.strictEqual(getServerConfigUri("exported")?.fsPath, configFile);
        }
        finally {
            deleteServer("exported");
            restoreWorkspace();
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
            fs.rmSync(storageRoot, { recursive: true, force: true });
        }
    });

    test("loads an app-named MiniServer configuration from the workspace", async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boxlang-server-"));
        const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boxlang-storage-"));
        const configFile = path.join(workspaceRoot, "my-app.miniserver.json");
        const restoreWorkspace = mockWorkspace([configFile]);

        try {
            fs.writeFileSync(configFile, JSON.stringify({
                name: "my-app",
                host: "localhost",
                port: 8080,
                directory: workspaceRoot,
                type: "miniserver",
                debugMode: false,
                configFile: ""
            }));
            await setupServers({ subscriptions: [], storageUri: { fsPath: storageRoot } } as any);
            assert.strictEqual(getServerData("my-app")?.port, 8080);

            updateServerProperty("my-app", "port", "9090");
            assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).port, 9090);
            assert.ok(!fs.existsSync(path.join(storageRoot, "boxlang_server.json")));
        }
        finally {
            deleteServer("my-app");
            restoreWorkspace();
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
            fs.rmSync(storageRoot, { recursive: true, force: true });
        }
    });
});
