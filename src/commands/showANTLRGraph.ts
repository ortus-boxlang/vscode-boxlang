import { spawn } from "child_process";
import * as vscode from "vscode";

const path = require('path')

const lexerPath = path.resolve(__dirname, '../../resources/CFLexer.g4');
const parserPath = path.resolve(__dirname, '../../resources/CFParser.g4');

function getHighlightedText() {
    const editor = vscode.window.activeTextEditor;
    const selection = editor.selection;
    if (selection && !selection.isEmpty) {
        const selectionRange = new vscode.Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character);
        return editor.document.getText(selectionRange);
    }

    return "";
}

export function showANTLRGraph() {
    const highligted = getHighlightedText();
    const antlr = spawn("antlr4-parse", [lexerPath, parserPath, "script", "-tokens", "-gui"]);

    antlr.stdin.write(highligted);
    antlr.stdin.end();

    antlr.stdout.on("data", data => console.log(data + ''));
    antlr.stderr.on("data", data => console.log(data + ''));
    console.log(lexerPath);
    console.log(parserPath);
    console.log("running?");
}