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
let queuedStartPromise: Promise<LanguageClient | undefined> | undefined;
const clientStartPromises = new WeakMap<LanguageClient, Promise<void>>();
const clientStartControllers = new WeakMap<LanguageClient, AbortController>();
const clientSockets = new WeakMap<LanguageClient, net.Socket>();
const managedClientProcesses = new WeakMap<LanguageClient, ChildProcessWithoutNullStreams>();
const intentionallyClosedClients = new WeakSet<LanguageClient>();
const intentionallyStoppedProcesses = new WeakSet<ChildProcessWithoutNullStreams>();
const advertisedServerCommands = new Set<string>();
let automaticRestartTimes: number[] = [];

// Error message constants — centralized for future i18n
const MSG_LSP_VERSION_NOT_CONFIGURED = "boxlang.lsp.lspVersion is not configured. Please set a valid LSP version (e.g., bx-lsp@1.6.0+7).";
const MSG_LSP_INSTALL_INVALID = "BoxLang: The BoxLang Language Server installation is invalid. This may be related to outdated dependencies.";
const MSG_LSP_ENSURE_FAILED = "Unable to ensure BoxLang Language Server module is installed";
const MSG_LSP_INSTALLATION_INVALID = "The BoxLang Language Server installation is invalid.";
const LSP_RESTART_DELAY_MS = 5000;
const LSP_STOP_TIMEOUT_MS = 10000;
const LSP_PROCESS_EXIT_GRACE_MS = 1000;
const LSP_FORCE_KILL_TIMEOUT_MS = 1000;
const LSP_SOCKET_CONNECT_TIMEOUT_MS = 5000;
const LSP_SOCKET_RETRY_DELAYS_MS = [100, 250, 500, 1000];
const LSP_AUTOMATIC_RESTART_LIMIT = 3;
const LSP_AUTOMATIC_RESTART_WINDOW_MS = 3 * 60 * 1000;
const MANAGED_LSP_PID_FILE = "managed-lsp.pid";
const CREATE_FORMATTER_CONFIG_COMMAND = "boxlang.createFormatterConfig";
const CREATE_FORMATTER_CONFIG_CONTEXT_KEY = "boxlang.supportsCreateFormatterConfig";
const CONVERT_CFFORMAT_CONFIG_COMMAND = "boxlang.convertCFFormatConfig";
const CONVERT_CFFORMAT_CONFIG_CONTEXT_KEY = "boxlang.supportsConvertCFFormatConfig";

class BoxLangLanguageClient extends LanguageClient {
    error(message: string, data?: any, showNotification: boolean | 'force' = true): void {
        // The library's start() error path bypasses errorHandler.handled.
        super.error(message, data, intentionallyClosedClients.has(this) ? false : showNotification);
    }
}

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

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error("Operation aborted"));
            return;
        }

        let settled = false;
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            resolve();
        }, delayMs);
        const onAbort = () => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timer);
            cleanup();
            reject(signal?.reason ?? new Error("Operation aborted"));
        };

        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function connectSocket(port: number, label: string, onSocket?: (socket: net.Socket) => void, signal?: AbortSignal): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const socket = net.connect({ port, host: "127.0.0.1", signal });
        attachSocketLogging(socket, label);
        onSocket?.(socket);

        let settled = false;
        let connected = false;
        const timeoutId = setTimeout(() => {
            finish(new Error(`Timed out connecting to 127.0.0.1:${port}`));
        }, LSP_SOCKET_CONNECT_TIMEOUT_MS);

        const cleanup = () => {
            clearTimeout(timeoutId);
            socket.off("connect", onConnect);
            socket.off("error", onError);
            socket.off("close", onClose);
        };

        const finish = (error?: Error) => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();

            if (error) {
                socket.destroy();
                reject(error);
            } else {
                resolve(socket);
            }
        };

        const onConnect = () => {
            connected = true;
            finish();
        };
        const onError = (error: Error) => finish(error);
        const onClose = () => {
            if (!connected) {
                finish(new Error("Socket closed before connecting"));
            }
        };

        socket.once("connect", onConnect);
        socket.once("error", onError);
        socket.once("close", onClose);
    });
}

