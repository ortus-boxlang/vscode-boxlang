import * as vscode from "vscode";
import { getDebugServerPort, getServerData } from "../../utils/Server";

export async function debugServer({ key }) {
    const serverInfo = getServerData(key);

    if (!serverInfo || serverInfo.debugging == true) {
        vscode.window.showErrorMessage(`There is already an active debug session for ${key}`);
        return;
    }

    const port = getDebugServerPort(key);

    const debugConfig: vscode.DebugConfiguration = {
        name: "BoxLang MiniServer - " + key,
        type: "boxlang",
        request: "attach",
        serverPort: port
    };

    await vscode.debug.startDebugging(null, debugConfig);
}