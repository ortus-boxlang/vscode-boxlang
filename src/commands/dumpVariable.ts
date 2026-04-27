import { debug, window } from "vscode";

/**
 * Dumps the selected text (or word under cursor) in the active editor
 * via a DAP evaluate request. Intended for the editor right-click context menu
 * and the Command Palette.
 */
export async function dumpVariable(): Promise<void> {
    const session = debug.activeDebugSession;
    if ( !session ) {
        window.showErrorMessage( "BoxLang Dump: No active debug session." );
        return;
    }

    const editor = window.activeTextEditor;
    if ( !editor ) {
        window.showErrorMessage( "BoxLang Dump: No active editor." );
        return;
    }

    let expression: string;
    const selection = editor.selection;
    if ( !selection.isEmpty ) {
        expression = editor.document.getText( selection );
    } else {
        const wordRange = editor.document.getWordRangeAtPosition( selection.active );
        if ( !wordRange ) {
            window.showErrorMessage( "BoxLang Dump: Place the cursor on a variable name or select an expression." );
            return;
        }
        expression = editor.document.getText( wordRange );
    }

    await session.customRequest( "evaluate", {
        expression: `writeDump( ${ expression } )`,
        context: "repl"
    } );
}

/**
 * Dumps a variable from the VS Code Variables panel right-click context menu.
 * The `variable` argument is passed by VS Code from the debug/variables/context menu.
 */
export async function dumpVariableFromPanel( variable ): Promise<void> {
    const session = debug.activeDebugSession;
    if ( !session ) {
        window.showErrorMessage( "BoxLang Dump: No active debug session." );
        return;
    }

    if ( !variable?.variable?.evaluateName ) {
        window.showErrorMessage(
            "BoxLang Dump: This variable has no evaluate expression. Use the debug console instead: writeDump( variableName )"
        );
        return;
    }

    await session.customRequest( "evaluate", {
        expression: `writeDump( ${ variable.variable.evaluateName } )`,
        context: "repl"
    } );
}
