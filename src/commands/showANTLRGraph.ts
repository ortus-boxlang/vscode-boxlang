import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as vscode from "vscode";
import { ExtensionConfig } from "../utils/Configuration";
import { appendToOpenDocument } from "../utils/documentUtil";

const path = require('path');

function getHighlightedText() {
    const editor = vscode.window.activeTextEditor;
    const selection = editor.selection;
    if (selection && !selection.isEmpty) {
        const selectionRange = new vscode.Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character);
        return editor.document.getText(selectionRange);
    }

    return "";
}

export async function showANTLRGraph() {
    const highlightedText = getHighlightedText();

    if (!highlightedText) {
        vscode.window.showErrorMessage("Highlight some text in order to show an ANTLR visualization");
        return;
    }

    const antlr = spawnAntler();
    const tokenOutput = [];

    const id = setInterval(async () => {
        for (let i = 0; i < tokenOutput.length; i++) {
            if (tokenOutput[i].done) {
                continue;
            }

            tokenOutput[i].done = true;
            await displayTokenOutput(tokenOutput[i].data);
        }

    }, 250);
    antlr.stdin.write(highlightedText);
    antlr.stdin.end();

    antlr.stdout.on("data", data => {
        tokenOutput.push({ data: data + '', done: false });
        displayTokenOutput(data + '');
    });
    antlr.on("exit", async () => {

    });
    antlr.stderr.on("data", data => console.log(data + ''));

    antlr.on('exit', (code) => {
        if (code) {
            vscode.window.showErrorMessage("Unable to execute antlr4-parse.");
        }

        clearInterval(id);
    });

    antlr.on('error', (err) => {
        if (err.message.includes('ENOENT')) {
            vscode.window.showErrorMessage("Unable to find antlr4-parse. It needs to be installed and available on the path.");
            return;
        }

        vscode.window.showErrorMessage("Unable to execute antlr4-parse. Check the output for more information");
        throw (err);

    });
}

function spawnAntler(): ChildProcessWithoutNullStreams {

    if (ExtensionConfig.customAntlrToolsCommand) {
        const args = JSON.parse(ExtensionConfig.customAntlrToolsCommand);

        return spawn(args[0], args.slice(1));
    }

    const parseArgs = [getPathToLexerFile(), getPathToParserFile(), "script", "-gui"];

    if (getShowLexerTokens()) {
        parseArgs.splice(3, 0, ["-tokens"]);
    }

    return spawn("antlr4-parse", parseArgs);
}

async function displayTokenOutput(output) {
    if (!getShowLexerTokens()) {
        return;
    }

    appendToOpenDocument(vscode.Uri.file('antlr4-parse tokens').with({ scheme: "untitled" }), output);
}

function getShowLexerTokens() {
    return !!vscode.workspace.getConfiguration("boxlang").get<boolean>('showLexerTokens');
}

function getPathToLexerFile() {
    const configPath = vscode.workspace.getConfiguration("boxlang").get<string>('lexerPath');

    return configPath ? configPath : path.resolve(__dirname, '../../resources/CFLexer.g4');
}

function getPathToParserFile() {
    const configPath = vscode.workspace.getConfiguration("boxlang").get<string>('parserPath');

    return configPath ? configPath : path.resolve(__dirname, '../../resources/CFParser.g4');
}
