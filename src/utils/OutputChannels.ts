import {
    OutputChannel, window
} from "vscode";

function createNoopOutputChannel(): OutputChannel {
    return {
        name: "BoxLang",
        replace() {},
        append() {},
        appendLine() {},
        clear() {},
        show() {},
        hide() {},
        dispose() {}
    };
}

function createOutputChannel(): OutputChannel {
    if (typeof window?.createOutputChannel === "function") {
        return window.createOutputChannel("BoxLang");
    }

    return createNoopOutputChannel();
}

export const boxlangOutputChannel = createOutputChannel();

boxlangOutputChannel.appendLine("BoxLang VSCode Extension");