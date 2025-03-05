import fs from "fs/promises";
import { ExtensionContext } from "vscode";
import * as LSP from "../../utils/LanguageServer";
import { getWorkspaceBoxLangHome, setupWorkspace } from "../../utils/workspaceSetup";

export async function hardResetWorkspaceHome(context: ExtensionContext) {
    await LSP.stop()

    await (async () => new Promise(( resolve ) => setTimeout( resolve, 5000 ) ))();

    await fs.rm( getWorkspaceBoxLangHome(), { force: true, recursive: true } );

    await setupWorkspace( context );

    await LSP.startLSP();
}