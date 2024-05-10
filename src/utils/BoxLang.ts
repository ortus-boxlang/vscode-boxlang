import { spawn } from "child_process";
import { OutputChannel } from "vscode";
import { ExtensionConfig } from "../utils/Configuration";

type BoxLangResult = {
    code: Number,
    stdout: string,
    stderr: string
}

async function runBoxLang(...args: string[]): Promise<BoxLangResult> {
    return new Promise((resolve, reject) => {
        const boxLang = spawn("java", ["ortus.boxlang.runtime.BoxRunner"].concat(args), {
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
    static startLSP(outputChannel: OutputChannel): Promise<Array<any>> {
        outputChannel.appendLine("Starting the LSP");
        return new Promise((resolve, reject) => {
            const lsp = spawn("java", ["ortus.boxlanglsp.App"], {
                env: {
                    CLASSPATH: ExtensionConfig.boxlangJarPath + getJavaCLASSPATHSeparator() + ExtensionConfig.boxlangLSPPath
                }
            });

            let stdout = '';
            let stderr = '';
            let found = false;

            lsp.on("error", (err) => {
                outputChannel.appendLine(err + "");
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
                console.log(stderr += data);
                outputChannel.appendLine(data + "");
            });
        })
    }

    static async startDebugger(): Promise<string> {
        console.log(ExtensionConfig.boxlangJarPath);
        return new Promise((resolve, reject) => {
            const boxLang = spawn("java", ["ortus.boxlang.debugger.DebugMain"], {
                env: {
                    CLASSPATH: ExtensionConfig.boxlangJarPath
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

    static async startWebServer(): Promise<string> {
        return new Promise((resolve, reject) => {
            const boxLang = spawn("java", ["ortus.boxlang.debugger.DebugMain", "--web-server"], {
                env: {
                    CLASSPATH: ExtensionConfig.boxlangJarPath
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

    async getASTJSON(code) {
        const result = await runBoxLang("--printAST", "-c", code);

        return result.stdout.replace(/\\n/g, '\\\\n')
            .replace(/\\r/g, '\\\\r')
            .replace(/\\"/g, '\\\\"');
    }

    async transpileToJava(filePath: string): Promise<string> {
        try {
            const result = await runBoxLang("--transpile", filePath);

            if (result.stderr) {
                console.log(result.stderr);
            }

            return result.stdout;
        }
        catch (e) {
            var test = 4;
        }
    }
}

function getJavaCLASSPATHSeparator(): string {
    return process.platform === "win32" ? ";" : ":";
}