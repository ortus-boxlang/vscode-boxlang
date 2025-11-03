import * as path from "path";
import { ExtensionContext, Uri, window } from "vscode";
import { runFeatureAudit } from "../utils/FeatureAudit";

export async function openFeatureAuditTool(context: ExtensionContext, file: Uri) {
    // Path to the webview HTML (built by Vite)
    const panel = window.createWebviewPanel(
        "boxlangFeatureAudit",
        "BoxLang FeatureAudit Tool",
        {
            viewColumn: 1,
            preserveFocus: false
        },
        {
            enableScripts: true,
            localResourceRoots: [
                Uri.file(path.join(context.extensionPath, "resources"))
            ]
        }
    );

    const initialState = file ? { sourcePath: file.fsPath } : {};

    panel.webview.html = replaceAssets(
        await getWebView( context, "featureAuditWebView.html" ),
        {
            "ALPINE_JS_URI": panel.webview.asWebviewUri(Uri.file(path.join(context.extensionPath, 'resources', 'webviews', 'alpinejs.js'))).toString(),
            "GLOBAL_STYLES_URI": panel.webview.asWebviewUri(Uri.file(path.join(context.extensionPath, 'resources', 'webviews', 'global.css'))).toString(),
            "INITIAL_STATE_JSON": JSON.stringify( initialState )
        }
    );

    panel.webview.onDidReceiveMessage(async (message) => {
        if( message.command === "ready" ){
            panel.webview.postMessage({ command: 'initialize', state: initialState });
        }
        if (message.command === 'selectFolderPath') {
            const uris = await window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
            if (uris && uris.length > 0) {
                panel.webview.postMessage({ command: 'fileSelected', prop: message.prop, path: uris[0].fsPath });
            }
        }
        if (message.command === 'selectFilePath') {
            const uris = await window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false });
            if (uris && uris.length > 0) {
                panel.webview.postMessage({ command: 'fileSelected', prop: message.prop, path: uris[0].fsPath });
            }
        }

        if( message.command === 'runFeatureAudit') {
            await runFeatureAudit( "1.5.0", message.options );
            panel.webview.postMessage({ command: 'featureAuditComplete', path: message.options.reportPath  });
        }
    });
}


async function getWebView( context: ExtensionContext, webViewName: string ) {
    const htmlPath = path.join(context.extensionPath, "resources","webviews", webViewName );
    return await import("fs/promises").then(fs => fs.readFile(htmlPath, "utf8")).catch(() => `<h1>${webViewName} UI not found. Please build webviews.</h1>`);
}

function replaceAssets( html: string, assets: { [key: string]: string } ): string {
    let replaced = html;
    for ( const key in assets ) {
        const replacer = new RegExp(key, "g");
        replaced = replaced.replace( replacer, assets[key] );
    }
    return replaced;
}
