import * as vscode from "vscode";
import { getServerConfigUri } from "../../utils/Server";

export async function openServerConfig({ key }) {
    const serverName = key.split(".")[0];
    const configUri = getServerConfigUri(serverName);

    if (configUri) {
        await vscode.window.showTextDocument(configUri);
    }
}
