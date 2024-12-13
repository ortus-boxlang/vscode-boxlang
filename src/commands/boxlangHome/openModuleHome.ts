
import * as vscode from "vscode";
import { ModuleTreeItem } from "../../views/ServerHomesView";



export async function openModuleHomePage(item: ModuleTreeItem) {

    if (!(item instanceof ModuleTreeItem)) {
        return;
    }


    vscode.env.openExternal(vscode.Uri.parse(item.homePage));
}

