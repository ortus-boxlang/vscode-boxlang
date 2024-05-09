import { readFile } from "node:fs/promises";
import * as vscode from "vscode";

export async function runBoxLangFile(context: vscode.ExtensionContext, filePath) {
    const debugConfig: vscode.DebugConfiguration = {
        name: "BoxLang",
        type: "boxlang",
        request: "launch",
        program: filePath.fsPath
    };

    if (filePath.fsPath.endsWith(".bx") && !(await hasMainFunction(filePath.fsPath))) {
        vscode.window.showErrorMessage("You must implement a main function in order to run a BoxLang class.");
        return;
    }

    if (filePath.fsPath.endsWith(".bx")) {
        const args = await vscode.window.showInputBox({
            title: "Run BoxLang Class",
            prompt: "Enter the arguments to pass to the main class",
            value: context.workspaceState.get("runArgs" + filePath.fsPath)
        });

        context.workspaceState.update("runArgs" + filePath.fsPath, args);
        debugConfig.program += " " + args;
    }

    await vscode.debug.startDebugging(null, debugConfig);
}

async function hasMainFunction(filePath) {
    const content = await readFile(filePath);

    return /function\s+main\(/i.test(content + "");
}
