import net from "net";
import vscode from "vscode";
import { LanguageClient, ServerOptions } from "vscode-languageclient/node";
import { boxlangOutputChannel } from "./OutputChannels";
import { boxLangLauncher } from "./workspaceSetup";


let client: LanguageClient;

export async function restart(){
    await stop();
    startLSP();
}

export async function stop() {
    if (!client) {
        return;
    }

    boxlangOutputChannel.appendLine("Shutting down the language server");
    return client.stop();
}


export function startLSP() {
    client = new LanguageClient(
        "BoxLang Language Support",
        getLSPServerConfig(),
        {
            documentSelector: [
                { scheme: "file", language: "boxlang" },
                { scheme: "file", language: "cfml" }
            ]
        }
    );


    client.start().then(() => {
        boxlangOutputChannel.appendLine("The language server was succesfully started");
        client.sendRequest("boxlang/changesettings", vscode.workspace.getConfiguration("boxlang.lsp"));
    });
}


export function getLSPServerConfig(): ServerOptions {
    if (process.env.BOXLANG_LSP_PORT) {
        return () => {
            let socket = net.connect(Number.parseInt(process.env.BOXLANG_LSP_PORT), "127.0.0.1");
            let result = {
                writer: socket,
                reader: socket
            };

            return Promise.resolve(result);
        };
    }

    return async () => {
        const [_process, port] = await boxLangLauncher.startLSP();

        let socket = net.connect(port, "127.0.0.1");
        return {
            writer: socket,
            reader: socket
        };
    };
}