import * as fs from "fs";
import * as vscode from "vscode";

export async function runBoxLangFile(context: vscode.ExtensionContext, filePath) {
    const fsPath = determineFile(filePath);
    const debugConfig: vscode.DebugConfiguration = {
        name: "BoxLang",
        type: "boxlang",
        request: "launch",
        program: fsPath
    };

    if (fsPath.endsWith(".bx") && !(await hasMainFunction(fsPath))) {
        vscode.window.showErrorMessage("You must implement a main function in order to run a BoxLang class.");
        return;
    }

    if (fsPath.endsWith(".bx")) {
        const args = await vscode.window.showInputBox({
            title: "Run BoxLang Class",
            prompt: "Enter the arguments to pass to the main class",
            value: context.workspaceState.get("runArgs" + fsPath)
        });

        context.workspaceState.update("runArgs" + fsPath, args);
        debugConfig.program += " " + args;
    }

    await vscode.debug.startDebugging(null, debugConfig);
}

async function hasMainFunction(filePath) {
    const content = await fs.readFileSync(filePath);

    return /function\s+main\(/i.test(content + "");
}

function determineFile(filePath) {
    if (filePath != null) {
        return filePath.fsPath;
    }

    return vscode.window.activeTextEditor.document.uri.fsPath;
}