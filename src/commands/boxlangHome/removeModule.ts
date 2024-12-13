
import fs from "fs";
import * as vscode from "vscode";
import { ModuleTreeItem, notifyServerHomeDataChange } from "../../views/ServerHomesView";

export async function removeModule(item: ModuleTreeItem) {

    if (!(item instanceof ModuleTreeItem)) {
        return;
    }

    const choice = await vscode.window.showWarningMessage(`Are you sure you want to uninstall: ${item.name}`, "Uninstall", "Cancel");

    if (choice !== "Uninstall") {
        return;
    }

    vscode.window.withProgress({
        title: "Uninstalling " + item.name,
        location: vscode.ProgressLocation.Notification,
    }, async () => {

        fs.rmSync(item.directory, { recursive: true, force: true });
        // const res = await uninstallBoxLangModule(item.getRoot().directory, item.name);
        notifyServerHomeDataChange();

        return { increment: 100 }
    });
}

