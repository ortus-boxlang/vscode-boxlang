import * as path from "path";
import semver from "semver";
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import {
    extractVersionFromSpec,
    getAvailableDebuggerVersions,
    getDebuggerVersionSpec,
    getInstalledDebuggerVersionSpecs,
    installDebuggerVersionSpec
} from "../../utils/DebuggerManager";
import { boxlangOutputChannel } from "../../utils/OutputChannels";

type DebuggerPickResult =
    | { needsInstall: true; version: string; versionSpec: string }
    | { versionSpec: string };

const RECENT_VERSION_LIMIT = 10;
const SHOW_ALL_LABEL = "Show older versions...";

function sortVersionsDescending(versions: string[]): string[] {
    return [...versions].sort((a, b) => {
        try {
            return semver.rcompare(a, b);
        } catch {
            return b.localeCompare(a);
        }
    });
}

async function fetchDebuggerData(): Promise<{ versions: string[]; installedSet: Set<string>; currentSpec: string }> {
    const currentSpec = ExtensionConfig.boxlangDebuggerVersionSpec;
    const moduleName = ExtensionConfig.boxlangDebuggerModuleName;
    const installedSpecs = await getInstalledDebuggerVersionSpecs(moduleName);
    const installedSet = new Set(installedSpecs);
    const versions = sortVersionsDescending(await getAvailableDebuggerVersions());
    return { versions, installedSet, currentSpec };
}

async function pickDebuggerVersion(
    versions: string[],
    installedSet: Set<string>,
    currentSpec: string,
    showAll: boolean
): Promise<DebuggerPickResult | null> {
    let visibleVersions = versions;
    let hasOlderVersions = false;

    if (!showAll && versions.length > RECENT_VERSION_LIMIT) {
        const recent = versions.slice(0, RECENT_VERSION_LIMIT);
        const currentVersion = currentSpec ? extractVersionFromSpec(currentSpec) : "";
        const currentIsRecent = !currentVersion || recent.includes(currentVersion);
        visibleVersions = currentIsRecent ? recent : [...recent, currentVersion].filter(v => versions.includes(v));
        hasOlderVersions = true;
    }

    return new Promise((resolve) => {
        const items: vscode.QuickPickItem[] = [];

        if (hasOlderVersions) {
            items.push({ label: SHOW_ALL_LABEL, description: "" });
        }

        for (const version of visibleVersions) {
            const versionSpec = getDebuggerVersionSpec(version);
            const isCurrent = currentSpec === versionSpec;
            const isInstalled = installedSet.has(versionSpec);

            let description = "";
            if (isCurrent) {
                description = "Current";
            } else if (isInstalled) {
                description = "Installed";
            }

            items.push({ label: version, description });
        }

        const picker = vscode.window.createQuickPick();
        picker.title = "Select BoxLang Debugger Version";
        picker.items = items;
        picker.matchOnDescription = true;

        let accepted = false;

        picker.onDidAccept(() => {
            accepted = true;
            const selection = picker.activeItems[0];
            picker.hide();

            if (selection.label === SHOW_ALL_LABEL) {
                resolve(pickDebuggerVersion(versions, installedSet, currentSpec, true));
            } else {
                const versionSpec = getDebuggerVersionSpec(selection.label);
                if (installedSet.has(versionSpec)) {
                    resolve({ versionSpec });
                } else {
                    resolve({ needsInstall: true, version: selection.label, versionSpec });
                }
            }
        });

        picker.onDidHide(() => {
            if (!accepted) {
                resolve(null);
            }
            picker.dispose();
        });

        picker.show();
    });
}

export async function selectDebuggerVersion(context: ExtensionContext) {
    try {
        const data = await vscode.window.withProgress(
            { title: "BoxLang: Fetching debugger versions", location: ProgressLocation.Notification },
            async () => fetchDebuggerData()
        );

        const result = await pickDebuggerVersion(data.versions, data.installedSet, data.currentSpec, false);

        if (!result) {
            return;
        }

        if ("needsInstall" in result) {
            const { version, versionSpec } = result;
            await vscode.window.withProgress(
                { title: `BoxLang: Installing debugger version: ${version}`, location: ProgressLocation.Notification },
                async () => {
                    await installDebuggerVersionSpec(versionSpec);
                    ExtensionConfig.boxlangDebuggerModuleVersion = version;
                }
            );

            const installPath = path.join(context.globalStorageUri.fsPath, "debuggerVersions", result.versionSpec);
            boxlangOutputChannel.appendLine(`BoxLang: Debugger version installed to ${installPath}`);
        } else {
            ExtensionConfig.boxlangDebuggerModuleVersion = extractVersionFromSpec(result.versionSpec);
        }

        vscode.window.showInformationMessage(`BoxLang: Debugger version ${result.versionSpec} is now selected`);
    } catch (e) {
        boxlangOutputChannel.appendLine("Unable to select debugger version");
        boxlangOutputChannel.appendLine(`${e}`);
        vscode.window.showErrorMessage(`Unable to select debugger version: ${e?.toString?.() || e}`);
    }
}
