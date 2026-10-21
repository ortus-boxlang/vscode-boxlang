import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import mockVSCode from "../mocks/vscode";
import {
    deleteServer,
    getServerData,
    setupServers,
    updateServerConfig,
    updateServerProperty
} from "../../utils/Server";

suite("Server configuration test suite", () => {
    test("writes MiniServer configuration beside its web root and updates the file", () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boxlang-server-"));
        const originalWorkspaceFolders = mockVSCode.workspace.workspaceFolders;

        try {
            mockVSCode.workspace.workspaceFolders = [{ uri: { fsPath: workspaceRoot } }] as any;
            updateServerConfig({
                name: "MiniServer",
                host: "localhost",
                port: 8080,
                directory: "./",
                type: "miniserver",
                debugMode: false,
                configFile: ""
            });

            const configFile = path.join(workspaceRoot, "miniserver.json");
            assert.ok(fs.existsSync(configFile));

            updateServerProperty("MiniServer", "port", "9090");
            assert.strictEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).port, 9090);
            deleteServer("MiniServer");
            assert.ok(!fs.existsSync(configFile));
        }
        finally {
            mockVSCode.workspace.workspaceFolders = originalWorkspaceFolders;
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });

    test("loads an app-named MiniServer configuration from the workspace", async () => {
        const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boxlang-server-"));
        const configFile = path.join(workspaceRoot, "my-app.miniserver.json");
        const workspace = mockVSCode.workspace as any;
        const originalFindFiles = workspace.findFiles;
        const originalCreateFileSystemWatcher = workspace.createFileSystemWatcher;

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
            workspace.findFiles = async () => [{ fsPath: configFile }];
            workspace.createFileSystemWatcher = () => ({
                onDidCreate: () => undefined,
                onDidChange: () => undefined,
                onDidDelete: () => undefined,
                dispose: () => undefined
            });
            await setupServers({ subscriptions: [] } as any);
            assert.strictEqual(getServerData("my-app")?.port, 8080);
        }
        finally {
            deleteServer("my-app");
            workspace.findFiles = originalFindFiles;
            workspace.createFileSystemWatcher = originalCreateFileSystemWatcher;
            fs.rmSync(workspaceRoot, { recursive: true, force: true });
        }
    });
});
