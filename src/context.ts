// src/contextHolder.ts
import * as vscode from 'vscode';

let extensionContext: vscode.ExtensionContext;

export function setExtensionContext(context: vscode.ExtensionContext) {
    extensionContext = context;
}

export function getExtensionContext(): vscode.ExtensionContext {
    if (!extensionContext) {
        throw new Error("Extension context not set!");
    }
    return extensionContext;
}