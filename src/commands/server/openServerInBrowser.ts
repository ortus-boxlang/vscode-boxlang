openServerInBrowser

import * as vscode from "vscode";
import { getServerData } from "../../utils/Server";

export async function openServerInBrowser({ key }) {
    const server = getServerData(key);

    if (!server || server.status === "stopped") {
        return;
    }

    setTimeout(() => {
        vscode.env.openExternal(vscode.Uri.parse(`http://${server.host}:${server.port}`));
    }, 0);
}
