import { ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs/promises";
import net from "net";
import path from "path";
import * as vscode from "vscode";
import { CloseAction, ErrorAction, LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { getExtensionContext } from "../context";
import { startLSPProcess } from "./BoxLang";
import { runCommandBox } from "./CommandBox";
import { ExtensionConfig } from "./Configuration";
import { ModuleManager } from "./ModuleManager";
import { boxlangOutputChannel } from "./OutputChannels";
import { ensureBoxLangVersion } from "./versionManager";


let client: LanguageClient | undefined;
let lspProcess: ChildProcessWithoutNullStreams | null = null;
let isUsingExternalLSP = false;
let lspStartAttempt = 0;
let lspSocketSequence = 0;
let pendingRestartTimer: ReturnType<typeof setTimeout> | undefined;
let resolvePendingRestartDelay: (() => void) | undefined;
let lifecycleOperationChain: Promise<void> = Promise.resolve();
let lifecycleOperationSequence = 0;
const clientStartPromises = new WeakMap<LanguageClient, Promise<void>>();
const externalClientSockets = new WeakMap<LanguageClient, net.Socket>();
const intentionallyClosedClients = new WeakSet<LanguageClient>();
const advertisedServerCommands = new Set<string>();

// Error message constants — centralized for future i18n
const MSG_LSP_VERSION_NOT_CONFIGURED = "boxlang.lsp.lspVersion is not configured. Please set a valid LSP version (e.g., bx-lsp@1.6.0+7).";
const MSG_LSP_INSTALL_INVALID = "BoxLang: The BoxLang Language Server installation is invalid. This may be related to outdated dependencies.";
const MSG_LSP_ENSURE_FAILED = "Unable to ensure BoxLang Language Server module is installed";
const MSG_LSP_INSTALLATION_INVALID = "The BoxLang Language Server installation is invalid.";
const LSP_RESTART_DELAY_MS = 5000;
const LSP_STOP_TIMEOUT_MS = 10000;
const LSP_PROCESS_EXIT_GRACE_MS = 1000;
const LSP_FORCE_KILL_TIMEOUT_MS = 1000;
const CREATE_FORMATTER_CONFIG_COMMAND = "boxlang.createFormatterConfig";
const CREATE_FORMATTER_CONFIG_CONTEXT_KEY = "boxlang.supportsCreateFormatterConfig";
const CONVERT_CFFORMAT_CONFIG_COMMAND = "boxlang.convertCFFormatConfig";
const CONVERT_CFFORMAT_CONFIG_CONTEXT_KEY = "boxlang.supportsConvertCFFormatConfig";

function logLanguageServer(message: string) {
    boxlangOutputChannel.appendLine(`[LSP ${new Date().toISOString()}] ${message}`);
}

function describeLanguageClientState(state: unknown) {
    switch (state) {
        case 1:
            return "stopped";
        case 2:
            return "running";
        case 3:
            return "starting";
        default:
            return String(state ?? "unknown");
    }
}

function attachSocketLogging(socket: net.Socket, label: string) {
    logLanguageServer(`${label}: socket created`);

    socket.on("connect", () => {
        logLanguageServer(
            `${label}: socket connected local=${socket.localAddress ?? "unknown"}:${socket.localPort ?? "unknown"}`
            + ` remote=${socket.remoteAddress ?? "unknown"}:${socket.remotePort ?? "unknown"}`
        );
    });

    socket.on("ready", () => {
        logLanguageServer(`${label}: socket ready`);
    });

    socket.on("end", () => {
        logLanguageServer(`${label}: socket ended bytesRead=${socket.bytesRead} bytesWritten=${socket.bytesWritten}`);
    });

    socket.on("close", (hadError) => {
        logLanguageServer(`${label}: socket closed hadError=${hadError} bytesRead=${socket.bytesRead} bytesWritten=${socket.bytesWritten}`);
    });

    socket.on("error", (error) => {
        logLanguageServer(`${label}: socket error ${formatError(error)}`);
    });
}

async function updateAdvertisedServerCommands(nextClient?: LanguageClient) {
    advertisedServerCommands.clear();

    const advertisedCommands = nextClient?.initializeResult?.capabilities.executeCommandProvider?.commands ?? [];

    for (const commandId of advertisedCommands) {
        advertisedServerCommands.add(commandId);
    }

    if (typeof vscode.commands?.executeCommand !== "function") {
        return;
    }

    try {
        await vscode.commands.executeCommand(
            "setContext",
            CREATE_FORMATTER_CONFIG_CONTEXT_KEY,
            advertisedServerCommands.has(CREATE_FORMATTER_CONFIG_COMMAND)
        );

        await vscode.commands.executeCommand(
            "setContext",
            CONVERT_CFFORMAT_CONFIG_CONTEXT_KEY,
            advertisedServerCommands.has(CONVERT_CFFORMAT_CONFIG_COMMAND)
        );
    } catch (error) {
        boxlangOutputChannel.appendLine(`Unable to update language server command contexts: ${formatError(error)}`);
    }
}

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

function scheduleLifecycleOperation(description: string, operation: () => Promise<void>) {
    const scheduledOperation = lifecycleOperationChain
        .catch(error => {
            logLanguageServer(`Recovered from earlier lifecycle failure before ${description}: ${formatError(error)}`);
        })
        .then(operation);

    lifecycleOperationChain = scheduledOperation.catch(error => {
        logLanguageServer(`${description} failed: ${formatError(error)}`);
    });

    return scheduledOperation;
}

function cancelPendingRestart(reason: string) {
    if (!pendingRestartTimer) {
        return;
    }

    clearTimeout(pendingRestartTimer);
    pendingRestartTimer = undefined;

    const resolve = resolvePendingRestartDelay;
    resolvePendingRestartDelay = undefined;

    logLanguageServer(`Canceled pending restart (${reason})`);
    resolve?.();
}

async function waitForRestartDelay(delayMs: number, reason: string) {
    if (delayMs <= 0) {
        return;
    }

    logLanguageServer(`Scheduling LSP restart in ${delayMs}ms reason=${reason}`);

    await new Promise<void>(resolve => {
        resolvePendingRestartDelay = () => {
            resolvePendingRestartDelay = undefined;
            resolve();
        };

        pendingRestartTimer = setTimeout(() => {
            pendingRestartTimer = undefined;
            const finishDelay = resolvePendingRestartDelay;
            resolvePendingRestartDelay = undefined;
            finishDelay?.();
        }, delayMs);
    });
}

export function requestRestart(reason = "unspecified", delayMs = LSP_RESTART_DELAY_MS): Promise<void> {
    const requestId = ++lifecycleOperationSequence;

    logLanguageServer(`requestRestart() requested id=${requestId} reason=${reason} delayMs=${delayMs}`);
    cancelPendingRestart(`superseded by restart request id=${requestId}`);

    return scheduleLifecycleOperation(`requestRestart(${reason})`, async () => {
        if (requestId !== lifecycleOperationSequence) {
            logLanguageServer(`requestRestart() skipping stale request id=${requestId} before stop`);
            return;
        }

        await stop();

        if (requestId !== lifecycleOperationSequence) {
            logLanguageServer(`requestRestart() skipping stale request id=${requestId} after stop`);
            return;
        }

        await waitForRestartDelay(delayMs, reason);

        if (requestId !== lifecycleOperationSequence) {
            logLanguageServer(`requestRestart() skipping stale request id=${requestId} after delay`);
            return;
        }

        logLanguageServer(`requestRestart() invoking startLSP() id=${requestId}`);
        startLSP();
    });
}

export function restart(reason = "unspecified") {
    return requestRestart(reason, 0);
}

export function shutdown(reason = "unspecified"): Promise<void> {
    const requestId = ++lifecycleOperationSequence;

    logLanguageServer(`shutdown() requested id=${requestId} reason=${reason}`);
    cancelPendingRestart(`shutdown requested: ${reason}`);

    return scheduleLifecycleOperation(`shutdown(${reason})`, async () => {
        logLanguageServer(`shutdown() stopping language server id=${requestId}`);
        await stop();
    });
}

export async function stop() {
    if (!client) {
        logLanguageServer("stop() called with no active client");
        isUsingExternalLSP = false;
        await updateAdvertisedServerCommands();
        return;
    }

    const activeClient = client;
    const processToStop = lspProcess;
    const isExternalLSP = isUsingExternalLSP;

    logLanguageServer(
        `stop() called external=${isExternalLSP} clientState=${describeLanguageClientState((activeClient as LanguageClient & { state?: number }).state)}`
        + ` processPresent=${Boolean(processToStop)}`
    );

    client = undefined;
    lspProcess = null;
    isUsingExternalLSP = false;
    await updateAdvertisedServerCommands();

    if (isExternalLSP) {
        logLanguageServer("Disconnecting from externally managed language server");
        await disconnectExternalClient(activeClient);
        return;
    }

    logLanguageServer("Shutting down the language server");
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

async function disconnectExternalClient(activeClient: LanguageClient) {
    let socket = externalClientSockets.get(activeClient);

    if (!socket) {
        const startPromise = clientStartPromises.get(activeClient);

        if (startPromise) {
            logLanguageServer("disconnectExternalClient() waiting for external client start to settle before disconnect");
            await startPromise.catch(() => undefined);
            socket = externalClientSockets.get(activeClient);
        }
    }

    if (!socket) {
        logLanguageServer("disconnectExternalClient() no external socket was available to close");
        return;
    }

    intentionallyClosedClients.add(activeClient);
    externalClientSockets.delete(activeClient);

    if (socket.destroyed) {
        logLanguageServer("disconnectExternalClient() external socket was already destroyed");
        return;
    }

    logLanguageServer("disconnectExternalClient() destroying external LSP socket");

    await new Promise<void>(resolve => {
        const timeoutId = setTimeout(() => {
            cleanup();
            resolve();
        }, LSP_FORCE_KILL_TIMEOUT_MS);

        const finish = () => {
            cleanup();
            resolve();
        };

        const cleanup = () => {
            clearTimeout(timeoutId);
            socket.off("close", finish);
            socket.off("error", finish);
        };

        socket.once("close", finish);
        socket.once("error", finish);
        socket.destroy();
    });
}


export function startLSP() {
    const activeClient = client;

    if (activeClient) {
        const activeClientState = (activeClient as LanguageClient & { state?: number }).state;

        if (activeClientState === 2 || activeClientState === 3) {
            logLanguageServer(`startLSP() ignored because client is already ${describeLanguageClientState(activeClientState)}`);
            return activeClient;
        }

        logLanguageServer(`startLSP() discarding stale client state=${describeLanguageClientState(activeClientState)}`);
        client = undefined;
    }

    const startRequestId = ++lifecycleOperationSequence;

    cancelPendingRestart(`direct startLSP() call id=${startRequestId}`);
    isUsingExternalLSP = Boolean(process.env.BOXLANG_LSP_PORT);
    const startAttemptId = ++lspStartAttempt;
    logLanguageServer(
        `startLSP() called id=${startRequestId} attempt=${startAttemptId} external=${isUsingExternalLSP}`
        + ` port=${process.env.BOXLANG_LSP_PORT ?? "managed"} existingClient=${Boolean(client)}`
    );

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "boxlang" },
            { scheme: "file", language: "cfml" }
        ]
    };

    let nextClient!: LanguageClient;

    if (isUsingExternalLSP) {
        clientOptions.errorHandler = {
            error: (error) => {
                if (intentionallyClosedClients.has(nextClient)) {
                    return { action: ErrorAction.Continue, handled: true };
                }

                boxlangOutputChannel.appendLine(`External language server connection error: ${formatError(error)}`);
                return { action: ErrorAction.Continue };
            },
            closed: () => {
                if (intentionallyClosedClients.has(nextClient)) {
                    intentionallyClosedClients.delete(nextClient);
                    boxlangOutputChannel.appendLine("External language server connection closed intentionally");
                    return { action: CloseAction.DoNotRestart, handled: true };
                }

                boxlangOutputChannel.appendLine("External language server connection closed; automatic restart is disabled");
                return { action: CloseAction.DoNotRestart };
            }
        };
    }

    nextClient = new LanguageClient(
        "boxlang",
        "BoxLang Language Support",
        getLSPServerConfig(socket => {
            externalClientSockets.set(nextClient, socket);
            socket.once("close", () => {
                if (externalClientSockets.get(nextClient) === socket) {
                    externalClientSockets.delete(nextClient);
                }
            });
        }),
        clientOptions,
        true
    );

    client = nextClient;
    void updateAdvertisedServerCommands();

    const onDidChangeState = (nextClient as LanguageClient & {
        onDidChangeState?: vscode.Event<{ oldState: number; newState: number }>;
    }).onDidChangeState;

    if (onDidChangeState) {
        onDidChangeState((event) => {
            logLanguageServer(
                `client state changed attempt=${startAttemptId} ${describeLanguageClientState(event.oldState)} -> ${describeLanguageClientState(event.newState)}`
            );
        });
    }

    const startPromise = nextClient.start().then(async () => {
        if (client !== nextClient) {
            logLanguageServer(`client.start() resolved for stale client attempt=${startAttemptId}`);
            return;
        }

        await updateAdvertisedServerCommands(nextClient);
        logLanguageServer(`client.start() resolved attempt=${startAttemptId}`);

        try {
            await nextClient.sendNotification("workspace/didChangeConfiguration", getLSPConfigurationPayload());
            logLanguageServer(`Sent initial workspace/didChangeConfiguration notification attempt=${startAttemptId}`);
        } catch (error) {
            logLanguageServer(`Failed to send initial workspace/didChangeConfiguration attempt=${startAttemptId}: ${formatError(error)}`);
        }
    }).catch(async error => {
        logLanguageServer(`client.start() rejected attempt=${startAttemptId}: ${formatError(error)}`);

        if (client === nextClient) {
            client = undefined;
            lspProcess = null;
            isUsingExternalLSP = false;
            await updateAdvertisedServerCommands();
        }
    }).finally(() => {
        clientStartPromises.delete(nextClient);
    });

    clientStartPromises.set(nextClient, startPromise);

    return nextClient;
}

