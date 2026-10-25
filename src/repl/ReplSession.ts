import { ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import readline from "readline";
import * as vscode from "vscode";
import { getExtensionContext } from "../context";
import { ExtensionConfig } from "../utils/Configuration";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { trackedSpawn } from "../utils/ProcessTracker";
import { getConfiguredBoxLangJarPath } from "../utils/versionManager";

export type SessionVariable = { name: string; type: string; value: string; expandable: boolean };
export type InspectionTarget = { scope?: "variables" | "server" | "request"; executionId?: number };
export type SessionResult = { executionId?: number; ok: boolean; output: string; error?: string; result?: SessionVariable; variables?: SessionVariable[] };
export type SessionExecution = { id: number; code: string; source?: string; state: "Queued" | "Running" | "Completed" | "Failed"; response?: SessionResult; durationMs?: number };
export type SessionEvent = { status: string } | SessionExecution;

export class ReplSession implements vscode.Disposable {
    private process?: ChildProcessWithoutNullStreams;
    private sequence = 0;
    private executionSequence = 0;
    private historyStart = 0;
    executions: SessionExecution[] = [];
    lastResult?: { executionId: number; variable: SessionVariable };
    private generation = 0;
    private queue: Promise<unknown> = Promise.resolve();
    private pending?: { id: number; resolve: (result: SessionResult) => void; reject: (error: Error) => void };
    private changes = new vscode.EventEmitter<SessionEvent>();
    readonly onDidChange = this.changes.event;
    status = "Stopped";
    environment = "";

    private setStatus(status: string) {
        this.status = status;
        this.changes.fire({ status });
    }

    clearHistory() {
        this.historyStart = this.executionSequence;
        this.executions = [];
    }

    async execute(code: string, source?: string, token?: vscode.CancellationToken): Promise<SessionResult> {
        if (typeof code !== "string") throw new Error("Provide BoxLang script as a string.");
        const execution: SessionExecution = { id: ++this.executionSequence, code, source, state: "Queued" };
        let started: number | undefined;
        const publish = () => {
            if (execution.id > this.historyStart) {
                const index = this.executions.findIndex(item => item.id === execution.id);
                if (index === -1) this.executions.push({ ...execution });
                else this.executions[index] = { ...execution };
                // ponytail: last 100 execution records in memory; durable history is outside the POC.
                if (this.executions.length > 100) this.executions.shift();
            }
            this.changes.fire({ ...execution });
        };
        publish();
        try {
            if (!code.trim() || Buffer.byteLength(code, "utf8") > 1000000) throw new Error("Provide non-empty BoxLang script (maximum 1 MB).");
            const response = await this.request({ action: "execute", code, source, executionId: execution.id }, true, token, () => {
                started = Date.now();
                execution.state = "Running";
                publish();
            });
            execution.response = response;
            if (response.result && response.result.type !== "null") this.lastResult = { executionId: execution.id, variable: response.result };
            execution.state = response.ok ? "Completed" : "Failed";
            return response;
        } catch (error) {
            execution.state = "Failed";
            execution.response = { ok: false, output: "", error: error.message };
            throw error;
        } finally {
            execution.durationMs = started === undefined ? 0 : Date.now() - started;
            publish();
        }
    }

    inspect(segments: string[] = [], token?: vscode.CancellationToken, target: InspectionTarget = {}): Promise<SessionResult> {
        if (!Array.isArray(segments) || segments.length > 20 || segments.some(segment => typeof segment !== "string" || segment.length > 2048)) {
            throw new Error("Provide a variable path with at most 20 string segments.");
        }
        if ((target.scope !== undefined && !["variables", "server", "request"].includes(target.scope))
            || (target.executionId !== undefined && (!Number.isSafeInteger(target.executionId) || target.executionId < 1))
            || (target.scope !== undefined && target.executionId !== undefined)) {
            throw new Error("Select a supported scope or a positive execution ID, not both.");
        }
        return this.request({ action: "inspect", path: segments, scope: target.scope, executionId: target.executionId }, false, token);
    }

    private request(payload: object, mayStart: boolean, token?: vscode.CancellationToken, onRun?: () => void): Promise<SessionResult> {
        const generation = this.generation;
        const operation = this.queue.catch(() => undefined).then(async () => {
            if (!process.versions?.node) throw new Error("The REPL requires a desktop or remote Node.js extension host.");
            if (!vscode.workspace.isTrusted) throw new Error("The REPL requires a trusted workspace. Code runs with your account's permissions.");
            if (token?.isCancellationRequested || generation !== this.generation) throw new Error("Session request cancelled.");
            if (!this.process) {
                if (!mayStart) throw new Error("No REPL session is running. Run code to start one.");
                await this.start(generation);
            }
            if (token?.isCancellationRequested || generation !== this.generation) throw new Error("Session request cancelled.");
            return new Promise<SessionResult>((resolve, reject) => {
                const id = ++this.sequence;
                // ponytail: terminate after 30 seconds; safe in-process interruption is deferred.
                const timeout = setTimeout(() => this.stop("Timed out; session stopped and state discarded."), 30000);
                const cancellation = token?.onCancellationRequested(() => this.stop("Cancelled; session stopped and state discarded."));
                const cleanup = () => { clearTimeout(timeout); cancellation?.dispose(); };
                this.pending = {
                    id,
                    resolve: result => { cleanup(); if (this.process) this.setStatus("Ready"); resolve(result); },
                    reject: error => { cleanup(); reject(error); }
                };
                if (mayStart) this.setStatus("Running");
                onRun?.();
                this.process!.stdin.write(JSON.stringify({ id, ...payload }) + "\n", error => {
                    if (error) this.stop(`Unable to send REPL request: ${error.message}`);
                });
            });
        });
        this.queue = operation;
        return operation;
    }

    private async start(generation: number): Promise<void> {
        this.setStatus("Starting");
        try {
            const jar = await getConfiguredBoxLangJarPath();
            if (generation !== this.generation) throw new Error("Session start cancelled.");
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!cwd) throw new Error("Open a workspace folder before starting a REPL session.");
            const home = ExtensionConfig.boxLangHome;
            this.environment = `Runtime: ${jar}\nBoxLang home: ${home}\nWorking directory: ${cwd}`;
            const proc = trackedSpawn(ExtensionConfig.boxlangJavaExecutable, [
                "--class-path", jar, path.join(getExtensionContext().extensionPath, "resources", "repl", "BoxLangSession.java")
            ], { cwd, env: { ...process.env, JAVA_HOME: ExtensionConfig.boxlangJavaHome, BOXLANG_HOME: home } });
            this.process = proc;
            const lines = readline.createInterface({ input: proc.stdout });
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => this.stop("REPL startup timed out. Check BoxLang output."), 60000);
                const fail = (error: Error) => {
                    clearTimeout(timeout);
                    reject(error);
                    if (this.process !== proc) return;
                    this.process = undefined;
                    this.lastResult = undefined;
                    this.generation++;
                    this.pending?.reject(error);
                    this.pending = undefined;
                    proc.kill();
                    this.setStatus("Failed");
                };
                proc.stdin.on("error", fail);
                lines.on("error", fail);
                proc.once("error", fail);
                proc.once("close", (code, signal) => {
                    lines.close();
                    fail(new Error(`REPL exited (${code ?? signal}). Check the BoxLang output channel.`));
                });
                proc.stderr.on("data", data => boxlangOutputChannel.appendLine(`[REPL] ${data}`));
                lines.on("line", line => {
                    if (this.process !== proc) return;
                    try {
                        const message = JSON.parse(line);
                        if (message.ready === true) {
                            clearTimeout(timeout);
                            this.setStatus("Ready");
                            resolve();
                        } else if (message.id === this.pending?.id) {
                            const pending = this.pending;
                            this.pending = undefined;
                            pending.resolve(message);
                        }
                    } catch (error) {
                        boxlangOutputChannel.appendLine(`[REPL] Invalid response: ${error.message}`);
                        this.stop("Invalid response from the REPL bridge.");
                    }
                });
            });
        } catch (error) {
            if (generation === this.generation) this.setStatus("Failed");
            throw error;
        }
    }

    stop(reason = "Session stopped; state discarded.") {
        this.generation++;
        const proc = this.process;
        this.process = undefined;
        this.lastResult = undefined;
        this.pending?.reject(new Error(reason));
        this.pending = undefined;
        if (proc) {
            proc.kill();
            const forceKill = setTimeout(() => {
                if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
            }, 1000);
            forceKill.unref();
        }
        this.setStatus("Stopped");
        boxlangOutputChannel.appendLine(`[REPL] ${reason}`);
    }

    dispose() { this.stop(); this.changes.dispose(); }
}

export const replSession = new ReplSession();
