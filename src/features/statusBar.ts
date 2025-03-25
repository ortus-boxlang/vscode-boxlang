import { ExtensionContext, window } from "vscode";

let statusBarItem = null;

export async function registerStatusBar( context: ExtensionContext ){
    statusBarItem = window.createStatusBarItem("boxlangStatus", 1, 100);
    statusBarItem.text = "$(boxlang-logo) BoxLang Ready";
    statusBarItem.tooltip = "BoxLang Extension is active";
    statusBarItem.command = "boxlang.outputVersionInfo";
    statusBarItem.show();

    context.subscriptions.push(statusBarItem);
}

export function setDefaultStatusText(){

    statusBarItem.text = "$(boxlang-logo) BoxLang Ready";
}

export function setLoadingText( text: String ){
    statusBarItem.text = `$(sync~spin) BoxLang: ${text}`;
}