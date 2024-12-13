
import * as vscode from "vscode";
import { boxlangModuleCache, installBoxLangModule } from "../../utils/CommandBox";
import { ModulesDirectoryTreeItem, notifyServerHomeDataChange } from "../../views/ServerHomesView";



export async function installModule(modulesDirectory: ModulesDirectoryTreeItem) {
    const installedModules = modulesDirectory.modules.map(m => m.name);

    let name = "";

    if (boxlangModuleCache.length === 0) {
        name = await vscode.window.showInputBox({
            title: "Install BoxLang Module",
            prompt: "Enter the name of the module you would like to install",
            value: ""
        });
    }
    else {
        const pick = await vscode.window.showQuickPick(
            boxlangModuleCache
                .filter(module => !installedModules.includes(module.slug))
                .map(module => {
                    return {
                        label: module.slug,
                        description: module.versions[0].version,
                        detail: module.summary
                    }
                }),
            {
                title: "Install BoxLang Module"
            }

        )

        name = pick && pick.label;
    }





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

