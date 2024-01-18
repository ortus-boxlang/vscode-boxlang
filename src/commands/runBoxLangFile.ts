import * as vscode from "vscode";

export async function runBoxLangFile(filePath) {
    const debugConfig: vscode.DebugConfiguration = {
        name: "BoxLang",
        type: "boxlang",
        request: "launch",
        program: filePath.fsPath,
        boxlangJar: vscode.workspace.getConfiguration("cfml.boxlang").get<string>('jarpath')
    };

    await vscode.debug.startDebugging(null, debugConfig);
}