import * as path from "path";
import * as vscode from "vscode";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { ExtensionConfig } from "../utils/Configuration";
import { boxLangLauncher } from "../utils/workspaceSetup";

const CHECKABLE_EXTENSIONS = new Set([".cfc", ".cfm", ".bx", ".bxs", ".bxm"]);
let checkSupport: { runtime: string; supported: boolean | undefined } | undefined;
let unsupportedRuntimeWarning: string | undefined;

export function isCheckableFile(filePath: string): boolean {
    return CHECKABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function runtimeKey(): string {
    return `${ExtensionConfig.boxlangJarPath ?? ""}:${ExtensionConfig.boxlangVersion ?? ""}`;
}

/**
 * Runs the BoxLang syntax checker for a saved source file.
 *
 * Older BoxLang runtimes do not advertise the check action. Detect those
 * runtimes before creating the task so a failed save does not look like a
 * syntax error.
 */
export async function runBoxLangCheck(document: vscode.TextDocument): Promise<void> {
    const filePath = document.uri.fsPath;

    if (document.uri.scheme !== "file" || !isCheckableFile(filePath)) {
        return;
    }

    if (!vscode.workspace.getConfiguration("boxlang", document.uri).get<boolean>("check.enable", false)) {
        return;
    }

    if (!boxLangLauncher) {
        boxlangOutputChannel.appendLine("BoxLang check skipped: the BoxLang launcher is not ready.");
        return;
    }

    const runtime = runtimeKey();
    if (!checkSupport || checkSupport.runtime !== runtime) {
        try {
            checkSupport = {
                runtime,
                supported: await boxLangLauncher.supportsCheck()
            };
        } catch (error) {
            boxlangOutputChannel.appendLine(`BoxLang check support detection failed: ${error instanceof Error ? error.message : String(error)}`);
            boxlangOutputChannel.show(true);
            void vscode.window.showErrorMessage("BoxLang: Unable to determine whether syntax checking is available. See the BoxLang output for details.");
            return;
        }
    }

    if (checkSupport.supported === false) {
        if (unsupportedRuntimeWarning !== runtime) {
            unsupportedRuntimeWarning = runtime;
            void vscode.window.showWarningMessage(
                "BoxLang: The configured runtime does not support `boxlang check`. Update BoxLang to 1.17.0 or later, or disable `boxlang.check.enable`."
            );
        }
        return;
    }

    if (checkSupport.supported !== true) {
        boxlangOutputChannel.appendLine("BoxLang check support could not be determined because the runtime could not be queried.");
        boxlangOutputChannel.show(true);
        void vscode.window.showErrorMessage("BoxLang: Could not verify support for `boxlang check`. See the BoxLang output for details.");
        return;
    }

    try {
        const task = new vscode.Task(
            {
                type: "boxlang",
                command: "check",
                args: [filePath]
            },
            vscode.TaskScope.Workspace,
            "check",
            "boxlang",
            await boxLangLauncher.shellExecution(["check", filePath])
        );
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Always,
            focus: false,
            panel: vscode.TaskPanelKind.Dedicated
        };
        await vscode.tasks.executeTask(task);
    } catch (error) {
        boxlangOutputChannel.appendLine(`BoxLang check failed to start: ${error instanceof Error ? error.message : String(error)}`);
        boxlangOutputChannel.show(true);
        void vscode.window.showErrorMessage("BoxLang: Unable to run the syntax check. See the BoxLang output for details.");
    }
}

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
                await boxLangLauncher.shellExecution([
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
                await boxLangLauncher.shellExecution([
                    "featureAudit",
                    "--source", workspaceFolderPath,
                    "--reportFile", `${workspaceFolderPath}/bx-feature-audit.csv`
                ])
            )
        ] as any;
    },
    resolveTask: (task: vscode.Task) => {
        return undefined;
    }
};
