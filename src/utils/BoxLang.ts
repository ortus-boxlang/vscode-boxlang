import { ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import * as portFinder from "portfinder";
import { ExtensionContext, window } from "vscode";
import { ExtensionConfig } from "../utils/Configuration";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { trackedSpawn } from "./ProcessTracker";
import { BoxServerConfig, trackServerStart, trackServerStop } from "./Server";

type BoxLangResult = {
    code: number,
    stdout: string,
    stderr: string
}

const runningServers: Record<string, ChildProcessWithoutNullStreams> = {};
let BOXLANG_HOME = "";
let LSP_MODULE_DIR = "";


export async function setupVSCodeBoxLangHome(context: ExtensionContext): Promise<void> {
    BOXLANG_HOME = path.join(context.globalStorageUri.fsPath, ".boxlang");
    LSP_MODULE_DIR = path.join(context.extensionPath, "resources", "lsp");

    if (fs.existsSync(BOXLANG_HOME)) {
        return;
    }

    // use this to generate a home folder
    BoxLang.getVersionOutput();
}

async function runBoxLangWithHome(boxlangHome, ...args: string[]): Promise<BoxLangResult> {
    return new Promise((resolve, reject) => {
        const javaExecutable = ExtensionConfig.boxlangJavaHome;
        const boxLang = trackedSpawn(javaExecutable, ["ortus.boxlang.runtime.BoxRunner"].concat(args), {
            env: {
                BOXLANG_HOME: boxlangHome,
                CLASSPATH: ExtensionConfig.boxlangJarPath
            }
        });
        let stdout = '';
        let stderr = '';

        boxLang.stdout.on("data", data => stdout += data);
        // TODO: throw error
        boxLang.stderr.on("data", data => stderr += data);

        boxLang.on("exit", code => {
            resolve({
                code,
                stdout,
                stderr
            });
        });
    });
}

async function runBoxLang(...args: string[]): Promise<BoxLangResult> {
    return runBoxLangWithHome(BOXLANG_HOME, ...args);
}

export class BoxLangWithHome {
    boxlangHome: string;

    constructor(boxlangHome: string | null) {
        this.boxlangHome = boxlangHome || BOXLANG_HOME;
    }

    async getVersionOutput(): Promise<string> {
        const res = runBoxLangWithHome(this.boxlangHome, "--version");

        return (await res).stdout;
    }

}

export class BoxLang {

    static startLSP(): Promise<Array<any>> {
        boxlangOutputChannel.appendLine("Starting the LSP");
        return new Promise((resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaHome;
            const maxHeapSizeArg = `-Xmx${ExtensionConfig.boxlangMaxHeapSize}m`;
            const lsp = trackedSpawn(javaExecutable, [maxHeapSizeArg, "ortus.boxlang.runtime.BoxRunner", "module:bx-lsp"], {
                env: {
                    CLASSPATH: ExtensionConfig.boxlangJarPath,
                    BOXLANG_MODULESDIRECTORY: LSP_MODULE_DIR
                }
            });

            let stdout = '';
            let found = false;

            lsp.stdout.on("data", data => {
                stdout += data;

                if (found) {
                    return;
                }

                const matches = /Listening on port: (\d+)/mi.exec(stdout);

                if (!matches) {
                    return;
                }

                found = true;
                resolve([lsp, matches[1]]);
            });

            lsp.stderr.on("data", data => {
                boxlangOutputChannel.appendLine(data + "");
            });
        })
    }

    static async startDebugger(): Promise<string> {
        return new Promise((resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaHome;
            const boxLang = trackedSpawn(javaExecutable, ["ortus.boxlang.debugger.DebugMain"], {
                env: {
                    BOXLANG_HOME: BOXLANG_HOME,
                    CLASSPATH: ExtensionConfig.boxlangJarPath + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangMiniServerJarPath
                }
            });
            let stdout = '';
            let found = false;

            boxLang.stdout.on("data", data => {
                boxlangOutputChannel.appendLine("Debugger - output");
                boxlangOutputChannel.appendLine("" + data);
                stdout += data;

                if (found) {
                    return;
                }

                const matches = /Listening on port: (\d+)/mi.exec(stdout);

                if (!matches) {
                    return;
                }

                found = true;
                resolve(matches[1]);
            });

            boxLang.stderr.on("data", data => {
                boxlangOutputChannel.appendLine("Debugger - error");
                boxlangOutputChannel.appendLine("" + data);
            });
        });
    }

    static async getVersionOutput(): Promise<string> {
        const res = runBoxLang("--version");

        return (await res).stdout;
    }

    static async stopMiniServer(server: BoxServerConfig): Promise<void> {
        runningServers[server.name].kill();
    }

    static async startMiniServer(server: BoxServerConfig): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaHome;
            const debugPort = await findAvailableDebugPort();
            const cliArgs = await getMiniServerCLIArgs(server, debugPort);
            const boxLang = trackedSpawn(javaExecutable, cliArgs, {
                env: {
                    CLASSPATH: ExtensionConfig.boxlangJarPath + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangMiniServerJarPath
                }
            });

            const outputChannel = window.createOutputChannel(`BoxLang - ${server.name}`);
            outputChannel.appendLine(`Using port ${debugPort} for debugging`);
            outputChannel.show();

            boxLang.stdout.on("data", data => {
                outputChannel.appendLine(data)

                if (/BoxLang MiniServer started at/.test("" + data)) {
                    resolve();
                }
            });
            boxLang.stderr.on("data", data => outputChannel.appendLine(data));

            trackServerStart(server.name, debugPort);
            runningServers[server.name] = boxLang;

            boxLang.on("close", () => {
                trackServerStop(server.name);
                // outputChannel.dispose();
            });
        });
    }

    async getASTJSON(code) {
        const result = await runBoxLang("--printAST", "-c", code);

        if (result.code > 0) {
            boxlangOutputChannel.appendLine("Unable to generate AST");
            boxlangOutputChannel.append(result.stderr);
            throw new Error("Unable to generate AST");
        }

        return result.stdout.replace(/\\n/g, '\\\\n')
            .replace(/\\r/g, '\\\\r')
            .replace(/\\"/g, '\\\\"');
    }

    async transpileToJava(filePath: string): Promise<string> {
        const result = await runBoxLang("--transpile", filePath);

        if (result.stderr) {
            console.log(result.stderr);
        }

        return result.stdout;
    }
}

function getJavaCLASSPATHSeparator(): string {
    return process.platform === "win32" ? ";" : ":";
}

async function getAgentLibArg(port: number): Promise<string> {
    return `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=${port}`;
}

async function findAvailableDebugPort(): Promise<number> {
    return await portFinder.getPortPromise({ port: 4500 });
}

async function getMiniServerCLIArgs(server: BoxServerConfig, debugPort: number): Promise<String[]> {
    const agentLibArg = await getAgentLibArg(debugPort);

    const cliArgs = [
        agentLibArg,
        "ortus.boxlang.web.MiniServer",
        "--port",
        "" + server.port,
        "--webroot",
        server.directoryAbsolute
    ];

    if (server.debugMode) {
        cliArgs.push("--debug");
    }

    if (server.configFile) {
        cliArgs.push("--configPath", `${server.configFile}`);
    }

    return cliArgs;
}