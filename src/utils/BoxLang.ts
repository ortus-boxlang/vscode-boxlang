import { spawn } from "child_process";
import * as vscode from "vscode";

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
    async getASTJSON(code) {
        const result = await runBoxLang("--printAST", "-c", code);

        return result.stdout.replace(/\\n/g, '\\\\n').replace(/\\"/g, '\\\\"');
    }

    async transpileToJava(filePath: string): Promise<string> {
        const result = await runBoxLang("--transpile", filePath);

        return result.stdout;
    }
}