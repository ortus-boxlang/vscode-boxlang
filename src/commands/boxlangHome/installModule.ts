
import * as vscode from "vscode";
import { installBoxLangModule } from "../../utils/CommandBox";
import { ModulesDirectoryTreeItem, notifyServerHomeDataChange } from "../../views/ServerHomesView";



export async function installModule(modulesDirectory: ModulesDirectoryTreeItem) {

    const name = await vscode.window.showInputBox({
        title: "Install BoxLang Module",
        prompt: "Enter the name of the module you would like to install",
        value: ""
    });

    if (name == null || name == "") {
        vscode.window.showErrorMessage(`Could not install module. You must provide a name value.`);
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

