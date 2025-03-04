import { randomUUID } from "crypto";
import { ExtensionContext } from "vscode";

import {
    parse,
    stringify
} from 'comment-json';
import fs from "fs/promises";
import path from "path";
import { BoxLangWithHome, getUserProfileBoxLangHome } from "./BoxLang";


const WORKSPACE_ID_KEY = "boxlang_workspace_id";
let workspaceBoxLangHome = "";
export let boxLangLauncher: BoxLangWithHome = null;

export function getWorkspaceBoxLangHome(){
    return workspaceBoxLangHome;
}

export async function setupWorkspace( context: ExtensionContext ){
    boxLangLauncher = new BoxLangWithHome( getUserProfileBoxLangHome() );
}

export async function setupWorkspaceSpecificBoxLangHome( context: ExtensionContext ){
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

        // create boxlang home for workspace
        await boxLangLauncher.getVersionOutput();

        // add global module path
        addGlobalModulePathToConfig( context, workspaceBoxLangHome );
    }
}

async function addGlobalModulePathToConfig( context: ExtensionContext, homePath: string ){
    const configPath = path.join( homePath, "config", "boxlang.json");
    const data: any = parse( (await fs.readFile( configPath )) + "" );

    data.modulesDirectory.push( path.join( getUserProfileBoxLangHome(), "modules" ) );

    await fs.writeFile( configPath, stringify( data, null, 2 ) );
}