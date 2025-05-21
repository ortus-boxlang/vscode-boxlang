import * as vscode from "vscode";
import { boxLangParticipantHandler } from "./BoxLangParticipant";
import { IncludeBoxLangDocumentationTool } from "./IncludeBoxLangDocumenationTool";


export function setupChatIntegration( context: vscode.ExtensionContext ){
    registerChatTools( context );

    vscode.chat.createChatParticipant( "boxlang.chat", boxLangParticipantHandler );
}

export function registerChatTools(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.lm.registerTool('boxlang-tools_lookupBoxLangDocumenation', new IncludeBoxLangDocumentationTool())
      );
  }