
import * as vscode from "vscode";
import { updateServerConfig } from "../../utils/Server";



export async function addServer() {

    const name = await vscode.window.showInputBox({
        title: "New BoxLang Server (1/3)",
        prompt: "Enter the name of your new server",
        value: "MiniServer"
    });

    const directory = await vscode.window.showInputBox({
        title: "New BoxLang Server (2/3)",
        prompt: "Enter a relative path of the directory you want to use",
        value: "./"
    });

    const port = await vscode.window.showInputBox({
        title: "New BoxLang Server (3/3)",
        prompt: "Enter the port you want to use",
        value: "8080"
    });


    updateServerConfig({
        name,
        directory,
        port: Number.parseInt(port),
        host: "localhost",
        type: "miniserver"
    });
}

