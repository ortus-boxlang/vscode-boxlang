import { ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs/promises";
import net from "net";
import path from "path";
import * as vscode from "vscode";
import { LanguageClient, ServerOptions } from "vscode-languageclient/node";
import { getExtensionContext } from "../context";
import { startLSPProcess } from "./BoxLang";
import { runCommandBox } from "./CommandBox";
import { ExtensionConfig } from "./Configuration";
import { ModuleManager } from "./ModuleManager";
import { boxlangOutputChannel } from "./OutputChannels";
import { ensureBoxLangVersion } from "./versionManager";


let client: LanguageClient | undefined;
let lspProcess: ChildProcessWithoutNullStreams | null = null;

// Error message constants — centralized for future i18n
const MSG_LSP_VERSION_NOT_CONFIGURED = "boxlang.lsp.lspVersion is not configured. Please set a valid LSP version (e.g., bx-lsp@1.6.0+7).";
const MSG_LSP_INSTALL_INVALID = "BoxLang: The BoxLang Language Server installation is invalid. This may be related to outdated dependencies.";
const MSG_LSP_ENSURE_FAILED = "Unable to ensure BoxLang Language Server module is installed";
const MSG_LSP_INSTALLATION_INVALID = "The BoxLang Language Server installation is invalid.";
const LSP_STOP_TIMEOUT_MS = 10000;
const LSP_PROCESS_EXIT_GRACE_MS = 1000;
const LSP_FORCE_KILL_TIMEOUT_MS = 1000;

function getLSPConfigurationPayload() {
    const boxlangSettings = vscode.workspace.getConfiguration().get<Record<string, unknown>>("boxlang") ?? {};
    const legacyLSPSettings = vscode.workspace.getConfiguration("boxlang.lsp").get<Record<string, unknown>>("") ?? {};

    return {
        settings: {
            boxlang: boxlangSettings,
            ...legacyLSPSettings
        }
    };
}

export async function restart() {
    await stop();
    startLSP();
}

export async function stop() {
    if (!client) {
        return;
    }

    const activeClient = client;
    const processToStop = lspProcess;

    client = undefined;
    lspProcess = null;

    boxlangOutputChannel.appendLine("Shutting down the language server");
    let stoppedGracefully = false;

    try {
        await activeClient.stop(LSP_STOP_TIMEOUT_MS);
        stoppedGracefully = true;
    } catch (error) {
        boxlangOutputChannel.appendLine(`Language server stop failed after ${LSP_STOP_TIMEOUT_MS}ms: ${formatError(error)}`);
    } finally {
        activeClient.dispose();
    }

    if (!processToStop) {
        return;
    }

    if (stoppedGracefully && await waitForProcessExit(processToStop, LSP_PROCESS_EXIT_GRACE_MS)) {
        return;
    }

    await terminateLSPProcess(processToStop, stoppedGracefully ? "" : " after a shutdown failure");
}

async function terminateLSPProcess(process: ChildProcessWithoutNullStreams, reason = ""): Promise<void> {
    if (!isProcessActive(process)) {
        return;
    }

    boxlangOutputChannel.appendLine(`Force-killing LSP process (pid ${process.pid})${reason}`);

    try {
        process.kill();
    } catch (error) {
        boxlangOutputChannel.appendLine(`Failed to signal LSP process (pid ${process.pid}): ${formatError(error)}`);
        return;
    }

    if (await waitForProcessExit(process, LSP_FORCE_KILL_TIMEOUT_MS)) {
        return;
    }

    boxlangOutputChannel.appendLine(`LSP process (pid ${process.pid}) did not exit after SIGTERM, sending SIGKILL`);

    try {
        process.kill("SIGKILL");
        await waitForProcessExit(process, LSP_FORCE_KILL_TIMEOUT_MS);
    } catch (error) {
        boxlangOutputChannel.appendLine(`Failed to force-kill LSP process (pid ${process.pid}): ${formatError(error)}`);
    }
}

function isProcessActive(process: ChildProcessWithoutNullStreams): boolean {
    return process.exitCode === null && process.signalCode === null;
}

function waitForProcessExit(process: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (!isProcessActive(process)) {
        return Promise.resolve(true);
    }

    return new Promise(resolve => {
        const timeoutId = setTimeout(() => {
            cleanup();
            resolve(false);
        }, timeoutMs);

        const onExit = () => {
            cleanup();
            resolve(true);
        };

        const cleanup = () => {
            clearTimeout(timeoutId);
            process.off("exit", onExit);
            process.off("close", onExit);
        };

        process.once("exit", onExit);
        process.once("close", onExit);
    });
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}


export function startLSP() {
    const nextClient = new LanguageClient(
        "boxlang",
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

    client = nextClient;

    nextClient.start().then(() => {
        boxlangOutputChannel.appendLine("The language server was succesfully started");
        nextClient.sendNotification("workspace/didChangeConfiguration", getLSPConfigurationPayload());
    });

    return nextClient;
}

export function notifyConfigurationChanged() {
    const activeClient = client;

    if (!activeClient) {
        return;
    }

    activeClient.sendNotification("workspace/didChangeConfiguration", getLSPConfigurationPayload());
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
        const [proc, port] = await startLanguageServerProcess();
        lspProcess = proc;

        let socket = net.connect(port, "127.0.0.1");
        return {
            writer: socket,
            reader: socket
        };
    };
}

class InvalidLSPInstallationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidLSPInstallationError";
    }
}

