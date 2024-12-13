
import * as vscode from "vscode";
import { ServerHomeRootTreeItem } from "../../views/ServerHomesView";



export async function openBoxLangHome(item: ServerHomeRootTreeItem) {

    if (!(item instanceof ServerHomeRootTreeItem)) {
        return;
    }

    vscode.env.openExternal(vscode.Uri.file(item.directory));
}

