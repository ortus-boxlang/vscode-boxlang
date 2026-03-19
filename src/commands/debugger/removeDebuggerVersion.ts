import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import {
    getConfiguredDebuggerVersionSpec,
    getInstalledDebuggerVersionSpecs,
    removeDebuggerVersionSpec
} from "../../utils/DebuggerManager";

async function pickInstalledDebuggerVersionToRemove(): Promise<string> {
    const installedSpecs = await getInstalledDebuggerVersionSpecs(ExtensionConfig.boxlangDebuggerModuleName);

    if (installedSpecs.length === 0) {
        throw new Error("No debugger versions are installed yet");
    }

    return new Promise((resolve) => {
        const picker = vscode.window.createQuickPick();
        picker.title = "Remove BoxLang Debugger Version";
        picker.items = installedSpecs.map(spec => ({ label: spec }));

        picker.onDidAccept(() => {
            const selection = picker.activeItems[0];
            if (selection) {
                resolve(selection.label);
            }
            picker.hide();
        });

        picker.onDidHide(() => {
            picker.dispose();
        });

        picker.show();
    });
}

export async function removeDebuggerVersion(context: ExtensionContext) {
    try {
        const selectedSpec = await pickInstalledDebuggerVersionToRemove();
        const currentSpec = getConfiguredDebuggerVersionSpec();

        if (selectedSpec === currentSpec) {
            vscode.window.showErrorMessage("Cannot remove the currently selected debugger version. Select another debugger version first.");
            return;
        }

        await vscode.window.withProgress(
            { title: `BoxLang: Removing debugger version: ${selectedSpec}`, location: ProgressLocation.Notification },
            async () => {
                await removeDebuggerVersionSpec(selectedSpec);
            }
        );

        vscode.window.showInformationMessage(`BoxLang: Debugger version removed: ${selectedSpec}`);
    } catch (e) {
        vscode.window.showErrorMessage(`Unable to remove debugger version: ${e?.toString?.() || e}`);
    }
}
