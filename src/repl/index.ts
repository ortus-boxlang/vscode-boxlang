import { randomBytes } from "crypto";
import path from "path";
import * as vscode from "vscode";
import { InspectionTarget, replSession, SessionResult } from "./ReplSession";
import { registerVariablesView } from "./VariablesView";

let panel: vscode.WebviewPanel | undefined;

function postState() {
    void panel?.webview.postMessage({ kind: "status", status: replSession.status, environment: replSession.environment });
}

function showPanel(context: vscode.ExtensionContext) {
    if (panel) { panel.reveal(vscode.ViewColumn.Beside); return; }
    const assets = vscode.Uri.file(path.join(context.extensionPath, "resources", "repl"));
    panel = vscode.window.createWebviewPanel("boxlang.replSession", "BoxLang REPL Session (POC)", vscode.ViewColumn.Beside, {
        enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [assets]
    });
    const nonce = randomBytes(16).toString("hex");
    const script = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assets.fsPath, "session.js")));
    const styles = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assets.fsPath, "session.css")));
    panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${panel.webview.cspSource};">
<link rel="stylesheet" href="${styles}"></head><body>
<header><div class="heading"><strong>BoxLang REPL</strong><span id="status" role="status">Stopped</span></div>
<nav aria-label="Session actions"><button id="variables" class="secondary">Variables</button><button id="clear" class="secondary">Clear output</button><button id="stop" class="secondary">Stop</button><button id="reset" class="secondary">Reset</button></nav></header>
<details id="session-info"><summary>Session information</summary><pre id="environment"></pre><p>Scratch session, not a sandbox. Stop/reset discards variables, not filesystem or network effects.</p></details>
<div id="history" aria-label="Execution history" tabindex="0"><p id="empty">Run BoxLang code here or send a selection from the editor.<br>Inspect state in the native <strong>REPL Variables</strong> view.</p></div>
<p id="announcement" class="sr-only" role="status" aria-live="polite"></p>
<section id="composer"><label for="code">BoxLang script</label><textarea id="code" rows="3" spellcheck="false" placeholder="answer = 41;" aria-describedby="input-help"></textarea>
<div class="input-actions"><span id="input-help">Ctrl/Cmd+Enter to run · Alt+↑/↓ for history</span><button id="run">Run</button></div></section>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
    panel.onDidDispose(() => { panel = undefined; }); // Closing the panel does not end the session.
    panel.webview.onDidReceiveMessage(async message => {
        try {
            if (!message || typeof message.kind !== "string") throw new Error("Invalid REPL panel request.");
            switch (message.kind) {
                case "ready":
                    postState();
                    void panel?.webview.postMessage({ kind: "history", executions: replSession.executions });
                    break;
                case "execute":
                    if (typeof message.code !== "string") throw new Error("Invalid code request.");
                    // Session execution events attach errors to their corresponding history entry.
                    await replSession.execute(message.code).catch(() => undefined);
                    break;
                case "rerun": {
                    const execution = replSession.executions.find(item => item.id === message.id);
                    if (!execution) throw new Error("This execution is no longer in history.");
                    await replSession.execute(execution.code, execution.source).catch(() => undefined);
                    break;
                }
                case "inspectResult": {
                    if (typeof message.id !== "string" || message.id.length > 100 || !Number.isSafeInteger(message.executionId) || message.executionId < 1) throw new Error("Invalid result inspection request.");
                    try {
                        const response = await replSession.inspect(message.path, undefined, { executionId: message.executionId });
                        void panel?.webview.postMessage({ ...response, kind: "resultChildren", id: message.id });
                    } catch (error) {
                        void panel?.webview.postMessage({ kind: "resultChildren", id: message.id, ok: false, error: error.message });
                    }
                    break;
                }
                case "variables": await vscode.commands.executeCommand("boxlang-repl-variables.focus"); break;
                case "clear":
                    replSession.clearHistory();
                    void panel?.webview.postMessage({ kind: "history", executions: [] });
                    break;
                case "stop": replSession.stop(); break;
                case "reset":
                    if (await vscode.window.showWarningMessage("Reset the shared REPL session? All variables will be lost.", { modal: true }, "Reset") === "Reset") {
                        replSession.stop("Session reset; state discarded.");
                        replSession.clearHistory();
                        void panel?.webview.postMessage({ kind: "history", executions: [] });
                    }
                    break;
                default: throw new Error("Unknown REPL panel request.");
            }
        } catch (error) {
            void panel?.webview.postMessage({ kind: "error", error: error.message });
        }
    });
}

async function runEditor(context: vscode.ExtensionContext, selection: boolean) {
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== "boxlang" || /\.bxm$/i.test(editor.document.fileName)) {
            throw new Error("The POC supports BoxLang script documents, not templates or CFML.");
        }
        if (selection && editor.selection.isEmpty) throw new Error("Select BoxLang code first.");
        const code = editor.document.getText(selection ? editor.selection : undefined);
        const source = editor.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined;
        showPanel(context);
        await replSession.execute(code, source);
    } catch (error) {
        void vscode.window.showErrorMessage(`BoxLang REPL: ${error.message}`);
    }
}

function resultText(response: SessionResult) {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(response))]);
}

export function registerReplSession(context: vscode.ExtensionContext) {
    registerVariablesView(context, replSession);
    context.subscriptions.push(replSession,
        vscode.commands.registerCommand("boxlang.openREPLSession", () => showPanel(context)),
        vscode.commands.registerCommand("boxlang.runSelectionInREPLSession", () => runEditor(context, true)),
        vscode.commands.registerCommand("boxlang.runFileInREPLSession", () => runEditor(context, false)),
        replSession.onDidChange(event => {
            if ("status" in event) postState();
            else if (replSession.executions.some(execution => execution.id === event.id)) {
                void panel?.webview.postMessage({ kind: "execution", ...event });
            }
        }),
        { dispose: () => panel?.dispose() },
        vscode.lm.registerTool<{ code: string }>("boxlang-tools_executeREPL", {
            prepareInvocation: options => ({
                invocationMessage: "Executing code in the shared BoxLang REPL session",
                confirmationMessages: {
                    title: replSession.status === "Stopped" || replSession.status === "Failed" ? "Start BoxLang REPL session and execute code?" : "Execute code in the shared BoxLang REPL session?",
                    message: new vscode.MarkdownString("Code can access files, credentials, and the network. It is not sandboxed. Cancellation or a 30-second timeout discards session state.").appendCodeblock(options.input.code, "boxlang")
                }
            }),
            invoke: async (options, token) => resultText(await replSession.execute(options.input.code, undefined, token))
        }),
        vscode.lm.registerTool<InspectionTarget & { path?: string[] }>("boxlang-tools_inspectREPL", {
            prepareInvocation: () => ({
                confirmationMessages: { title: "Share BoxLang REPL state with Copilot?", message: "Selected variable names and values will be returned to the model. They may contain secrets." }
            }),
            invoke: async (options, token) => resultText(await replSession.inspect(options.input.path, token, { scope: options.input.scope, executionId: options.input.executionId }))
        })
    );
}
