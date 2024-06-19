import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BoxLang } from "../utils/BoxLang";
import { ExtensionConfig } from "../utils/Configuration";
import { appendToOpenDocument } from "../utils/documentUtil";

export async function outputVersionInfo(context: vscode.ExtensionContext) {
    const versionInfo = [];
    const packageJSON = JSON.parse("" + fs.readFileSync(path.join(context.extensionPath, "./package.json")));

    versionInfo.push(`BoxLang Extension Version Info`);
    versionInfo.push(``);
    versionInfo.push(`  Version:      ${packageJSON.version}`);
    versionInfo.push(`  Preview:      ${packageJSON.preview}`);
    versionInfo.push(`  Exported On:  ${new Date()}`);
    versionInfo.push(``);

    versionInfo.push(`Setting Configuration`);
    versionInfo.push(``);
    versionInfo.push(`  boxlangJavaHome:            ${ExtensionConfig.boxlangJavaHome}`);
    versionInfo.push(`  boxlangJarPath:             ${ExtensionConfig.boxlangJarPath}`);
    versionInfo.push(`  boxlangLSPPath:             ${ExtensionConfig.boxlangLSPPath}`);
    versionInfo.push(`  boxlangMiniServerJarPath:   ${ExtensionConfig.boxlangMiniServerJarPath}`);
    versionInfo.push(`  boxlangServerPort:          ${ExtensionConfig.boxlangServerPort}`);
    versionInfo.push(`  customAntlrToolsCommand:    ${ExtensionConfig.customAntlrToolsCommand}`);
    versionInfo.push(``);

    versionInfo.push(`BoxLang Version Info`);
    versionInfo.push(``);

    const boxlangVersionInfo = await BoxLang.getVersionOutput();

    versionInfo.push(boxlangVersionInfo.split("\n").map(line => "  " + line).join("\n"));
    versionInfo.push(``);

    appendToOpenDocument(vscode.Uri.file('boxlang_version_info.txt').with({ scheme: "untitled", }), versionInfo.join("\n"));
}