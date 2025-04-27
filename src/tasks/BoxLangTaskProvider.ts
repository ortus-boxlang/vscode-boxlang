import * as vscode from "vscode";
import { boxLangLauncher } from "../utils/workspaceSetup";


export const BoxLangTaskProvider: vscode.TaskProvider = {
    provideTasks: async () => {
        const workspaceFolderPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        return [
            new vscode.Task(
                {
                    "type": "boxlang",
                    "command": "compile",
                },
                vscode.TaskScope.Workspace,
                "compile",
                "boxlang",
                boxLangLauncher.shellExecution([
                    "compile",
                    "--basePath", workspaceFolderPath,
                    "--source", workspaceFolderPath,
                    "--target", `${workspaceFolderPath}/bxbuild`
                ])
            ),
            new vscode.Task(
                {
                    "type": "boxlang",
                    "command": "featureAudit",
                },
                vscode.TaskScope.Workspace,
                "featureAudit",
                "boxlang",
                boxLangLauncher.shellExecution([
                    "featureAudit",
                    "--source", workspaceFolderPath,
                    "--reportFile", `${workspaceFolderPath}/bx-feature-audit.csv`
                ])
            )
        ];
    },
    resolveTask: (task: vscode.Task) => {
        return undefined;
    }
}