async function connectToLSP(
    port: number,
    label: string,
    onSocket?: (socket: net.Socket) => void,
    shouldAbort?: () => boolean,
    maxAttempts = LSP_SOCKET_RETRY_DELAYS_MS.length + 1,
    signal?: AbortSignal
): Promise<net.Socket> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        signal?.throwIfAborted();
        if (shouldAbort?.()) {
            throw new Error(`${label}: connection canceled`);
        }

        try {
            logLanguageServer(`${label}: connecting attempt=${attempt} port=${port}`);
            return await connectSocket(port, `${label} attempt=${attempt}`, onSocket, signal);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            logLanguageServer(`${label}: connection attempt=${attempt} failed: ${lastError.message}`);

            signal?.throwIfAborted();
            if (shouldAbort?.()) {
                throw lastError;
            }

            const retryDelay = LSP_SOCKET_RETRY_DELAYS_MS[attempt - 1];
            if (retryDelay !== undefined) {
                await wait(retryDelay, signal);
            }
        }
    }

    throw lastError ?? new Error(`Unable to connect to language server on port ${port}`);
}

function canAutomaticallyRestart(): boolean {
    const cutoff = Date.now() - LSP_AUTOMATIC_RESTART_WINDOW_MS;
    automaticRestartTimes = automaticRestartTimes.filter(timestamp => timestamp >= cutoff);

    if (automaticRestartTimes.length >= LSP_AUTOMATIC_RESTART_LIMIT) {
        return false;
    }

    automaticRestartTimes.push(Date.now());
    return true;
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

function scheduleLifecycleOperation<T>(description: string, operation: () => Promise<T>) {
    const scheduledOperation = lifecycleOperationChain
        .catch(error => {
            logLanguageServer(`Recovered from earlier lifecycle failure before ${description}: ${formatError(error)}`);
        })
        .then(operation);

    lifecycleOperationChain = scheduledOperation.then(() => undefined, error => {
        logLanguageServer(`${description} failed: ${formatError(error)}`);
    });

    return scheduledOperation;
}

function cancelQueuedStart(reason: string) {
    if (!queuedStartPromise) {
        return;
    }

    logLanguageServer(`Canceling queued start (${reason})`);
    queuedStartPromise = undefined;
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

function cancelStartingClient() {
    if (!client || client.state !== 3) {
        return;
    }

    // client.stop() cannot stop initialization. Abort the JVM launch (if still
    // pending) and close the transport so client.start() releases the queue.
    intentionallyClosedClients.add(client);
    const process = managedClientProcesses.get(client);
    if (process) {
        intentionallyStoppedProcesses.add(process);
    }
    clientStartControllers.get(client)?.abort();
    clientSockets.get(client)?.destroy();
}

export function requestRestart(
    reason = "unspecified",
    delayMs = LSP_RESTART_DELAY_MS,
    beforeStart?: () => void | Promise<void>
): Promise<void> {
    if (!reason.startsWith("automatic recovery")) {
        automaticRestartTimes = [];
    }

    const requestId = ++lifecycleOperationSequence;

    logLanguageServer(`requestRestart() requested id=${requestId} reason=${reason} delayMs=${delayMs}`);
    cancelPendingRestart(`superseded by restart request id=${requestId}`);
    cancelQueuedStart(`superseded by restart request id=${requestId}`);
    cancelStartingClient();

    return scheduleLifecycleOperation(`requestRestart(${reason})`, async () => {
        if (requestId !== lifecycleOperationSequence) {
            logLanguageServer(`requestRestart() skipping stale request id=${requestId} before stop`);
            return;
        }

        await stop();

        if (requestId !== lifecycleOperationSequence) {
            logLanguageServer(`requestRestart() skipping stale request id=${requestId} before cleanup`);
            return;
        }

        await beforeStart?.();

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
        await startLSPNow(requestId, `restart:${reason}`);
    });
}

export function restart(reason = "unspecified") {
    return requestRestart(reason, 0);
}

export function shutdown(reason = "unspecified"): Promise<void> {
    const requestId = ++lifecycleOperationSequence;

    logLanguageServer(`shutdown() requested id=${requestId} reason=${reason}`);
    cancelPendingRestart(`shutdown requested: ${reason}`);
    cancelQueuedStart(`shutdown requested: ${reason}`);
    cancelStartingClient();

    return scheduleLifecycleOperation(`shutdown(${reason})`, async () => {
        logLanguageServer(`shutdown() stopping language server id=${requestId}`);
        await stop();
    });
}

export async function stop() {
    cancelStartingClient();
    if (!client) {
        const processToStop = lspProcess;
        lspProcess = null;
        isUsingExternalLSP = false;
        logLanguageServer(`stop() called with no active client processPresent=${Boolean(processToStop)}`);
        await updateAdvertisedServerCommands();

        if (processToStop) {
            intentionallyStoppedProcesses.add(processToStop);
            await terminateLSPProcess(processToStop, " without an active client");
        }

        await forgetManagedLSPProcess(processToStop);
        return;
    }

    const activeClient = client;
    const processToStop = lspProcess ?? managedClientProcesses.get(activeClient) ?? null;
    const isExternalLSP = isUsingExternalLSP;
    intentionallyClosedClients.add(activeClient);
    if (processToStop) {
        intentionallyStoppedProcesses.add(processToStop);
    }

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
    }

    if (!processToStop) {
        await forgetManagedLSPProcess();
        return;
    }

    if (stoppedGracefully && await waitForProcessExit(processToStop, LSP_PROCESS_EXIT_GRACE_MS)) {
        await forgetManagedLSPProcess(processToStop);
        return;
    }

    await terminateLSPProcess(processToStop, stoppedGracefully ? "" : " after a shutdown failure");
    await forgetManagedLSPProcess(processToStop);
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

        if (!isProcessActive(process)) {
            onExit();
        }
    });
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getManagedLSPPidFilePath() {
    return path.join(getExtensionContext().storageUri.fsPath, MANAGED_LSP_PID_FILE);
}

