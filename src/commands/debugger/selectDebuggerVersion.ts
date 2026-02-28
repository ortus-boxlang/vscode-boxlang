import vscode, { ExtensionContext } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import {
    extractVersionFromSpec,
    getConfiguredDebuggerVersionSpec,
    getInstalledDebuggerVersionSpecs
} from "../../utils/DebuggerManager";

async function pickInstalledDebuggerVersion(): Promise<string> {
    const moduleName = ExtensionConfig.boxlangDebuggerModuleName;
    const currentSpec = getConfiguredDebuggerVersionSpec();
    const installedSpecs = await getInstalledDebuggerVersionSpecs(moduleName);

    if (installedSpecs.length === 0) {
        throw new Error("No debugger versions are installed yet");
    }

    return new Promise((resolve) => {
        const picker = vscode.window.createQuickPick();
        picker.title = "Select BoxLang Debugger Version";
        picker.items = installedSpecs.map(spec => ({
            label: spec,
            description: spec === currentSpec ? "Current" : ""
        }));

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

export async function selectDebuggerVersion(context: ExtensionContext) {
    try {
        const selectedSpec = await pickInstalledDebuggerVersion();
        const selectedVersion = extractVersionFromSpec(selectedSpec);

        ExtensionConfig.boxlangDebuggerModuleVersion = selectedVersion;

        vscode.window.showInformationMessage(`BoxLang: Debugger version ${selectedSpec} is now selected`);
    } catch (e) {
        vscode.window.showErrorMessage(`Unable to select debugger version: ${e?.toString?.() || e}`);
    }
}
