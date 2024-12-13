import fs from "fs";
import * as vscode from "vscode";
import { ServerHomeRootTreeItem, } from "../../views/ServerHomesView";

export async function clearClassFiles(item: ServerHomeRootTreeItem) {

    if (!(item instanceof ServerHomeRootTreeItem)) {
        return;
    }

    vscode.window.withProgress({
        title: "Clearing class files in: " + item.getClassFileDirectory(),
        location: vscode.ProgressLocation.Notification,
    }, async () => {

        fs.rmSync(item.getClassFileDirectory(), { recursive: true, force: true });

        return { increment: 100 }
    });
}

