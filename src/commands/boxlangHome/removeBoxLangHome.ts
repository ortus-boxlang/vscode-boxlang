
import vscode from "vscode";
import { InvalidServerHomeRootTreeItem, ServerHomeRootTreeItem, removeBoxLangHome as _removeBoxLangHome } from "../../views/ServerHomesView";


export async function removeBoxLangHome(item: InvalidServerHomeRootTreeItem | ServerHomeRootTreeItem) {

    if (!item || !item.label) {
        return;
    }

    // @ts-ignore
    const name = typeof item.label == "string" ? item.label : item.label.label ;

    if (name == "VSCode BoxLang Home" || name == "Default") {
        vscode.window.showErrorMessage("You cannot remove the BoxLang Home named: " + name);
        return;
    }

    const choice = await vscode.window.showWarningMessage(`Are you sure you want to remove: ${name}?`, "Remove", "Cancel");

    if (choice !== "Remove") {
        return;
    }

    _removeBoxLangHome(name);
}

