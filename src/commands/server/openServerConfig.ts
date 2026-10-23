import * as vscode from "vscode";
import { getServerConfigUri } from "../../utils/Server"; //Gets the server config from Server.ts

export async function openServerConfig({ key }) {
    const serverName = key.split(".")[0];
    const configUri = getServerConfigUri(serverName);

    if (configUri) { // Tries to get the server name and see if it exists to properly open it
        await vscode.window.showTextDocument(configUri);
    }
}
