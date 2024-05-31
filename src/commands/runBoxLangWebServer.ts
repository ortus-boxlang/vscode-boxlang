import * as vscode from "vscode";
import { getAvailableServerNames } from "../utils/Server";

export async function runBoxLangWebServer(context: vscode.ExtensionContext) {

    let serverNames = getAvailableServerNames();

    if (serverNames.length === 0) {
        await vscode.commands.executeCommand("boxlang.addServer");
        serverNames = getAvailableServerNames();

        if (serverNames.length === 0) {
            return;
        }
    }

    const selectedServer = await vscode.window.showQuickPick(
        serverNames,
        {
            title: "Selct BoxLang Server to Start",
            placeHolder: "Server"
        }
    );

    if (!selectedServer) {
        return;
    }

    vscode.commands.executeCommand("boxlang.runConfiguredServer", { key: selectedServer });
}
