import fs from "fs/promises";
import net from "net";
import path from "path";
import * as vscode from "vscode";
import { LanguageClient, ServerOptions } from "vscode-languageclient/node";
import { getExtensionContext } from "../context";
import { startLSPProcess } from "./BoxLang";
import { installBoxLangModuleToDir, installBoxLangModule } from "./CommandBox";
import { ExtensionConfig } from "./Configuration";
import { boxlangOutputChannel } from "./OutputChannels";
import { ensureBoxLangVersion } from "./versionManager";


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
        },
        true
    );

    client.start().then(() => {
        boxlangOutputChannel.appendLine("The language server was succesfully started");
        client.sendNotification("workspace/didChangeConfiguration", { settings: vscode.workspace.getConfiguration("boxlang.lsp") });
    });

    return client;
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
        const [_process, port] = await startLanguageServerProcess();

        let socket = net.connect(port, "127.0.0.1");
        return {
            writer: socket,
            reader: socket
        };
    };
}

/**
 * Initiates the BoxLang Language Server process, ensuring that the necessary LSP module and BoxLang version are installed.
 * @returns A promise that resolves when the language server process has started. The promise returns an array where the first item is the child process and the second item is the port number.
 */
async function startLanguageServerProcess() {
    const lspModulePath = await ensureLSPModule();
    const boxlangVersionPath = await ensureBoxLangVersion( await getRequiredBoxLangVersion( lspModulePath) );
    const lspBoxLangHome =await ensureLSPBoxLangHome();
    await ensureBoxLangModules( lspBoxLangHome);

    return startLSPProcess(
        lspBoxLangHome,
        lspModulePath,
        boxlangVersionPath
    );
}

/**
 * Ensures that the BoxLang Language Server module is installed.
 * @returns The path to the installed LSP module.
 */
async function ensureLSPModule() {
    boxlangOutputChannel.appendLine("Ensuring BoxLang Language Server module is installed");
    const lspVersion = ExtensionConfig.boxlangLSPVersion;
    const context = getExtensionContext();
    const lspVersionParentDir = path.join(context.globalStorageUri.fsPath, "lspVersions");

    try {
        await fs.access(lspVersionParentDir);
        boxlangOutputChannel.appendLine(`LSP versions directory exists: ${lspVersionParentDir}`);
    }
    catch (e) {
        await fs.mkdir(lspVersionParentDir, { recursive: true });
        boxlangOutputChannel.appendLine(`Created LSP versions directory: ${lspVersionParentDir}`);
    }

    const lspVersionDir = path.join(context.globalStorageUri.fsPath, "lspVersions", lspVersion);
    try {
        await fs.access(lspVersionDir);
        boxlangOutputChannel.appendLine(`LSP version directory exists: ${lspVersionDir}`);
    }
    catch (e) {
        await installBoxLangModuleToDir( lspVersion, lspVersionDir );
        boxlangOutputChannel.appendLine(`Installed LSP module to: ${lspVersionDir}`);
    }

    return lspVersionDir;
}

/**
 * Ensures that the BoxLang Language Server BOXLANG_HOME is set.
 * @returns The path to the BOXLANG_HOME directory.
 */
async function ensureLSPBoxLangHome() {
    boxlangOutputChannel.appendLine("Ensuring BoxLang Language Server BOXLANG_HOME");
    const lspBoxLangHome = ExtensionConfig.boxlangLSPBoxLangHome;

    try {
        await fs.access(lspBoxLangHome);
        boxlangOutputChannel.appendLine(`LSP BOXLANG_HOME exists: ${lspBoxLangHome}`);
    }
    catch (e) {
        await fs.mkdir(lspBoxLangHome, { recursive: true });
        await fs.mkdir(path.join(lspBoxLangHome, "modules"), { recursive: true });
        boxlangOutputChannel.appendLine(`Created LSP BOXLANG_HOME directory: ${lspBoxLangHome}`);
    }

    return lspBoxLangHome;
}



async function ensureBoxLangModules(lspBoxLangHome: string) {
    const configuredModules = ExtensionConfig.boxlangLSPModules;

    if (!configuredModules) {
        boxlangOutputChannel.appendLine("No BoxLang modules configured for LSP");
        return;
    }

    // Parse comma-delimited list and filter out empty strings
    const moduleNames = configuredModules
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0);

    if (moduleNames.length === 0) {
        boxlangOutputChannel.appendLine("No valid BoxLang modules configured for LSP");
        return;
    }

    const installDir = path.join(lspBoxLangHome);
    const modulesToInstall = moduleNames.join( ',' );

    try {
        boxlangOutputChannel.appendLine(`Installing BoxLang modules for LSP: ${modulesToInstall}`);
        const result = await installBoxLangModule(installDir, modulesToInstall);

        if (result.code === 0) {
            boxlangOutputChannel.appendLine(`Successfully installed module: ${modulesToInstall} to ${installDir}`);
        } else {
            boxlangOutputChannel.appendLine(`Failed to install module ${modulesToInstall} to ${installDir}: ${result.stderr}`);
            boxlangOutputChannel.appendLine( result.stdout);
        }
    } catch (error) {
        boxlangOutputChannel.appendLine(`Error installing module ${modulesToInstall} to ${installDir}: ${error}`);
    }
}

/**
 * Checks the LSP modules to determine the required BoxLang version. Will allow the user to override with boxlang.lsp.
 * @param lspModulePath The path to the LSP module.
 * @returns The path to the installed LSP module.
 */
async function getRequiredBoxLangVersion( lspModulePath: string ): Promise<string>{
    try{
        const configuredVersion = ExtensionConfig.boxLangLSPBoxLangVersion;

        if( !!configuredVersion ){
            boxlangOutputChannel.appendLine("Using configured BoxLang version for LSP module: " + configuredVersion);
            return configuredVersion;
        }

        const boxJSON = await findFirstBoxJson( lspModulePath );
        const moduleJson = JSON.parse( (await fs.readFile( boxJSON )) + "" );

        return moduleJson.boxlang.minimumVersion;
    }
    catch( e ){
        boxlangOutputChannel.appendLine("Error reading box.json to determine required BoxLang version for LSP module");
    }

    return "";
}

export async function findFirstBoxJson(dir: string): Promise<string | null> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === "box.json") {
            return fullPath;
        }
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const found = await findFirstBoxJson(path.join(dir, entry.name));
            if (found) return found;
        }
    }
    return null;
}