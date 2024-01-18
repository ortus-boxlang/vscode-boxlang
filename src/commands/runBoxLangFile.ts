import * as vscode from "vscode";

export async function runBoxLangFile(filePath) {
    const debugConfig: vscode.DebugConfiguration = {
        name: "BoxLang",
        type: "boxlang",
        request: "launch",
        program: filePath.fsPath
    };

    await vscode.debug.startDebugging(null, debugConfig);
}