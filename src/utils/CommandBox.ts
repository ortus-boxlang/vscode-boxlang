import { spawn } from "child_process";
import { boxlangOutputChannel } from "../utils/OutputChannels";

type CommandBoxResult = {
    code: number,
    stdout: string,
    stderr: string
}

// function getCommandBoxHome() {
//     if (process.env.COMMANDBOX_HOME) {
//         return process.env.COMMANDBOX_HOME
//     }

//     return path.join(process.env.USERPROFILE, ".CommandBox")
// }

async function runCommandBox(env: Record<string, any>, ...args: string[]): Promise<CommandBoxResult> {
    return new Promise((resolve, reject) => {
        const boxLang = spawn("box", args, {
            env: env
        });
        let stdout = '';
        let stderr = '';

        boxLang.stdout.on("data", data => {
            boxlangOutputChannel.appendLine(data + "");
            stdout += data;
        });

        boxLang.stderr.on("data", data => {
            boxlangOutputChannel.appendLine(data + "");
            stderr += data;
        });

        boxLang.on("exit", code => {
            resolve({
                code,
                stdout,
                stderr
            });
        });
    });
}

export async function installBoxLangModule(boxlangHome: string, moduleName: string): Promise<CommandBoxResult> {
    return runCommandBox({ BOXLANG_HOME: boxlangHome }, "install", moduleName, "--verbose");
}

export async function uninstallBoxLangModule(boxlangHome, moduleName: string): Promise<CommandBoxResult> {
    return runCommandBox({ BOXLANG_HOME: boxlangHome }, "uninstall", moduleName, "--verbose");
}