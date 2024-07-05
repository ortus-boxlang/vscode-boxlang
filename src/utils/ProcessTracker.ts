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
        console.log(err + "");
    });

    process.stderr.on("error", (err) => {
        boxlangOutputChannel.appendLine(err + "");
        console.log(err + "");
    });

    processes.push(process);

    return process;
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