async function rememberManagedLSPProcess(process: ChildProcessWithoutNullStreams) {
    if (!process.pid) {
        return;
    }

    try {
        await fs.mkdir(path.dirname(getManagedLSPPidFilePath()), { recursive: true });
        await fs.writeFile(getManagedLSPPidFilePath(), String(process.pid));
    } catch (error) {
        logLanguageServer(`Unable to persist managed LSP pid=${process.pid}: ${formatError(error)}`);
    }
}

async function forgetManagedLSPProcess(processToForget?: ChildProcessWithoutNullStreams | null) {
    try {
        const pidText = await fs.readFile(getManagedLSPPidFilePath(), "utf8");
        const pid = Number.parseInt(pidText.trim(), 10);

        if (!processToForget?.pid || pid === processToForget.pid) {
            await fs.rm(getManagedLSPPidFilePath(), { force: true });
        }
    } catch (error: any) {
        if (error?.code !== "ENOENT") {
            logLanguageServer(`Unable to remove managed LSP pid file: ${formatError(error)}`);
        }
    }
}

async function cleanupStaleManagedLSPProcess() {
    let pid: number;

    try {
        const pidText = await fs.readFile(getManagedLSPPidFilePath(), "utf8");
        pid = Number.parseInt(pidText.trim(), 10);
    } catch (error: any) {
        if (error?.code !== "ENOENT") {
            logLanguageServer(`Unable to read managed LSP pid file: ${formatError(error)}`);
            await forgetManagedLSPProcess();
        }
        return;
    }

    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
        await forgetManagedLSPProcess();
        return;
    }

    try {
        process.kill(pid, 0);
    } catch {
        await forgetManagedLSPProcess();
        return;
    }

    logLanguageServer(`Cleaning up stale managed LSP process pid=${pid}`);

    try {
        process.kill(pid);
    } catch (error) {
        logLanguageServer(`Failed to signal stale managed LSP process pid=${pid}: ${formatError(error)}`);
        return;
    }

    await forgetManagedLSPProcess();
}

