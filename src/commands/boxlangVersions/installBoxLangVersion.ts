
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { BoxLangVersion, getAvailableBoxLangVerions, getDownloadedBoxLangVersions, installVersion } from "../../utils/versionManager";

export async function installBoxLangVersion(context: ExtensionContext) {
    try {

        const versionToInstall = await pickBoxLangVersion();

        await vscode.window.withProgress(
            { title: `BoxLang: Downloading BoxLang Version: ${versionToInstall.name}`, location: ProgressLocation.Notification },
            async () => {
                await installVersion(versionToInstall);
            }
        );
    }
    catch (e) {
        vscode.window.showErrorMessage(`Unable to install BoxLang version: ${e.toString()}`);
    }

}
async function pickBoxLangVersion(): Promise<BoxLangVersion> {
    const availableVersions = await getAvailableBoxLangVerions();
    const alreadyDownloaded = await getDownloadedBoxLangVersions();

    return new Promise(async (resolve, reject) => {
        const choices = availableVersions
            .map(version => {

                const hasBeenDownloaded = alreadyDownloaded.find(v => v.name === version.name);
                const isNewerAvailable = hasBeenDownloaded && hasBeenDownloaded.lastModified < version.lastModified;

                let description = "";

                if (isNewerAvailable) {
                    description = "Update Available";
                }
                else if (hasBeenDownloaded) {
                    description = "Already Installed";
                }

                return {
                    label: version.name,
                    description
                }
            });

        const picker = vscode.window.createQuickPick();
        picker.title = "Install BoxLang Version";
        picker.items = choices;

        picker.onDidAccept(() => {
            const selection = picker.activeItems[0]
            resolve(availableVersions.find(v => v.name === selection.label))
            picker.hide()
        })
        picker.show();
    })
}