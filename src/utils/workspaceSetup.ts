import { randomUUID } from "crypto";
import { ExtensionContext } from "vscode";

import fs from "fs/promises";
import path from "path";
import { BoxLangWithHome } from "./BoxLang";


const WORKSPACE_ID_KEY = "boxlang_workspace_id";
let workspaceBoxLangHome = "";
export let boxLangLauncher = null;

export function getWorkspaceBoxLangHome(){
    return workspaceBoxLangHome;
}

export async function setupWorkspace( context: ExtensionContext ){
    if( !context.workspaceState.get( WORKSPACE_ID_KEY ) ){
        context.workspaceState.update( WORKSPACE_ID_KEY, randomUUID() );
    }

    const id : string = context.workspaceState.get( WORKSPACE_ID_KEY );
    workspaceBoxLangHome = path.join(context.globalStorageUri.fsPath, "workspace_homes", id );

    boxLangLauncher = new BoxLangWithHome( workspaceBoxLangHome );

    try {
        await fs.access(workspaceBoxLangHome);
    }
    catch (e) {
        fs.mkdir(workspaceBoxLangHome, { recursive: true });
        await boxLangLauncher.getVersionOutput();
    }



    // setup boxlang home
    // install lsp module
        // copy from root
        // or install from forgebox
    // start lsp
}