async function disconnectExternalClient(activeClient: LanguageClient) {
    let socket = clientSockets.get(activeClient);

    if (!socket) {
        const startPromise = clientStartPromises.get(activeClient);

        if (startPromise) {
            logLanguageServer("disconnectExternalClient() waiting for external client start to settle before disconnect");
            await startPromise.catch(() => undefined);
            socket = clientSockets.get(activeClient);
        }
    }

    if (!socket) {
        logLanguageServer("disconnectExternalClient() no external socket was available to close");
        return;
    }

    intentionallyClosedClients.add(activeClient);
    clientSockets.delete(activeClient);

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


export function startLSP(reason = "direct start"): Promise<LanguageClient | undefined> {
    if (!reason.startsWith("restart:automatic recovery")) {
        automaticRestartTimes = [];
    }

    const activeClient = client;

    if (activeClient) {
        const activeClientState = (activeClient as LanguageClient & { state?: number }).state;

        if (activeClientState === 2 || activeClientState === 3) {
            logLanguageServer(`startLSP() ignored because client is already ${describeLanguageClientState(activeClientState)}`);
            const pendingStart = clientStartPromises.get(activeClient);
            return pendingStart ? pendingStart.then(() => activeClient) : Promise.resolve(activeClient);
        }
    }

    if (queuedStartPromise) {
        logLanguageServer(`startLSP() coalesced with queued start reason=${reason}`);
        return queuedStartPromise;
    }

    const requestId = ++lifecycleOperationSequence;

    logLanguageServer(`startLSP() requested id=${requestId} reason=${reason}`);
    cancelPendingRestart(`direct startLSP() call id=${requestId}`);

    const startPromise = scheduleLifecycleOperation(`startLSP(${reason})`, async () => {
        if (requestId !== lifecycleOperationSequence) {
            logLanguageServer(`startLSP() skipping stale request id=${requestId}`);
            return client;
        }

        return startLSPNow(requestId, reason);
    }).finally(() => {
        if (queuedStartPromise === startPromise) {
            queuedStartPromise = undefined;
        }
    });

    queuedStartPromise = startPromise;
    return startPromise;
}

async function startLSPNow(startRequestId: number, reason: string): Promise<LanguageClient | undefined> {
    const activeClient = client;

    if (activeClient) {
        const activeClientState = (activeClient as LanguageClient & { state?: number }).state;

        if (activeClientState === 2 || activeClientState === 3) {
            logLanguageServer(`startLSP() ignored because client is already ${describeLanguageClientState(activeClientState)}`);
            const pendingStart = clientStartPromises.get(activeClient);
            if (pendingStart) {
                await pendingStart;
            }
            return activeClient;
        }

        logLanguageServer(`startLSP() discarding stale client state=${describeLanguageClientState(activeClientState)}`);
        await stop();
    }

    const nextIsUsingExternalLSP = Boolean(process.env.BOXLANG_LSP_PORT);
    isUsingExternalLSP = nextIsUsingExternalLSP;
    const startAttemptId = ++lspStartAttempt;
    logLanguageServer(
        `startLSP() called id=${startRequestId} attempt=${startAttemptId} reason=${reason} external=${nextIsUsingExternalLSP}`
        + ` port=${process.env.BOXLANG_LSP_PORT ?? "managed"} existingClient=${Boolean(client)}`
    );

    const clientOptions: LanguageClientOptions = {
        // Reuse the extension-owned channel; failed/stopped clients do not
        // reliably dispose channels they created themselves.
        // ponytail: v9.0.1 also retains notebook constructor listeners; upgrade upstream rather than patch private internals.
        outputChannel: boxlangOutputChannel,
        // Our lifecycle manager owns failure reporting, cleanup and retries.
        // Rethrow rather than letting the library toast and stop a starting client.
        initializationFailedHandler: error => { throw error; },
        documentSelector: [
            { scheme: "file", language: "boxlang" },
            { scheme: "file", language: "cfml" }
        ]
    };

    let nextClient!: LanguageClient;

    const showCrashActions = (exitCode: number | null | undefined, signalCode: NodeJS.Signals | null | undefined) => {
        const hints: Record<string, string> = {
            SIGSEGV: 'JVM segmentation fault (native memory corruption)',
            SIGKILL: 'Process killed by OS (possibly OOM or system resource limit)',
            SIGABRT: 'JVM runtime error or assertion failure (check hs_err_pid*.log)',
            SIGTERM: 'Process was terminated externally',
            SIGPIPE: 'Broken pipe — LSP socket connection lost',
            SIGBUS: 'JVM bus error (memory alignment/hardware issue)',
        };
        const signalHint = signalCode && hints[signalCode] ? `\n\nLikely cause: ${hints[signalCode]}` : '';
        const exitCodeMsg = exitCode !== null && exitCode !== undefined && exitCode !== 0
            ? `\n\nExit code ${exitCode} usually indicates the BoxLang runtime encountered a fatal error.`
            : '';

        void vscode.window.showErrorMessage(
            `BoxLang Language Server crashed unexpectedly.${exitCodeMsg}${signalHint}\n\nCheck the Output panel for details.`,
            'Restart LSP',
            'Show Output',
        ).then((selection) => {
            if (selection === 'Restart LSP') {
                automaticRestartTimes = [];
                void requestRestart('user requested after crash').catch(error => {
                    logLanguageServer(`User-requested restart failed: ${formatError(error)}`);
                });
            } else if (selection === 'Show Output') {
                boxlangOutputChannel.show(true);
            }
        }, error => {
            logLanguageServer(`Unable to show LSP crash actions: ${formatError(error)}`);
        });
    };

    clientOptions.errorHandler = {
        error: (error) => {
            if (intentionallyClosedClients.has(nextClient)) {
                logLanguageServer(`Language server connection error during intentional shutdown: ${formatError(error)}`);
                return { action: ErrorAction.Continue, handled: true };
            }

            logLanguageServer(`Language server connection error: ${formatError(error)}`);
            return { action: ErrorAction.Continue, handled: true };
        },
        closed: async () => {
            const intentional = intentionallyClosedClients.has(nextClient);
            const closeSequence = lifecycleOperationSequence;
            // The library disposes pending requests before calling us. Let start()
            // propagate that rejection before it clears its internal start promise.
            await clientStartPromises.get(nextClient)?.catch(() => undefined);
            if (intentional || closeSequence !== lifecycleOperationSequence) {
                logLanguageServer("Language server connection closed intentionally or superseded");
                return { action: CloseAction.DoNotRestart, handled: true };
            }

            const proc = nextIsUsingExternalLSP ? undefined : managedClientProcesses.get(nextClient) ?? lspProcess;
            const exitCode = proc?.exitCode;
            const signalCode = proc?.signalCode;

            logLanguageServer(
                `Language server connection closed unexpectedly attempt=${startAttemptId}`
                + ` processPid=${proc?.pid ?? "unknown"} exitCode=${exitCode ?? "unknown"} signal=${signalCode ?? "none"}`
            );
            logLanguageServer(
                `The LSP process has exited or the socket was lost. Check [LSP stdErr]/[LSP crash] messages,`
                + ` JVM crash logs (hs_err_pid*.log), and the startup log above.`
            );

            if (nextIsUsingExternalLSP) {
                logLanguageServer("External language server connection closed; automatic restart is disabled");
                return { action: CloseAction.DoNotRestart, handled: false };
            }

            const recover = () => {
                if (canAutomaticallyRestart()) {
                    const recoveryAttempt = automaticRestartTimes.length;
                    logLanguageServer(
                        `Scheduling automatic LSP recovery attempt=${recoveryAttempt}/${LSP_AUTOMATIC_RESTART_LIMIT}`
                    );
                    const recovery = requestRestart(`automatic recovery after connection close #${recoveryAttempt}`);
                    const recoveryRequestId = lifecycleOperationSequence;
                    void recovery.catch(error => {
                        logLanguageServer(`Automatic LSP recovery failed: ${formatError(error)}`);
                        // A launch can fail without emitting closed(). Retry here
                        // unless a newer restart or shutdown already superseded it.
                        if (recoveryRequestId === lifecycleOperationSequence) {
                            recover();
                        }
                    });
                    return {
                        action: CloseAction.DoNotRestart,
                        handled: true,
                        message: `BoxLang Language Server disconnected; recovery attempt ${recoveryAttempt}/${LSP_AUTOMATIC_RESTART_LIMIT} is scheduled.`
                    };
                }

                logLanguageServer(
                    `Automatic LSP recovery stopped after ${LSP_AUTOMATIC_RESTART_LIMIT} failures in ${LSP_AUTOMATIC_RESTART_WINDOW_MS / 60000} minutes`
                );
                showCrashActions(exitCode, signalCode);
                return { action: CloseAction.DoNotRestart, handled: true };
            };

            return recover();
        }
    };

    const startupCancellation = new AbortController();
    nextClient = new BoxLangLanguageClient(
        "boxlang",
        "BoxLang Language Support",
        getLSPServerConfig(socket => {
            clientSockets.set(nextClient, socket);
            socket.once("close", () => {
                if (clientSockets.get(nextClient) === socket) {
                    clientSockets.delete(nextClient);
                }
            });
            if (intentionallyClosedClients.has(nextClient)) {
                socket.destroy();
            }
        }, process => managedClientProcesses.set(nextClient, process), startupCancellation.signal),
        clientOptions,
        true
    );

    clientStartControllers.set(nextClient, startupCancellation);
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

    const startPromise = Promise.resolve()
        .then(() => nextClient.start())
        .then(async () => {
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
        })
        .catch(async error => {
            logLanguageServer(`client.start() rejected attempt=${startAttemptId}: ${formatError(error)}`);

            const processToStop = managedClientProcesses.get(nextClient) ?? (client === nextClient ? lspProcess : null);
            intentionallyClosedClients.add(nextClient);
            // Pre-connection failures never reach the library's close cleanup.
            nextClient.diagnostics?.dispose();
            if (client === nextClient) {
                client = undefined;
                if (lspProcess === processToStop) {
                    lspProcess = null;
                }
                isUsingExternalLSP = false;
                await updateAdvertisedServerCommands();
            }

            if (processToStop) {
                intentionallyStoppedProcesses.add(processToStop);
                await terminateLSPProcess(processToStop, " after a startup failure");
                await forgetManagedLSPProcess(processToStop);
            }

            throw error;
        })
        .finally(() => {
            clientStartPromises.delete(nextClient);
            clientStartControllers.delete(nextClient);
        });

    clientStartPromises.set(nextClient, startPromise);

    await startPromise;
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


export function getLSPServerConfig(
    onSocket?: (socket: net.Socket) => void,
    onManagedProcess?: (process: ChildProcessWithoutNullStreams) => void,
    signal?: AbortSignal
): ServerOptions {
    if (process.env.BOXLANG_LSP_PORT) {
        return async () => {
            const socketId = ++lspSocketSequence;
            const port = Number.parseInt(process.env.BOXLANG_LSP_PORT!, 10);

            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                throw new Error(`Invalid BOXLANG_LSP_PORT value: ${process.env.BOXLANG_LSP_PORT}`);
            }

            logLanguageServer(`Creating external LSP socket connection socketId=${socketId} host=127.0.0.1 port=${port}`);
            const socket = await connectToLSP(port, `external socketId=${socketId}`, onSocket, undefined, 1, signal);
            return {
                writer: socket,
                reader: socket
            };
        };
    }

    return async () => {
        const [proc, port] = await startLanguageServerProcess(signal);
        lspProcess = proc;
        onManagedProcess?.(proc);

        const numericPort = Number.parseInt(String(port), 10);
        if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
            throw new Error(`Language server announced an invalid port: ${port}`);
        }

        const socketId = ++lspSocketSequence;
        let processExited = false;

        // Attach process monitoring after the process is associated with this client.
        const pid = proc.pid;
        proc.once('exit', (code, signal) => {
            processExited = true;
            const intentional = intentionallyStoppedProcesses.has(proc);
            const exitInfo = code !== null ? `exit code ${code}` : `signal ${signal}`;
            boxlangOutputChannel.appendLine(
                `[${intentional ? "LSP" : "LSP Crash Monitor"}] Process (pid ${pid}) exited ${intentional ? "intentionally" : "unexpectedly"}: ${exitInfo}.`
                + (intentional ? "" : " Check [LSP stdErr], [LSP crash], or JVM crash logs above.")
            );
            if (lspProcess === proc) {
                lspProcess = null;
            }
        });
        proc.once('close', () => {
            if (!processExited) {
                boxlangOutputChannel.appendLine(
                    `[LSP Crash Monitor] Process (pid ${pid}) streams closed before exit; check [LSP stdErr] above.`
                );
            }
        });
        proc.once('error', (err) => {
            boxlangOutputChannel.appendLine(
                `[LSP Crash Monitor] Process (pid ${pid}) error: ${err.message}`
            );
        });

        logLanguageServer(`Creating managed LSP socket connection socketId=${socketId} pid=${proc.pid} host=127.0.0.1 port=${numericPort}`);
        const socket = await connectToLSP(
            numericPort,
            `managed socketId=${socketId}`,
            onSocket,
            () => !isProcessActive(proc),
            undefined,
            signal
        );
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
async function startLanguageServerProcess(signal?: AbortSignal) {
    signal?.throwIfAborted();
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

    signal?.throwIfAborted();
    await cleanupStaleManagedLSPProcess();

    const startedProcess = await startLSPProcess(
        lspBoxLangHome,
        lspModulePath,
        boxlangVersionPath,
        undefined,
        signal
    );

    await rememberManagedLSPProcess(startedProcess[0]);

    return startedProcess;
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
