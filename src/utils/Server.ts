import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";


const BOXLANG_SERVER_CONFIG = "boxlang_server.json";
const _onDidChangeServerConfiguration: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
export const onDidChangeServerConfiguration: vscode.Event<any> = _onDidChangeServerConfiguration.event;
let servers = {};
let context: vscode.ExtensionContext;

export type BoxServerConfig = {
    name: string,
    host: string,
    port: Number,
    directory: string,
    directoryAbsolute?: string,
    status?: "running" | "stopped",
    type: "miniserver" | "remote"
}

export function getAvailableServerNames() {
    return Object.keys(servers);
}

export function trackServerStart(name) {
    servers[name].status = "running";
    _onDidChangeServerConfiguration.fire(servers);
}

export function trackServerStop(name) {
    servers[name].status = "stopped";
    _onDidChangeServerConfiguration.fire(servers);
}

export function getServerData(name): BoxServerConfig | null {
    const data = structuredClone(servers[name]);

    data.directoryAbsolute = path.isAbsolute(data.directory)
        ? data.directory
        : path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, data.directory);

    return data;
}

export function deleteServer(name) {
    delete servers[name];
    fs.writeFileSync(path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG), JSON.stringify(servers));
    _onDidChangeServerConfiguration.fire(servers);
}

export function setupServers(con: vscode.ExtensionContext) {
    context = con;

    servers = getServerConfigs(context);
    _onDidChangeServerConfiguration.fire(servers);

    if (!fs.existsSync(con.storageUri.fsPath)) {
        fs.mkdirSync(con.storageUri.fsPath);
    }
}

function getServerConfigs(context: vscode.ExtensionContext): Record<string, BoxServerConfig> {
    if (!fs.existsSync(path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG))) {
        return {};
    }

    const servers = JSON.parse("" + fs.readFileSync(path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG)));

    for (let key in servers) {
        servers[key].status = "stopped";
    }

    return servers;
}

export function updateServerConfig(data: BoxServerConfig) {
    servers[data.name] = data;
    servers[data.name].status = "stopped";
    fs.writeFileSync(path.join(context.storageUri.fsPath, BOXLANG_SERVER_CONFIG), JSON.stringify(servers));
    _onDidChangeServerConfiguration.fire(servers);
}

