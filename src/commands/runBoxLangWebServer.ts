import * as vscode from "vscode";
import { hasRunningWebServer } from "../debug/BoxLangDebugAdapterTracker";
import { ExtensionConfig } from "../utils/Configuration";

export async function runBoxLangWebServer() {

    if (hasRunningWebServer()) {
        vscode.window.showErrorMessage("There is already a BoxLang WebServer running. You may only have one BoxLangServer running at a time.");
        return;
    }

    let webRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

    if (vscode.workspace.workspaceFolders.length > 1) {
        webRoot = await vscode.window.showQuickPick(
            vscode.workspace.workspaceFolders.map(wf => wf.uri.fsPath),
            {
                title: "Initialize BoxLang Development Server",
                placeHolder: "Select a web root"
            }
        );
    }

    if (!webRoot) {
        vscode.window.showErrorMessage("You must select a webroot for the BoxLang server");
        return;
    }

    const webPort = ExtensionConfig.boxlangServerPort;
    const debugConfig: vscode.DebugConfiguration = {
        name: "BoxLang",
        type: "boxlang",
        request: "launch",
        debugType: "local_web",
        webPort: webPort,
        webRoot: webRoot
    };

    await vscode.debug.startDebugging(null, debugConfig);

    setTimeout(() => {
        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${webPort}`));
    }, 300);
}
