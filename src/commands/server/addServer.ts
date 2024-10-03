
import * as vscode from "vscode";
import { updateServerConfig } from "../../utils/Server";



export async function addServer() {

    const name = await vscode.window.showInputBox({
        title: "New BoxLang Server (1/3)",
        prompt: "Enter the name of your new server",
        value: "MiniServer"
    });

    if (name == null || name == "") {
        vscode.window.showErrorMessage(`Could not configure server. You must provide a name value.`);
        return;
    }

    const directory = await vscode.window.showInputBox({
        title: "New BoxLang Server (2/3)",
        prompt: "Enter a relative path of the directory you want to use",
        value: "./"
    });

    if (directory == null || directory == "") {
        vscode.window.showErrorMessage(`Could not configure server. You must provide a directory value.`);
        return;
    }

    const port = await vscode.window.showInputBox({
        title: "New BoxLang Server (3/3)",
        prompt: "Enter the port you want to use",
        value: "8080"
    });

    if (port == null || port == "") {
        vscode.window.showErrorMessage(`Could not configure server. You must provide a port value.`);
        return;
    }

    updateServerConfig({
        name,
        directory,
        port: Number.parseInt(port),
        host: "localhost",
        type: "miniserver",
        debugMode: false,
        configFile: ""
    });
}

