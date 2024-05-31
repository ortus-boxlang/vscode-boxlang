import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { window } from "vscode";
import { ExtensionConfig } from "../utils/Configuration";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { BoxServerConfig, trackServerStart, trackServerStop } from "./Server";

type BoxLangResult = {
    code: Number,
    stdout: string,
    stderr: string
}

const runningServers: Record<string, ChildProcessWithoutNullStreams> = {};

async function runBoxLang(...args: string[]): Promise<BoxLangResult> {
    return new Promise((resolve, reject) => {
        const javaExecutable = ExtensionConfig.boxlangJavaHome;
        const boxLang = spawn(javaExecutable, ["ortus.boxlang.runtime.BoxRunner"].concat(args), {
            env: {
                CLASSPATH: ExtensionConfig.boxlangJarPath
            }
        });
        let stdout = '';
        let stderr = '';

        boxLang.stdout.on("data", data => stdout += data);
        // TODO: throw error
        boxLang.stderr.on("data", data => stderr += data);

        boxLang.on("error", e => {
            console.log(e + "");
        })

        boxLang.on("exit", code => {
            resolve({
                code,
                stdout,
                stderr
            });
        });
    });
}

export class BoxLang {
    static startLSP(): Promise<Array<any>> {
        boxlangOutputChannel.appendLine("Starting the LSP");
        return new Promise((resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaHome;
            const lsp = spawn(javaExecutable, ["ortus.boxlanglsp.App"], {
                env: {
                    CLASSPATH: ExtensionConfig.boxlangJarPath + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangLSPPath
                }
            });

            let stdout = '';
            let found = false;

            lsp.on("error", (err) => {
                boxlangOutputChannel.appendLine(err + "");
                console.log(err + "");
            })

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
            const boxLang = spawn(javaExecutable, ["ortus.boxlang.debugger.DebugMain"], {
                env: {
                    CLASSPATH: ExtensionConfig.boxlangJarPath + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangMiniServerJarPath
                }
            });
            let stdout = '';
            let stderr = '';
            let found = false;

            boxLang.stdout.on("data", data => {
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

            boxLang.stderr.on("data", data => console.log(stderr += data));
        });
    }

    static async stopMiniServer(server: BoxServerConfig): Promise<void> {
        runningServers[server.name].kill();
    }

    static async startMiniServer(server: BoxServerConfig): Promise<string> {
        return new Promise((resolve, reject) => {
            const javaExecutable = ExtensionConfig.boxlangJavaHome;
            const boxLang = spawn(javaExecutable, ["ortus.boxlang.web.MiniServer", "--port", "" + server.port, "--webroot", server.directoryAbsolute], {
                env: {
                    CLASSPATH: ExtensionConfig.boxlangJarPath + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangMiniServerJarPath
                }
            });

            const outputChannel = window.createOutputChannel(`BoxLang - ${server.name}`);

            boxLang.stdout.on("data", data => outputChannel.appendLine(data));
            boxLang.stderr.on("data", data => outputChannel.appendLine(data));

            trackServerStart(server.name);
            runningServers[server.name] = boxLang;

            boxLang.on("close", () => {
                trackServerStop(server.name);
                outputChannel.dispose();
            });
        });
    }

    async getASTJSON(code) {
        const result = await runBoxLang("--printAST", "-c", code);

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