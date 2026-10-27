import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { boxlangOutputChannel } from "./OutputChannels";


const BOXLANG_SERVER_CONFIG = "boxlang_server.json";
const MINISERVER_CONFIG_GLOB = "**/{miniserver.json,*.miniserver.json}"; // gets any miniserver.json despite app name
const _onDidChangeServerConfiguration: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
export const onDidChangeServerConfiguration: vscode.Event<any> = _onDidChangeServerConfiguration.event;
let servers: Record<string, BoxServerConfig> = {};
let context: vscode.ExtensionContext;

export type BoxServerConfig = { //Sets the vars for the server config
    name: string,
    host: string,
    port: number,
    debugging?: boolean,
    debugPort?: number,
    directory: string,
    directoryAbsolute?: string,
    debugMode: boolean,
    configFile: string,
    serverConfigFile?: string,
    rewrites?: string,
    status?: "running" | "stopped",
    type: "miniserver" | "remote"
}

export function getServersThatContainPath(fileURI: vscode.Uri): Array<BoxServerConfig> {
    return Object.keys(servers)
        .filter((name) => fileURI.fsPath.startsWith(getAbsolutePath(servers[name].directory)))
        .map(name => getServerData(name));
}

export function trackDebugging(name: string) {
    servers[name].debugging = true;
}

export function getAvailableServerNames() {
    return Object.keys(servers);
}

export function getDebugServerPort(name: string) {
    return servers[name].debugPort;
}

export function trackServerStart(name: string, debugPort: number) {
    servers[name].status = "running";
    servers[name].debugPort = debugPort;
    _onDidChangeServerConfiguration.fire(servers);
}

export function trackServerStop(name) {
    servers[name].status = "stopped";
    _onDidChangeServerConfiguration.fire(servers);
}

export function getServerData(name): BoxServerConfig | null {
    if (!servers[name]) {
        return null;
    }

    const data = structuredClone(servers[name]);

    if (!data.directory) {
        data.directory = "./";
    }

    data.directoryAbsolute = getAbsolutePath(data.directory);

    return data;
}

export function deleteServer(name) {
    const serverConfigFile = servers[name]?.serverConfigFile;
    delete servers[name];

    if (serverConfigFile) {
        if (fs.existsSync(serverConfigFile)) {
            fs.unlinkSync(serverConfigFile);
        }
    }
    else {
        persistStoredServerConfigs();
    }

    _onDidChangeServerConfiguration.fire(servers);
}

export async function setupServers(con: vscode.ExtensionContext): Promise<void> {
    context = con;

    if (!fs.existsSync(context.storageUri.fsPath)) {
        fs.mkdirSync(context.storageUri.fsPath, { recursive: true });
    }

    servers = getStoredServerConfigs();
    await refreshServerConfigs();

    const serverConfigWatcher = vscode.workspace.createFileSystemWatcher(MINISERVER_CONFIG_GLOB, false, false, false);
    context.subscriptions.push(serverConfigWatcher);
    serverConfigWatcher.onDidCreate(() => void refreshServerConfigs());
    serverConfigWatcher.onDidChange(() => void refreshServerConfigs());
    serverConfigWatcher.onDidDelete(() => void refreshServerConfigs());

    vscode.debug.onDidStartDebugSession((e) => {
        const matches = /BoxLang MiniServer - (\w+)/.exec(e.name);

        if (!matches?.length || !servers[matches[1]]) {
            return;
        }

        servers[matches[1]].debugging = true;
    });

    vscode.debug.onDidTerminateDebugSession((e) => {
        const matches = /BoxLang MiniServer - (\w+)/.exec(e.name);

        if (!matches?.length || !servers[matches[1]]) {
            return;
        }

        servers[matches[1]].debugging = false;
    });
}

