import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { boxlangOutputChannel } from "./OutputChannels";

let processes: ChildProcessWithoutNullStreams[] = [];

export function trackedSpawn(...args): ChildProcessWithoutNullStreams {
    const process: ChildProcessWithoutNullStreams = (<any>spawn)(...args);
    // TODO there is a bug in the debugger which prevents it from sending back a message that the process has exited
    process.on("exit", () => {
        processes = processes.filter(p => p.pid != process.pid);
    });

    process.on("close", () => {
        processes = processes.filter(p => p.pid != process.pid);
    });

    process.on("disconnect", () => {
        processes = processes.filter(p => p.pid != process.pid);
    });
    process.on("error", () => {
        processes = processes.filter(p => p.pid != process.pid);
    });

    process.on("error", (err) => {
        boxlangOutputChannel.appendLine(err + "");
    });

    process.stderr.on("error", (err) => {
        boxlangOutputChannel.appendLine(err + "");
    });

    processes.push(process);

    return process;
}

const FORCE_KILL_TIMEOUT_MS = 1000;

export function isProcessActive(process: ChildProcessWithoutNullStreams): boolean {
    return process.exitCode === null && process.signalCode === null;
}

/**
 * Resolves true once the process has exited, or false if it is still running after timeoutMs.
 */
export function waitForProcessExit(process: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
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

/**
 * Kills a process and waits for it to exit. Sends SIGTERM first and falls back to SIGKILL
 * if the process is still running after FORCE_KILL_TIMEOUT_MS.
 * @param label Short name used in log lines, e.g. "LSP process"
 * @param reason Optional suffix for the log line, e.g. " after a shutdown failure"
 * @returns true when the process is gone, false when it is still running after both attempts.
 *          Callers must not treat the process as cleaned up when this returns false.
 */
export async function terminateProcess(process: ChildProcessWithoutNullStreams, label: string, reason = ""): Promise<boolean> {
    if (!isProcessActive(process)) {
        return true;
    }

    boxlangOutputChannel.appendLine(`Force-killing ${label} (pid ${process.pid})${reason}`);

    try {
        process.kill();
    } catch (error) {
        boxlangOutputChannel.appendLine(`Failed to signal ${label} (pid ${process.pid}): ${error instanceof Error ? error.message : String(error)}`);
        return !isProcessActive(process);
    }

    if (await waitForProcessExit(process, FORCE_KILL_TIMEOUT_MS)) {
        return true;
    }

    boxlangOutputChannel.appendLine(`${label} (pid ${process.pid}) did not exit after SIGTERM, sending SIGKILL`);

    try {
        process.kill("SIGKILL");
    } catch (error) {
        boxlangOutputChannel.appendLine(`Failed to force-kill ${label} (pid ${process.pid}): ${error instanceof Error ? error.message : String(error)}`);
        return !isProcessActive(process);
    }

    if (await waitForProcessExit(process, FORCE_KILL_TIMEOUT_MS)) {
        return true;
    }

    boxlangOutputChannel.appendLine(`${label} (pid ${process.pid}) is still running after SIGKILL`);
    return false;
}

export function cleanupTrackedProcesses() {
    processes.forEach(p => {
        try {
            boxlangOutputChannel.appendLine("cleaning up " + p.pid);
            p.kill();
        }
        catch (e) {
            boxlangOutputChannel.appendLine("Failed to clean up " + p.pid);
            boxlangOutputChannel.appendLine(e.message);
            // pass
        }
    });
}