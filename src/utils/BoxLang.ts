import { ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import * as portFinder from "portfinder";
import vscode, { ExtensionContext, window } from "vscode";
import { getExtensionContext } from "../context";
import { ExtensionConfig } from "../utils/Configuration";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { ensureConfiguredDebuggerModule } from "./DebuggerManager";
import { trackedSpawn } from "./ProcessTracker";
import { BoxServerConfig, trackServerStart, trackServerStop } from "./Server";
import { getConfiguredBoxLangJarPath } from "./versionManager";

// Avoid a hard dependency on type declarations for yauzl
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yauzl: any = require("yauzl");

export type BoxLangResult = {
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

export async function startLSPProcess(
    boxlangHome: string,
    lspModulePath: string,
    boxlangVersionPath: string
): Promise<Array<any>> {
    return new Promise((resolve, reject) => {
        const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
        const maxHeapSizeArg = `-Xmx${ExtensionConfig.boxlangMaxHeapSize}m`;
        const jvmArgs = ExtensionConfig.boxlangLSPJVMArgs.length ? ExtensionConfig.boxlangLSPJVMArgs.split( " " ) : [];
        const lsp = trackedSpawn(javaExecutable, [ maxHeapSizeArg, ...jvmArgs, "ortus.boxlang.runtime.BoxRunner", "module:bx-lsp"], {
            env: {
                BOXLANG_HOME: boxlangHome,
                BOXLANG_MODULESDIRECTORY: lspModulePath,
                BOXLANG_DEBUGMODE: "true",
                CLASSPATH: boxlangVersionPath
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
    });
}

async function runBoxLangWithHome(boxlangHome, ...args: string[]): Promise<BoxLangResult> {
    return new Promise((resolve, reject) => {
        const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
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

function startDebuggerProcess(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
    return new Promise((resolve, reject) => {
        const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
        const boxLang = trackedSpawn(javaExecutable, args, { env });
        let stdout = '';
        let found = false;

        boxLang.on("error", (err) => {
            boxlangOutputChannel.appendLine("Debugger failed to launch");
            boxlangOutputChannel.appendLine("" + err);
            reject(err);
        });

        boxLang.stdout.on("data", data => {
            boxlangOutputChannel.appendLine("Debugger - output");
            boxlangOutputChannel.appendLine("" + data);
            stdout += data;

            if (found) {
                return;
            }

            const port = findPort( stdout );

            if (!port) {
                return;
            }

            found = true;
            resolve(port);
        });

        boxLang.stderr.on("data", data => {
            boxlangOutputChannel.appendLine("Debugger - error");
            boxlangOutputChannel.appendLine("" + data);
        });
    });
}

function findPort(stdout: string){
    const match = /Listening on port: (\d+)/mi.exec(stdout);

    if (match) {
        return match[1];
    }

    return null;
}

async function startLegacyDebugger(boxlangHome: string): Promise<string> {
    boxlangOutputChannel.appendLine("Starting legacy BoxLang debugger");

    return startDebuggerProcess(
        ["ortus.boxlang.debugger.DebugMain"],
        {
            ...process.env,
            JAVA_HOME: ExtensionConfig.boxlangJavaHome,
            BOXLANG_HOME: boxlangHome,
            CLASSPATH: ExtensionConfig.boxlangJarPath + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangMiniServerJarPath
        }
    );
}

async function startModuleDebugger(boxlangHome: string): Promise<string> {
    const debuggerInstall = await ensureConfiguredDebuggerModule();

    boxlangOutputChannel.appendLine(`Starting module BoxLang debugger: ${debuggerInstall.versionSpec}`);

    return startDebuggerProcess(
        ["ortus.boxlang.runtime.BoxRunner", `module:${debuggerInstall.moduleName}`],
        {
            ...process.env,
            JAVA_HOME: ExtensionConfig.boxlangJavaHome,
            BOXLANG_HOME: boxlangHome,
            BOXLANG_MODULESDIRECTORY: debuggerInstall.modulePath,
            BOXLANG_DEBUGMODE: "true",
            CLASSPATH: debuggerInstall.runtimeJarPath
        }
    );
}

async function startConfiguredDebugger(boxlangHome: string): Promise<string> {
    const mode = ExtensionConfig.boxlangDebuggerMode;

    if (mode === "module") {
        return startModuleDebugger(boxlangHome);
    }

    return startLegacyDebugger(boxlangHome);
}

export class BoxLangWithHome {
    boxlangHome: string;

    constructor(boxlangHome: string | null ) {
        this.boxlangHome = boxlangHome || BOXLANG_HOME;
    }

    async shellExecution( args: string[] ): Promise<vscode.ShellExecution> {
        const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
        return new vscode.ShellExecution(javaExecutable, ["ortus.boxlang.runtime.BoxRunner", ...args ], {
            env: {
                ...process.env,
                JAVA_HOME: ExtensionConfig.boxlangJavaHome,
                BOXLANG_HOME: this.boxlangHome,
                CLASSPATH: (await getConfiguredBoxLangJarPath()) + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangMiniServerJarPath
            }
        });
    }

    async featureAudit( args: string[] ): Promise<BoxLangResult> {
        return new Promise(async (resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
            const boxLang = trackedSpawn(javaExecutable, ["ortus.boxlang.runtime.BoxRunner", ...args ], {
                env: {
                    ...process.env,
                    JAVA_HOME: ExtensionConfig.boxlangJavaHome,
                    BOXLANG_HOME: this.boxlangHome,
                    CLASSPATH: (await getConfiguredBoxLangJarPath()) + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangMiniServerJarPath
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

    async openREPL(){
        let boxLangREPL = vscode.window.terminals.find( t => t.name == "BoxLang REPL" );

        if( !boxLangREPL ){
            boxLangREPL = vscode.window.createTerminal({
                name: "BoxLang REPL",
                shellPath: ExtensionConfig.boxlangJavaExecutable,
                shellArgs: [ "ortus.boxlang.runtime.BoxRunner" ],
                env: {
                    ...process.env,
                    JAVA_HOME: ExtensionConfig.boxlangJavaHome,
                    BOXLANG_HOME: this.boxlangHome,
                    CLASSPATH: await getConfiguredBoxLangJarPath()
                }
            });
        }

        boxLangREPL.show();
    }

    async getVersionOutput(): Promise<string> {
        const res = await runBoxLangWithHome(this.boxlangHome, "--version");

        if( res.code != 0 ){
            return res.stderr
        }

        return res.stdout;
    }

    async startDebugger(): Promise<string> {
        return startConfiguredDebugger(this.boxlangHome);
    }

    async startLSP(): Promise<Array<any>> {
        boxlangOutputChannel.appendLine("Starting the LSP");

        try{

            fs.cpSync( LSP_MODULE_DIR, path.join( this.boxlangHome, "modules" ), { force: true, recursive: true } );
        }
        catch( e ){
            boxlangOutputChannel.appendLine("Error copying LSP module" );
            boxlangOutputChannel.appendLine( e );
        }

        return new Promise((resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
            const maxHeapSizeArg = `-Xmx${ExtensionConfig.boxlangMaxHeapSize}m`;
            const jvmArgs = ExtensionConfig.boxlangLSPJVMArgs.length ? ExtensionConfig.boxlangLSPJVMArgs.split( " " ) : [];
            const lsp = trackedSpawn(javaExecutable, [maxHeapSizeArg, ...jvmArgs, "ortus.boxlang.runtime.BoxRunner", "module:bx-lsp"], {
                env: {
                    ...process.env,
                    JAVA_HOME: ExtensionConfig.boxlangJavaHome,
                    BOXLANG_HOME: this.boxlangHome,
                    CLASSPATH: ExtensionConfig.boxlangJarPath
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

            lsp.on("close", () => {
                boxlangOutputChannel.appendLine( "BoxLang language server closed" );
            });

            lsp.on("exit", ( code ) => {
                boxlangOutputChannel.appendLine( "BoxLang language server exited with code: " + code );
            });

            lsp.stderr.on("data", data => {
                boxlangOutputChannel.appendLine(data + "");
            });
        })
    }

    async getLSPVersionOutput(): Promise<string> {
        try {
            const lspVersionSpec = ExtensionConfig.boxlangLSPVersion;
            if (!lspVersionSpec) {
                return "No LSP version is configured (boxlang.lsp.lspVersion).";
            }

            const context = getExtensionContext();
            const lspModulesDir = path.join(context.globalStorageUri.fsPath, "lspVersions", lspVersionSpec);
            const requiredBoxJson = path.join(lspModulesDir, "bx-lsp", "box.json");

            if (!fs.existsSync(requiredBoxJson)) {
                return `LSP module not found at expected location: ${requiredBoxJson}`;
            }

            const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
            const runtimeJarPath = await getConfiguredBoxLangJarPath();

            const res: BoxLangResult = await new Promise((resolve) => {
                const proc = trackedSpawn(javaExecutable, ["ortus.boxlang.runtime.BoxRunner", "module:bx-lsp", "version"], {
                    env: {
                        ...process.env,
                        JAVA_HOME: ExtensionConfig.boxlangJavaHome,
                        BOXLANG_HOME: this.boxlangHome,
                        BOXLANG_MODULESDIRECTORY: lspModulesDir,
                        CLASSPATH: runtimeJarPath
                    }
                });

                let stdout = "";
                let stderr = "";
                proc.stdout.on("data", (data) => stdout += data);
                proc.stderr.on("data", (data) => stderr += data);

                proc.on("exit", (code) => {
                    resolve({
                        code: code ?? 0,
                        stdout,
                        stderr
                    });
                });
            });

            if (res.code !== 0) {
                return res.stderr || res.stdout || `Failed to retrieve LSP version (exit ${res.code}).`;
            }

            return res.stdout;
        } catch (e: any) {
            return `Error retrieving LSP version info: ${e?.message || e}`;
        }
    }

    async getMiniServerVersionOutput(): Promise<string> {
        try {
            const jarPath = ExtensionConfig.boxlangMiniServerJarPath;

            if (!jarPath) {
                return "No MiniServer JAR is configured (boxlang.miniserverjarpath).";
            }

            if (!fs.existsSync(jarPath)) {
                return `MiniServer JAR not found: ${jarPath}`;
            }

            const version = await tryGetMiniServerVersionFromJar(jarPath);

            const lines: string[] = [];
            lines.push(`JAR: ${jarPath}`);
            lines.push(`Version: ${version || "Unknown"}`);
            return lines.join("\n");
        } catch (e: any) {
            return `Error retrieving MiniServer version info: ${e?.message || e}`;
        }
    }

}

export class BoxLang {

    static startLSP(): Promise<Array<any>> {
        boxlangOutputChannel.appendLine("Starting the LSP");
        return new Promise((resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
            const maxHeapSizeArg = `-Xmx${ExtensionConfig.boxlangMaxHeapSize}m`;
            const lsp = trackedSpawn(javaExecutable, [maxHeapSizeArg, "ortus.boxlang.runtime.BoxRunner", "module:bx-lsp"], {
                env: {
                    ...process.env,
                    JAVA_HOME: ExtensionConfig.boxlangJavaHome,
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
        return startConfiguredDebugger(BOXLANG_HOME);
    }

    static async getVersionOutput(): Promise<string> {
        const res = await runBoxLangWithHome(BOXLANG_HOME, "--version");

        if( res.code != 0 ){
            return res.stderr
        }

        return res.stdout;
    }

    static async stopMiniServer(server: BoxServerConfig): Promise<void> {
        runningServers[server.name].kill();
    }

    static async startMiniServer(server: BoxServerConfig): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
            const debugPort = await findAvailableDebugPort();
            const cliArgs = await getMiniServerCLIArgs(server, debugPort);
            const boxLang = trackedSpawn(javaExecutable, cliArgs, {
                env: {
                    ...process.env,
                    JAVA_HOME: ExtensionConfig.boxlangJavaHome,
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

    if( server.rewrites != null ){
        cliArgs.push("--rewrites", server.rewrites );
    }

    return cliArgs;
}

async function tryReadJarManifest(jarPath: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
        yauzl.open(jarPath, { lazyEntries: true }, (err: any, zipfile: any) => {
            if (err) {
                reject(err);
                return;
            }

            let resolved = false;

            const finish = (value: string | null) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                try {
                    zipfile.close();
                } catch {}
                resolve(value);
            };

            zipfile.readEntry();
            zipfile.on("entry", (entry: any) => {
                if (entry.fileName === "META-INF/MANIFEST.MF") {
                    zipfile.openReadStream(entry, (streamErr: any, readStream: any) => {
                        if (streamErr) {
                            reject(streamErr);
                            return;
                        }

                        const chunks: Buffer[] = [];
                        readStream.on("data", (c: Buffer) => chunks.push(c));
                        readStream.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
                        readStream.on("error", (e: any) => reject(e));
                    });
                    return;
                }

                zipfile.readEntry();
            });

            zipfile.on("end", () => finish(null));
            zipfile.on("error", (e: any) => reject(e));
        });
    });
}

function parseManifestAttributes(manifestText: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const lines = manifestText.replace(/\r\n/g, "\n").split("\n");

    let currentKey: string | null = null;
    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line) {
            currentKey = null;
            continue;
        }

        if (line.startsWith(" ") && currentKey) {
            attrs[currentKey] = (attrs[currentKey] || "") + line.slice(1);
            continue;
        }

        const idx = line.indexOf(":");
        if (idx <= 0) {
            currentKey = null;
            continue;
        }

        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        attrs[key] = value;
        currentKey = key;
    }

    return attrs;
}

async function tryGetMiniServerVersionFromJar(jarPath: string): Promise<string | undefined> {
    // Prefer manifest version if available
    try {
        const manifestText = await tryReadJarManifest(jarPath);
        if (manifestText) {
            const attrs = parseManifestAttributes(manifestText);
            const version =
                attrs["Implementation-Version"] ||
                attrs["Bundle-Version"] ||
                attrs["Specification-Version"] ||
                attrs["Version"];

            if (version) {
                return version;
            }
        }
    } catch {
        // fall through to filename parsing
    }

    const fileName = path.basename(jarPath);
    const match = /^boxlang-miniserver-(.+)\.jar$/.exec(fileName);
    return match?.[1];
}