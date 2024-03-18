import { spawn } from "child_process";
import * as vscode from "vscode";
import { ExtensionConfig } from "../utils/Configuration";

type BoxLangResult = {
    code: Number,
    stdout: string,
    stderr: string
}

async function runBoxLang(...args: string[]): Promise<BoxLangResult> {
    const jarPath = vscode.workspace.getConfiguration("cfml.boxlang").get<string>('jarpath');

    return new Promise((resolve, reject) => {
        const boxLang = spawn("java", ["-jar", jarPath].concat(args));
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

export class BoxLang {
    static async startDebugger(): Promise<string> {
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
        const result = await runBoxLang("--transpile", filePath);

        return result.stdout;
    }
}