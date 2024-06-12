import * as vscode from "vscode";
import { BoxLang } from "../../utils/BoxLang";
import { getServerData } from "../../utils/Server";

export async function runConfiguredServer({ key }) {
    const server = getServerData(key);

    if (!server || server.status === "running") {
        return;
    }

    await BoxLang.startMiniServer(server);

    vscode.window.showInformationMessage(`Started the server ${server.name}. Opening in browser...`);

    setTimeout(() => {
        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${server.port}`));
    }, 500);
}
