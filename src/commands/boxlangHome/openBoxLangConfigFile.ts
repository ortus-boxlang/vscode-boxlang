
import * as vscode from "vscode";
import { ConfigTreeItem } from "../../views/ServerHomesView";



export async function openBoxLangConfigFile(item: ConfigTreeItem) {

    if (!(item instanceof ConfigTreeItem)) {
        return;
    }

    vscode.commands.executeCommand("vscode.open", vscode.Uri.file(item.getConfigPath()));
}

