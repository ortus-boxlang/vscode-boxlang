
import * as vscode from "vscode";
import { ForgeBoxClient, ForgeBoxEntry } from "../../utils/ForgeBoxClient";
import { ModuleManager } from "../../utils/ModuleManager";
import { ModulesDirectoryTreeItem, notifyServerHomeDataChange } from "../../views/ServerHomesView";

async function getModuleNameToInstall(installedModules: string[], availableModules: ForgeBoxEntry[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const choices = availableModules
            .filter(module => !installedModules.includes(module.slug))
            .map(module => {
                return {
                    label: module.slug,
                    description: module.latestVersion?.version || module.versions[0]?.version || "",
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

    const availableModules = await new ForgeBoxClient().listBoxLangModules();
    let name = await getModuleNameToInstall(installedModules, availableModules);

    if (!name) {
        vscode.window.showErrorMessage(`Could not install module. You must provide a valid module name`);
        return;
    }

    await vscode.window.withProgress({
        title: "Installing BoxLang module: " + name,
        location: vscode.ProgressLocation.Notification,
    }, async () => {
        await new ModuleManager(true).installModule(name, modulesDirectory.getRoot().directory);
        notifyServerHomeDataChange();
    });
}

