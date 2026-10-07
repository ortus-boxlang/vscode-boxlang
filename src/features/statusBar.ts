import { ExtensionContext, window } from "vscode";
import { getBvmrcVersion } from "../utils/Configuration";

let statusBarItem = null;
let lspStatus: "Starting" | "Connected" | "Stopped" | "Failed" = "Stopped";

export function setLSPStatus(status: typeof lspStatus) {
    lspStatus = status;
    if (statusBarItem) updateStatusBarText();
}

export async function registerStatusBar( context: ExtensionContext ){
    statusBarItem = window.createStatusBarItem("boxlangStatus", 1, 100);
    updateStatusBarText();
    statusBarItem.command = "boxlang.showStatusBarCommandPicker";
    statusBarItem.show();

    context.subscriptions.push(statusBarItem);
}

function updateStatusBarText() {
    const bvmrcVersion = getBvmrcVersion();
    statusBarItem.tooltip = bvmrcVersion
        ? `BoxLang Extension (Version from .bvmrc: ${bvmrcVersion})`
        : "BoxLang Extension is active";
    const icon = lspStatus === "Starting" ? "$(sync~spin)" : lspStatus === "Failed" ? "$(error)" : "$(boxlang-logo)";
    statusBarItem.text = `${icon} BoxLang: LSP ${lspStatus}`;
    statusBarItem.tooltip += `\nLanguage Server: ${lspStatus}`;
}

export function setDefaultStatusText(){
    updateStatusBarText();
}

export function setLoadingText( text: String ){
    statusBarItem.text = `$(sync~spin) BoxLang: ${text}`;
}

/**
 * Updates the status bar to reflect the current BoxLang version
 */
export function updateVersionDisplay() {
    updateStatusBarText();
}