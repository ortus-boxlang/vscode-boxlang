
import path from "path";
import * as vscode from "vscode";
import { BoxLang } from "../utils/BoxLang";

export async function showBoxLangASTGraph() {
    const highlightedText = getHighlightedText();

    if (!highlightedText) {
        vscode.window.showErrorMessage("Select some text in order to visualize a BoxLang AST");
        return;
    }

    try {
        const boxLangAST = await await new BoxLang().getASTJSON(highlightedText);

        // Create and show a new webview
        const panel = vscode.window.createWebviewPanel(
            'boxlang_ast', // Identifies the type of the webview. Used internally
            'BoxLang AST - ' + highlightedText.slice(0, 10) + '...', // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                enableScripts: true
            }
        );
        panel.webview.html = await getWebviewContent(panel, boxLangAST);
    }
    catch (e) {
        vscode.window.showErrorMessage("Unable to get BoxLang AST");
        console.log(e);
    }

}

function getHighlightedText() {
    const editor = vscode.window.activeTextEditor;
    const selection = editor.selection;
    if (selection && !selection.isEmpty) {
        const selectionRange = new vscode.Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character);
        return editor.document.getText(selectionRange);
    }

    return "";
}

async function getWebviewContent(panel, boxLangAST) {
    const styleURI = getWebviewURI(panel, "../../resources/styles.css");
    const graphAppScript = getWebviewURI(panel, "../../resources/graph-app.js");
    const visNetworkScript = getWebviewURI(panel, "../../resources/vis-network.min.js");
    return `
        <html>
            <head>
                <link rel="stylesheet" href="${styleURI}"/>
            </head>
            <body>
                <script type="text/javascript" src="${visNetworkScript}"></script>
                <div id="app">
                    <div id="display-panel">
                    </div>
                </div>
                <script type="text/javascript">window.d = JSON.parse(\`${boxLangAST}\`); console.log("test");</script>
                <script type="text/javascript" src="${graphAppScript}"></script>
            </body>
        </html>
    `;
}

function getWebviewURI(panel, relativePath) {
    const onDiskPath = path.resolve(__dirname, relativePath);
    // vscode.Uri.joinPath(context.extensionUri, 'media', 'resources/cat.gif');

    // And get the special URI to use with the webview
    return panel.webview.asWebviewUri(vscode.Uri.file(onDiskPath));
}