/**
 * Initiates the BoxLang Language Server process, ensuring that the necessary LSP module and BoxLang version are installed.
 * @returns A promise that resolves when the language server process has started. The promise returns an array where the first item is the child process and the second item is the port number.
 */
async function startLanguageServerProcess() {
    let lspModulePath = null;

    try {
        lspModulePath = await ensureLSPModule();
    }
    catch (e) {
        if (e instanceof InvalidLSPInstallationError) {
            const choice = await vscode.window.showInformationMessage(MSG_LSP_INSTALL_INVALID,
                "Update",
                "Cancel"
            );

            if (choice != "Update") {
                throw e;
            }

            boxlangOutputChannel.appendLine("Updating commandbox-boxlang module");
            await runCommandBox({}, "install", "commandbox-boxlang", "--force");
            boxlangOutputChannel.appendLine("Attempting to reinstall LSP modules");
            lspModulePath = await ensureLSPModule();
        } else {
            throw e;
        }

    }

    if (!lspModulePath) {
        throw new Error(MSG_LSP_ENSURE_FAILED);
    }

    const boxlangVersionPath = await ensureBoxLangVersion(await getRequiredBoxLangVersion(lspModulePath));
    let lspBoxLangHome = await ensureLSPBoxLangHome();


    await ensureBoxLangModules(lspBoxLangHome);

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

    if (!lspVersion) {
        throw new InvalidLSPInstallationError(MSG_LSP_VERSION_NOT_CONFIGURED);
    }

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

        const contents = await fs.readdir(lspVersionDir); // Just to check if we can read it

        if (contents.length === 0) {
            await fs.rm(lspVersionDir, { recursive: true, force: true })
            throw new Error("LSP version directory is empty");
        }
    }
    catch (e) {
        // Use new ModuleManager with CommandBox fallback
        const moduleManager = new ModuleManager(true);
        await moduleManager.installModuleToDir(lspVersion, lspVersionDir, true);

        try {
            await fs.access(path.join(lspVersionDir, "bx-lsp", "box.json"));
        }
        catch (e) {
            boxlangOutputChannel.appendLine(`Tried to install LSP module but it appears to be invalid: ${lspVersion}`);
            await fs.rm(lspVersionDir, { recursive: true, force: true });
            throw new InvalidLSPInstallationError(MSG_LSP_INSTALLATION_INVALID)
        }

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

    const moduleManager = new ModuleManager(true);

    // Install each module individually
    for (const moduleName of moduleNames) {
        try {
            boxlangOutputChannel.appendLine(`Installing BoxLang module for LSP: ${moduleName}`);
            await moduleManager.installModule(moduleName, lspBoxLangHome, true);
            boxlangOutputChannel.appendLine(`Successfully installed module: ${moduleName}`);
        } catch (error) {
            boxlangOutputChannel.appendLine(`Error installing module ${moduleName}: ${error}`);
        }
    }
}

/**
 * Checks the LSP modules to determine the required BoxLang version. Will allow the user to override with boxlang.lsp.
 * @param lspModulePath The path to the LSP module.
 * @returns The path to the installed LSP module.
 */
async function getRequiredBoxLangVersion(lspModulePath: string): Promise<string> {
    try {
        const configuredVersion = ExtensionConfig.boxLangLSPBoxLangVersion;

        if (!!configuredVersion) {
            boxlangOutputChannel.appendLine("Using configured BoxLang version for LSP module: " + configuredVersion);
            return configuredVersion;
        }

        const boxJSON = await findFirstBoxJson(lspModulePath);
        if (!boxJSON) {
            boxlangOutputChannel.appendLine("No box.json found in LSP module path");
            return "";
        }

        const moduleJson = JSON.parse((await fs.readFile(boxJSON)) + "");

        return moduleJson.boxlang?.minimumVersion || moduleJson.boxlang?.version || "";
    }
    catch (e) {
        boxlangOutputChannel.appendLine("Error reading box.json to determine required BoxLang version for LSP module");
    }

    return "";
}

async function findFirstBoxJson(dir: string): Promise<string | null> {
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