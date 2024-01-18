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

export async function showANTLRGraph() {
    const highlightedText = getHighlightedText();

    if (!highlightedText) {
        vscode.window.showErrorMessage("Highlight some text in order to show an ANTLR visualization");
        return;
    }

    const parseArgs = [getPathToLexerFile(), getPathToParserFile(), "script", "-gui"];

    if (getShowLexerTokens()) {
        parseArgs.splice(3, 0, ["-tokens"]);
    }

    const antlr = spawn("antlr4-parse", parseArgs);
    const tokenOutput = [];
    // let closed = false;

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

async function displayTokenOutput(output) {
    if (!getShowLexerTokens()) {
        return;
    }

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file('antlr4-parse tokens').with({ scheme: "untitled" }));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(doc.lineCount + 1, 0), output);
    const result = await vscode.workspace.applyEdit(edit);

    vscode.window.showTextDocument(doc);
}

function getShowLexerTokens() {
    return !!vscode.workspace.getConfiguration("cfml.boxlang").get<boolean>('showLexerTokens');
}

function getPathToLexerFile() {
    const configPath = vscode.workspace.getConfiguration("cfml.boxlang").get<string>('lexerPath');

    return configPath ? configPath : path.resolve(__dirname, '../../resources/CFLexer.g4');
}

function getPathToParserFile() {
    const configPath = vscode.workspace.getConfiguration("cfml.boxlang").get<string>('parserPath');

    return configPath ? configPath : path.resolve(__dirname, '../../resources/CFParser.g4');
}
