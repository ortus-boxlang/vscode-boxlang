
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BoxLang } from "../../utils/BoxLang";
import { BoxServerConfig, getServerData, getServersThatContainPath, updateServerConfig } from "../../utils/Server";

export async function runServerFromLocation(file: vscode.Uri) {
    const configuredServers = getServersThatContainPath(file);

    if (configuredServers.length === 1) {
        await runServer(configuredServers[0], file.fsPath);
        return;
    }
    else if (configuredServers.length > 1) {
        await promptServerSelectAndRun(configuredServers, file.fsPath);
        return;
    }

    const stats = fs.statSync(file.fsPath);
    let name = path.basename(file.fsPath);
    let directory = file.fsPath;

    if (!stats.isDirectory()) {
        directory = path.dirname(file.fsPath);
        name = path.basename(directory);
    }

    const port = await vscode.window.showInputBox({
        title: "New BoxLang Server",
        prompt: "Enter the port you want to use",
        value: "8080"
    });

    if (port == null || port == "") {
        vscode.window.showErrorMessage(`Could not configure server. You must provide a port value.`);
        return;
    }

    updateServerConfig({
        name,
        directory,
        port: Number.parseInt(port),
        host: "localhost",
        type: "miniserver"
    });

    runServer(getServerData(name), file.fsPath);
}

async function promptServerSelectAndRun(configuredServers: Array<BoxServerConfig>, filePath) {
    const selectedServerName = await vscode.window.showQuickPick(
        configuredServers.map(server => server.name),
        {
            title: "Select the server you want to run"
        }
    );

    if (!selectedServerName) {
        return;
    }

    const server: BoxServerConfig = configuredServers.find(server => server.name === selectedServerName);

    await runServer(server, filePath);
}

async function runServer(server: BoxServerConfig, filePath: string) {
    if (server.status !== "running") {
        await BoxLang.startMiniServer(server);
    }

    vscode.window.showInformationMessage(`Started the server ${server.name}. Opening in browser...`);

    let url = `http://localhost:${server.port}`;

    if (filePath) {
        url += "/" + path.relative(server.directoryAbsolute, filePath);
        url = url.replace(/\\+/g, "/");
    }

    setTimeout(() => {
        vscode.env.openExternal(vscode.Uri.parse(url));
    }, 500);
}

