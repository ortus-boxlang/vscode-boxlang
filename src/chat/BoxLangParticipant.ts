
import * as chatUtils from '@vscode/chat-extension-utils';
import * as vscode from 'vscode';
import { getBoxLangParticipantPrompt } from '../utils/resourceProvider';

let prompt = ""

async function getPrompt(){
    if( prompt == "" ){
        prompt = await getBoxLangParticipantPrompt()
    }

    return prompt;
}

export const boxLangParticipantHandler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, chatContext: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {
    const tools = vscode.lm.tools.filter(tool => {
        return tool.tags.includes('boxlang')
            || tool.name.includes( "fetch" )
    } );
    const libResult = chatUtils.sendChatParticipantRequest(
        request,
        chatContext,
        {
            prompt: await getPrompt(),
            responseStreamOptions: {
                stream,
                references: true,
                responseText: true
            },
            tools: tools
        },
        token);

    return await libResult.result;
};