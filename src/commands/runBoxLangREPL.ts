import * as vscode from "vscode";
import { boxLangLauncher } from "../utils/workspaceSetup";

export async function runBoxLangREPL(context: vscode.ExtensionContext) {
    boxLangLauncher.openREPL();
}