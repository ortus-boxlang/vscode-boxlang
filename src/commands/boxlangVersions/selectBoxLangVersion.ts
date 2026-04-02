
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import { BoxLangVersion, getAvailableBoxLangVerions, getDownloadedBoxLangVersions, installVersion } from "../../utils/versionManager";

type PickResult =
    | { version: BoxLangVersion }
    | { jarPath: string; name: string };

const RECENT_VERSION_LIMIT = 10;
const SHOW_ALL_LABEL = "Show older versions...";

export async function selectBoxLangVersion(context: ExtensionContext) {
    try {
        const result = await pickBoxLangVersion(false);

        if (!result) {
            return;
        }

        if ("version" in result) {
            const { version } = result;
            await vscode.window.withProgress(
                { title: `BoxLang: Downloading BoxLang Version: ${version.name}`, location: ProgressLocation.Notification },
                async () => {
                    await installVersion(version);
                }
            );
            const versionNumber = version.name.replace(/^boxlang-/, "");
            ExtensionConfig.clearBoxlangJarPath();
            ExtensionConfig.boxlangVersion = versionNumber;
            vscode.window.showInformationMessage(`BoxLang: Version ${version.name} is now the default version`);
        } else if ("jarPath" in result) {
            // Local file path — explicit jar path takes precedence over version
            ExtensionConfig.boxlangJarPath = result.jarPath;
            vscode.window.showInformationMessage(`BoxLang: Version ${result.name} is now the default version`);
        }
    }
    catch (e) {
        vscode.window.showErrorMessage(`Unable to select BoxLang version: ${e.toString()}`);
    }
}

async function pickBoxLangVersion(showAll: boolean): Promise<PickResult | null> {
    const [availableVersions, downloadedVersions] = await Promise.all([
        getAvailableBoxLangVerions(),
        getDownloadedBoxLangVersions()
    ]);

    const currentJarPath = ExtensionConfig.boxlangJarPath;
    const currentVersion = ExtensionConfig.boxlangVersion;

    // A version is "current" if it matches the configured version string, or if an
    // explicit jar path is set and matches the downloaded jar for that version.
    const isCurrentVersion = (v: { name: string; jarPath?: string }) => {
        const vNum = v.name.replace(/^boxlang-/, "");
        if (currentVersion && vNum === currentVersion) {
            return true;
        }
        if (currentJarPath && v.jarPath === currentJarPath) {
            return true;
        }
        return false;
    };

    const currentDownloaded = downloadedVersions.find(v => isCurrentVersion(v));

    let visibleVersions = availableVersions;
    let hasOlderVersions = false;

    if (!showAll && availableVersions.length > RECENT_VERSION_LIMIT) {
        const recent = availableVersions.slice(0, RECENT_VERSION_LIMIT);
        const currentIsIncluded = !currentDownloaded || recent.some(v => v.name === currentDownloaded.name);

        if (currentIsIncluded) {
            visibleVersions = recent;
        } else {
            // Keep the current version in the list even though it's older
            visibleVersions = [...recent, availableVersions.find(v => v.name === currentDownloaded.name)].filter(Boolean);
        }

        hasOlderVersions = true;
    }

    return new Promise((resolve) => {
        const resultMap = new Map<string, PickResult>();

        const choices: vscode.QuickPickItem[] = [
            { label: "Choose local file", description: "" }
        ];

        if (hasOlderVersions) {
            choices.push({ label: SHOW_ALL_LABEL, description: "" });
        }

        for (const version of visibleVersions) {
            const downloaded = downloadedVersions.find(v => v.name === version.name);
            const isDefault = downloaded && isCurrentVersion(downloaded);
            const isNewerAvailable = downloaded && downloaded.lastModified < version.lastModified;

            let description = "";
            if (isDefault) {
                description = "Default";
            } else if (isNewerAvailable) {
                description = "Update Available";
            } else if (downloaded) {
                description = "Installed";
            }

            choices.push({ label: version.name, description });

            if (downloaded && !isNewerAvailable) {
                resultMap.set(version.name, { version: downloaded });
            } else {
                resultMap.set(version.name, { version });
            }
        }

        const picker = vscode.window.createQuickPick();
        picker.title = "Select BoxLang Version";
        picker.items = choices;

        let accepted = false;

        picker.onDidAccept(async () => {
            accepted = true;
            const selection = picker.activeItems[0];
            picker.hide();

            if (selection.label === "Choose local file") {
                const filePath = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: "Select BoxLang JAR",
                    canSelectFolders: false,
                    canSelectFiles: true
                });

                resolve(filePath?.[0]
                    ? { jarPath: filePath[0].fsPath, name: "Local Version" }
                    : null
                );
            } else if (selection.label === SHOW_ALL_LABEL) {
                resolve(pickBoxLangVersion(true));
            } else {
                resolve(resultMap.get(selection.label) ?? null);
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