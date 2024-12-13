
import * as vscode from "vscode";
import { boxlangModuleCache, installBoxLangModule } from "../../utils/CommandBox";
import { ModulesDirectoryTreeItem, notifyServerHomeDataChange } from "../../views/ServerHomesView";

async function getModuleNameToInstall(installedModules): Promise<string> {
    return new Promise((resolve, reject) => {
        const choices = boxlangModuleCache
            .filter(module => !installedModules.includes(module.slug))
            .map(module => {
                return {
                    label: module.slug,
                    description: module.versions[0].version,
                    detail: module.summary
                }
            });

        const picker = vscode.window.createQuickPick();
        picker.title = "Install BoxLang Module";
        picker.items = choices;

        picker.onDidChangeValue(() => {

            if (!picker.value) {
                picker.items = choices;
                return;
            }

            const matches = choices.filter(choice => choice.label.includes(picker.value));

            if (matches.length) {
                return;
            }

            picker.items = [
                { label: picker.value },
                ...choices
            ]
        })

        picker.onDidAccept(() => {
            const selection = picker.activeItems[0]
            resolve(selection.label)
            picker.hide()
        })
        picker.show();
    })
}

export async function installModule(modulesDirectory: ModulesDirectoryTreeItem) {
    const installedModules = modulesDirectory.modules.map(m => m.name);

    let name = await getModuleNameToInstall(installedModules);

    if (!name) {
        vscode.window.showErrorMessage(`Could not install module. You must provide a valid module name`);
        return;
    }

    vscode.window.withProgress({
        title: "Installing BoxLang module: " + name,
        location: vscode.ProgressLocation.Notification,
    }, async () => {
        await installBoxLangModule(modulesDirectory.getRoot().directory, name);

        notifyServerHomeDataChange();

        return { increment: 100 }
    });
}

