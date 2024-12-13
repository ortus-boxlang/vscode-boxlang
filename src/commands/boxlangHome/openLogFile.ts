
import * as vscode from "vscode";
import { LogFileTreeItem } from "../../views/ServerHomesView";



export async function openLogFile(item: LogFileTreeItem) {

    if (!(item instanceof LogFileTreeItem)) {
        return;
    }

    vscode.commands.executeCommand("vscode.open", vscode.Uri.file(item.filePath));
}