export function getLanguageClient() {
    return client;
}

export function supportsServerCommand(commandId: string) {
    return advertisedServerCommands.has(commandId);
}

export function notifyConfigurationChanged() {
    const activeClient = client;

    if (!activeClient) {
        logLanguageServer("notifyConfigurationChanged() skipped because no client is active");
        return;
    }

    logLanguageServer(
        `notifyConfigurationChanged() sending notification clientState=${describeLanguageClientState((activeClient as LanguageClient & { state?: number }).state)}`
    );

    void activeClient.sendNotification("workspace/didChangeConfiguration", getLSPConfigurationPayload())
        .then(() => {
            logLanguageServer("notifyConfigurationChanged() completed");
        })
        .catch(error => {
            logLanguageServer(`notifyConfigurationChanged() failed: ${formatError(error)}`);
        });
}


export function getLSPServerConfig(onExternalSocket?: (socket: net.Socket) => void): ServerOptions {
    if (process.env.BOXLANG_LSP_PORT) {
        return () => {
            const socketId = ++lspSocketSequence;
            const port = Number.parseInt(process.env.BOXLANG_LSP_PORT, 10);

            logLanguageServer(`Creating external LSP socket connection socketId=${socketId} host=127.0.0.1 port=${port}`);

            let socket = net.connect(port, "127.0.0.1");
            attachSocketLogging(socket, `external socketId=${socketId}`);
            onExternalSocket?.(socket);
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
        const socketId = ++lspSocketSequence;

        logLanguageServer(`Creating managed LSP socket connection socketId=${socketId} pid=${proc.pid} host=127.0.0.1 port=${port}`);

        let socket = net.connect(port, "127.0.0.1");
        attachSocketLogging(socket, `managed socketId=${socketId}`);
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