function getStoredServerConfigs(): Record<string, BoxServerConfig> {
    const storedConfigFile = path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG);

    if (!fs.existsSync(storedConfigFile)) {
        return {};
    }

    const storedServers: Record<string, BoxServerConfig> = JSON.parse(fs.readFileSync(storedConfigFile, "utf8"));

    for (const server of Object.values(storedServers)) {
        server.status = "stopped";
        server.debugging = false;
        server.debugMode ??= false;
        server.configFile ??= "";
    }

    return storedServers;
}

// Re-reads optional miniserver.json files; servers stored in workspace storage are kept as-is
async function refreshServerConfigs(): Promise<void> {
    const configFiles = await vscode.workspace.findFiles(MINISERVER_CONFIG_GLOB);
    const refreshedServers: Record<string, BoxServerConfig> = Object.fromEntries(
        Object.entries(servers).filter(([, server]) => !server.serverConfigFile)
    );

    for (const configFile of configFiles) {
        try {
            const server = JSON.parse(fs.readFileSync(configFile.fsPath, "utf8")) as BoxServerConfig;

            if (!server.name || !server.directory) {
                boxlangOutputChannel.appendLine(`BoxLang: Ignoring invalid MiniServer configuration ${configFile.fsPath}`);
                continue;
            }

            server.status = servers[server.name]?.status ?? "stopped";
            server.debugging = servers[server.name]?.debugging ?? false;
            server.debugMode ??= false;
            server.configFile ??= "";
            server.serverConfigFile = configFile.fsPath;
            refreshedServers[server.name] = server;
        }
        catch (error) {
            boxlangOutputChannel.appendLine(`BoxLang: Could not read MiniServer configuration ${configFile.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    servers = refreshedServers;
    _onDidChangeServerConfiguration.fire(servers);
}

export function updateServerProperty(serverName: string, property: string, value: string) {

    if (property === "name") {
        const serverConfig = servers[serverName];
        delete servers[serverName];
        servers[value] = serverConfig;
        servers[value].name = value;
    }
    else if (property === "debugMode") {
        servers[serverName][property] = value.toLowerCase() === "true";
    }
    else if (property === "port") {
        servers[serverName][property] = Number.parseInt(value);
    }
    else {
        servers[serverName][property] = value;
    }


    persistServerConfig(property === "name" ? value : serverName);
    _onDidChangeServerConfiguration.fire(servers);
}

export function updateServerConfig(data: BoxServerConfig) {
    servers[data.name] = data;
    servers[data.name].status = "stopped";

    persistServerConfig(data.name);
    _onDidChangeServerConfiguration.fire(servers);
}

function persistServerConfig(serverName: string) {
    const server = servers[serverName];

    if (server.serverConfigFile) {
        fs.writeFileSync(server.serverConfigFile, JSON.stringify(cleanServerConfig(server), null, 4) + "\n");
        return;
    }

    persistStoredServerConfigs();
}

function persistStoredServerConfigs() {
    const storedServers = Object.fromEntries(
        Object.entries(servers)
            .filter(([, server]) => !server.serverConfigFile)
            .map(([name, server]) => [name, cleanServerConfig(server)])
    );

    fs.writeFileSync(path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG), JSON.stringify(storedServers));
}

function cleanServerConfig(server: BoxServerConfig) {
    return {
        name: server.name,
        host: server.host,
        port: server.port,
        directory: server.directory,
        type: server.type,
        debugMode: server.debugMode,
        configFile: server.configFile,
        ...(server.rewrites == null ? {} : { rewrites: server.rewrites })
    };
}

export function getServerConfigUri(name: string): vscode.Uri | null {
    const serverConfigFile = servers[name]?.serverConfigFile;
    return serverConfigFile ? vscode.Uri.file(serverConfigFile) : null;
}

// Moves a workspace-storage server into a project miniserver.json file
export function exportServerConfig(name: string, serverConfigFile: string) {
    servers[name].serverConfigFile = serverConfigFile;
    persistServerConfig(name);
    persistStoredServerConfigs();
    _onDidChangeServerConfiguration.fire(servers);
}

function getAbsolutePath(filePath: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(workspaceFolder?.uri.fsPath ?? "", filePath);
}
