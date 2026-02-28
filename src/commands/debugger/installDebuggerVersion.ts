import * as path from "path";
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import {
    getAvailableDebuggerVersions,
    getDebuggerVersionSpec,
    getInstalledDebuggerVersionSpecs,
    installDebuggerVersionSpec
} from "../../utils/DebuggerManager";
import { boxlangOutputChannel } from "../../utils/OutputChannels";

async function pickDebuggerVersion(context: ExtensionContext): Promise<string> {
    const currentSpec = ExtensionConfig.boxlangDebuggerVersionSpec;
    const moduleName = ExtensionConfig.boxlangDebuggerModuleName;
    const installedSpecs = await getInstalledDebuggerVersionSpecs(moduleName);
    const installedSet = new Set(installedSpecs);
    const availableVersions = await getAvailableDebuggerVersions();

    const items: Array<vscode.QuickPickItem & { version: string }> = availableVersions.map(version => {
        const versionSpec = getDebuggerVersionSpec(version);
        const isCurrent = currentSpec === versionSpec;
        const isInstalled = installedSet.has(versionSpec);

        let description = "";
        if (isCurrent) {
            description = "Current";
        } else if (isInstalled) {
            description = "Already Installed";
        }

        return {
            label: version,
            description,
            version
        };
    });

    return new Promise((resolve) => {
        const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { version: string }>();
        picker.title = "Install BoxLang Debugger Version";
        picker.items = items;
        picker.matchOnDescription = true;
        picker.canSelectMany = false;

        picker.onDidAccept(() => {
            const selection = picker.activeItems[0];
            if (selection) {
                resolve(selection.version);
            }
            picker.hide();
        });

        picker.onDidHide(() => {
            picker.dispose();
        });

        picker.show();
    });
}

export async function installDebuggerVersion(context: ExtensionContext) {
    try {
        const version = await vscode.window.withProgress(
            { title: "BoxLang: Fetching debugger versions", location: ProgressLocation.Notification },
            async () => pickDebuggerVersion(context)
        );

        if (!version) {
            return;
        }

        const versionSpec = getDebuggerVersionSpec(version);

        await vscode.window.withProgress(
            { title: `BoxLang: Installing debugger version: ${version}`, location: ProgressLocation.Notification },
            async () => {
                await installDebuggerVersionSpec(versionSpec);
                ExtensionConfig.boxlangDebuggerModuleVersion = version;
            }
        );

        const installPath = path.join(context.globalStorageUri.fsPath, "debuggerVersions", versionSpec);
        boxlangOutputChannel.appendLine(`BoxLang: Debugger version installed to ${installPath}`);
        vscode.window.showInformationMessage(`BoxLang: Debugger updated to ${versionSpec}`);
    } catch (e) {
        boxlangOutputChannel.appendLine("Unable to install debugger version");
        boxlangOutputChannel.appendLine(`${e}`);
        vscode.window.showErrorMessage(`Unable to install debugger version: ${e?.toString?.() || e}`);
    }
}
