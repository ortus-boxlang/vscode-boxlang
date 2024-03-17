import { spawn } from "child_process";
import * as path from "path";
import * as vscode from "vscode";

type BoxLangResult = {
    code: Number,
    stdout: string,
    stderr: string
}

export const BOXLANG_JAR_PATH = path.resolve(__dirname, path.join("../../", "resources", "lib", "boxlang-1.0.0-all.jar"));

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
            console.log(BOXLANG_JAR_PATH);
            // const boxLang = spawn("java", ["-cp", BOXLANG_JAR_PATH, "ortus.boxlang.debugger.DebugMain"]);
            const boxLang = spawn("java", ["ortus.boxlang.debugger.DebugMain"], {
                // shell: true,
                env: {
                    CLASSPATH: BOXLANG_JAR_PATH
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
                    CLASSPATH: BOXLANG_JAR_PATH
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