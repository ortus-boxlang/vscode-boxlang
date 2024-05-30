
import { spawn } from "child_process";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { ExtensionConfig } from "./Configuration";

let javaIsOkay = null;

export function detectJavaVerison(refresh = false) {
    return new Promise((resolve, reject) => {
        if (!refresh && javaIsOkay !== null) {
            resolve(javaIsOkay);
            return;
        }

        const javaExecutable = ExtensionConfig.boxlangJavaHome;

        const boxLang = spawn(javaExecutable, ["--version"]);
        let stdout = '';
        let stderr = '';

        boxLang.stdout.on("data", data => stdout += data);
        boxLang.stderr.on("data", data => stderr += data);

        boxLang.on("error", e => {
            resolve(false);
        });

        boxLang.on("exit", code => {
            const matches = /(\d+)\.\d+\.\d+/g.exec(stdout);

            if (!matches.length) {
                boxlangOutputChannel.appendLine("No java executable was found on the path");
                javaIsOkay = false;
                resolve(javaIsOkay);
                return;
            }

            if (Number.parseInt(matches[1]) < 21) {
                boxlangOutputChannel.appendLine(`This extension requires a version of java newer than ${matches[0]}. Try setting a custom JVM location in boxlang.java.javaHome setting.`);
                javaIsOkay = false;
                resolve(javaIsOkay);
                return;
            }

            javaIsOkay = true;
            resolve(javaIsOkay);
        });
    });
}