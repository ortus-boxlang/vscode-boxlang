
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { BoxLangVersion, getDownloadedBoxLangVersions, removeVersion } from "../../utils/versionManager";

export async function removeBoxLangVersion(context: ExtensionContext) {
    try {

        const versionToRemove = await pickBoxLangVersion();

        await vscode.window.withProgress(
            { title: `BoxLang: Removing BoxLang Version: ${versionToRemove.name}`, location: ProgressLocation.Notification },
            async () => {
                await removeVersion(versionToRemove);
            }
        );
    }
    catch (e) {
        vscode.window.showErrorMessage(`Unable to remove BoxLang version: ${e.toString()}`);
    }

}
async function pickBoxLangVersion(): Promise<BoxLangVersion> {
    const availableVersions = await getDownloadedBoxLangVersions();
    return new Promise(async (resolve, reject) => {
        const choices = availableVersions
            .map(version => {
                return {
                    label: version.name
                }
            });

        const picker = vscode.window.createQuickPick();
        picker.title = "Remove BoxLang Version";
        picker.items = choices;

        picker.onDidAccept(() => {
            const selection = picker.activeItems[0]
            resolve(availableVersions.find(v => v.name === selection.label))
            picker.hide()
        })
        picker.show();
    })
}