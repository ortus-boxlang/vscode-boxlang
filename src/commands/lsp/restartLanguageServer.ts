import vscode from "vscode";
import { startLSP, stop } from "../../utils/LanguageServer";
import { boxlangOutputChannel } from "../../utils/OutputChannels";


export async function restartLSP(){
    try{
        await stop();
        await startLSP();
    }catch ( e ){
        boxlangOutputChannel.appendLine( "Unable to restart LSP" );
        boxlangOutputChannel.appendLine( e );

        vscode.window.showErrorMessage( "Error restarting BoxLang language server" );
        return;
    }

    vscode.window.showInformationMessage( "BoxLang language server has been restarted" );
}