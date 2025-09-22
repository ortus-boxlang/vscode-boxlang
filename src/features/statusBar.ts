import { ExtensionContext, window } from "vscode";
import { getBvmrcVersion } from "../utils/Configuration";

let statusBarItem = null;

export async function registerStatusBar( context: ExtensionContext ){
    statusBarItem = window.createStatusBarItem("boxlangStatus", 1, 100);
    updateStatusBarText();
    statusBarItem.tooltip = "BoxLang Extension is active";
    statusBarItem.command = "boxlang.showStatusBarCommandPicker";
    statusBarItem.show();

    context.subscriptions.push(statusBarItem);
}

function updateStatusBarText() {
    const bvmrcVersion = getBvmrcVersion();
    if (bvmrcVersion) {
        statusBarItem.text = `$(boxlang-logo) BoxLang ${bvmrcVersion}`;
        statusBarItem.tooltip = `BoxLang Extension (Version from .bvmrc: ${bvmrcVersion})`;
    } else {
        statusBarItem.text = "$(boxlang-logo) BoxLang";
        statusBarItem.tooltip = "BoxLang Extension is active";
    }
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