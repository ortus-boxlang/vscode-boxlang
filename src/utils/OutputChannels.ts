import {
    window
} from "vscode";

export const boxlangOutputChannel = window.createOutputChannel("BoxLang");

boxlangOutputChannel.appendLine("BoxLang VSCode Extension");