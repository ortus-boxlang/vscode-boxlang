import {
    Disposable,
    ViewColumn,
    WebviewPanel,
    debug,
    window,
    workspace
} from "vscode";

interface DumpEventBody {
    html: string;
    label: string;
    type: string;
    timestamp: string;
}

function resolveViewColumn( setting: string ): ViewColumn {
    switch ( setting ) {
        case "active": return ViewColumn.Active;
        case "one":    return ViewColumn.One;
        case "two":    return ViewColumn.Two;
        case "three":  return ViewColumn.Three;
        case "beside":
        default:       return ViewColumn.Beside;
    }
}

function buildHtml( body: DumpEventBody ): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: https:;">
<style>
  body { margin: 0; padding: 8px; font-family: sans-serif; }
</style>
</head>
<body>
${body.html}
</body>
</html>`;
}

export class DumpManager implements Disposable {
    private readonly _subscription: Disposable;
    private readonly _panels = new Map<string, WebviewPanel>();

    constructor() {
        this._subscription = debug.onDidReceiveDebugSessionCustomEvent( e => {
            if ( e.event === "boxlang.dump" ) {
                this._handleDump( e.body as DumpEventBody );
            }
        } );
    }

    private _handleDump( body: DumpEventBody ): void {
        const config         = workspace.getConfiguration( "boxlang.dump" );
        const panelMode      = config.get<string>( "panelMode", "replace" );
        const panelLocation  = config.get<string>( "panelLocation", "beside" );
        const viewColumn     = resolveViewColumn( panelLocation );

        if ( panelMode === "replace" ) {
            const existing = this._panels.get( "singleton" );
            if ( existing ) {
                existing.reveal( viewColumn );
                existing.webview.html = buildHtml( body );
                existing.title = `Dump: ${ body.label }`;
            } else {
                const panel = this._createPanel( `Dump: ${ body.label }`, viewColumn );
                panel.webview.html = buildHtml( body );
                this._panels.set( "singleton", panel );
                panel.onDidDispose( () => this._panels.delete( "singleton" ) );
            }
        } else {
            // newTab mode — always open a fresh panel
            const key   = `${ body.label }-${ Date.now() }`;
            const panel = this._createPanel( `Dump: ${ body.label }`, viewColumn );
            panel.webview.html = buildHtml( body );
            this._panels.set( key, panel );
            panel.onDidDispose( () => this._panels.delete( key ) );
        }
    }

    private _createPanel( title: string, viewColumn: ViewColumn ): WebviewPanel {
        return window.createWebviewPanel(
            "boxlang.dumpView",
            title,
            { viewColumn, preserveFocus: false },
            { enableScripts: true }
        );
    }

    dispose(): void {
        this._subscription.dispose();
        for ( const panel of this._panels.values() ) {
            panel.dispose();
        }
        this._panels.clear();
    }
}
