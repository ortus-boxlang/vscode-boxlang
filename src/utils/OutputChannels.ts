import {
    window
} from "vscode";

type OutputChannelLike = {
    append(value: string): void;
    appendLine(value: string): void;
    clear(): void;
    show(preserveFocus?: boolean): void;
    hide(): void;
    dispose(): void;
};

function createNoopOutputChannel(): OutputChannelLike {
    return {
        append() {},
        appendLine() {},
        clear() {},
        show() {},
        hide() {},
        dispose() {}
    };
}

function createOutputChannel(): OutputChannelLike {
    if (typeof window?.createOutputChannel === "function") {
        return window.createOutputChannel("BoxLang");
    }

    return createNoopOutputChannel();
}

export const boxlangOutputChannel = createOutputChannel();

boxlangOutputChannel.appendLine("BoxLang VSCode Extension");