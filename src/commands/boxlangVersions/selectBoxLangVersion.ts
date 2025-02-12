
import vscode, { ExtensionContext } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import { BoxLangVersion, getDownloadedBoxLangVersions } from "../../utils/versionManager";

export async function selectBoxLangVersion(context: ExtensionContext) {
    try {
        const versionToSelect = await pickBoxLangVersion();

        ExtensionConfig.boxlangJarPath = versionToSelect.jarPath;

        vscode.window.showInformationMessage(`BoxLang: Version ${versionToSelect.name} is now the default version`);
    }
    catch (e) {
        vscode.window.showErrorMessage(`Unable to select BoxLang version: ${e.toString()}`);
    }
}

async function pickBoxLangVersion(): Promise<BoxLangVersion> {
    const availableVersions = await getDownloadedBoxLangVersions();
    return new Promise(async (resolve, reject) => {
        const choices = availableVersions
            .map(version => {
                const isDefault = ExtensionConfig.boxlangJarPath === version.jarPath;

                return {
                    label: version.name,
                    description: isDefault ? "Default" : ""
                }
            });

        choices.push({
            label: "Choose local file",
            description: ""
        });

        const picker = vscode.window.createQuickPick();
        picker.title = "Select BoxLang Version";
        picker.items = choices;

        picker.onDidAccept(async () => {
            const selection = picker.activeItems[0]

            if (selection.label === "Choose local file") {
                const filePath = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: "Select BoxLang JAR",
                    canSelectFolders: false,
                    canSelectFiles: true
                });

                if (filePath && filePath[0]) {
                    resolve({
                        lastModified: new Date(),
                        url: "",
                        jarPath: filePath[0].fsPath,
                        name: "Local Version"
                    });
                }
            }
            else {
                resolve(availableVersions.find(v => v.name === selection.label))
            }

            picker.hide()
        })
        picker.show();
    })
}