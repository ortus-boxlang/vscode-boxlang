
import path from "path";
import vscode from "vscode";
import { addBoxLangHome as saveBoxLangHome } from "../../views/ServerHomesView";


export async function addBoxLangHome() {

    const dirSelection = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: true,
        canSelectFiles: false,
        title: "Select BoxLang Home"
    });

    if (!dirSelection.length) {
        vscode.window.showWarningMessage("You must select a directory to configure a new BoxLang home");
        return;
    }

    const dir = dirSelection.pop();

    const dirName = path.basename(dir.fsPath);

    const name = await vscode.window.showInputBox({ title: "Enter name of BoxLang Home", value: dirName });

    if (!name) {
        vscode.window.showWarningMessage("You must select a name to configure a new BoxLang home");
        return;
    }

    if (name == "VSCode BoxLang Home" || name == "Default") {
        vscode.window.showErrorMessage("You cannot add a BoxLang Home named: " + name);
        return;
    }

    saveBoxLangHome(name, dir.fsPath);
}

