import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";


const BOXLANG_SERVER_CONFIG = "boxlang_server.json";
const _onDidChangeServerConfiguration: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
export const onDidChangeServerConfiguration: vscode.Event<any> = _onDidChangeServerConfiguration.event;
let servers: Record<string, BoxServerConfig> = {};
let context: vscode.ExtensionContext;

export type BoxServerConfig = {
    name: string,
    host: string,
    port: Number,
    debugging?: boolean,
    debugPort?: Number,
    directory: string,
    directoryAbsolute?: string,
    debugMode: boolean,
    configFile: string,
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

export function trackServerStart(name: string, debugPort: Number) {
    servers[name].status = "running";
    servers[name].debugPort = debugPort;
    _onDidChangeServerConfiguration.fire(servers);
}

export function trackServerStop(name) {
    servers[name].status = "stopped";
    _onDidChangeServerConfiguration.fire(servers);
}

export function getServerData(name): BoxServerConfig | null {
    const data = structuredClone(servers[name]);

    if (!data.directory) {
        data.directory = "./";
    }

    data.directoryAbsolute = path.isAbsolute(data.directory)
        ? data.directory
        : path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, data.directory);

    return data;
}

export function deleteServer(name) {
    delete servers[name];
    persistCurrentServerConfig();
    _onDidChangeServerConfiguration.fire(servers);
}

export function setupServers(con: vscode.ExtensionContext) {
    context = con;

    servers = getServerConfigs(context);
    _onDidChangeServerConfiguration.fire(servers);

    if (!fs.existsSync(con.storageUri.fsPath)) {
        fs.mkdirSync(con.storageUri.fsPath);
    }

    vscode.debug.onDidStartDebugSession((e) => {
        const matches = /BoxLang MiniServer - (\w+)/.exec(e.name);

        if (!matches.length || !servers[matches[1]]) {
            return;
        }

        servers[matches[1]].debugging = true;
    });

    vscode.debug.onDidTerminateDebugSession((e) => {
        const matches = /BoxLang MiniServer - (\w+)/.exec(e.name);

        if (!matches.length || !servers[matches[1]]) {
            return;
        }

        servers[matches[1]].debugging = false;
    });
}

function getServerConfigs(context: vscode.ExtensionContext): Record<string, BoxServerConfig> {
    if (!fs.existsSync(path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG))) {
        return {};
    }

    const servers = JSON.parse("" + fs.readFileSync(path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG)));

    for (let key in servers) {
        servers[key].status = "stopped";
        servers[key].debugging = false;

        if (!servers[key].hasOwnProperty("debugMode")) {
            servers[key].debugMode = false;
        }

        if (!servers[key].hasOwnProperty("configFile")) {
            servers[key].configFile = "";
        }
    }

    return servers;
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
    else {
        servers[serverName][property] = value;
    }


    persistCurrentServerConfig();
    _onDidChangeServerConfiguration.fire(servers);
}

export function updateServerConfig(data: BoxServerConfig) {
    servers[data.name] = data;
    servers[data.name].status = "stopped";

    persistCurrentServerConfig();
    _onDidChangeServerConfiguration.fire(servers);
}

function persistCurrentServerConfig() {
    const cleanedServerData = Object.keys(servers).reduce((cleaned, serverName) => {
        cleaned[serverName] = {
            name: servers[serverName].name,
            host: servers[serverName].host,
            port: servers[serverName].port,
            directory: servers[serverName].directory,
            type: servers[serverName].type,
            debugMode: servers[serverName].debugMode,
            configFile: servers[serverName].configFile
        };

        return cleaned;
    }, {});

    fs.writeFileSync(path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG), JSON.stringify(cleanedServerData));
}

function getAbsolutePath(filePath: string): string {
    return path.isAbsolute(filePath)
        ? filePath
        : path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, filePath);
}
