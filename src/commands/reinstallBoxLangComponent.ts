import * as fs from "fs/promises";
import * as path from "path";
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../utils/Configuration";
import {
    extractVersionFromSpec,
    getConfiguredDebuggerVersionSpec,
    installDebuggerVersionSpec
} from "../utils/DebuggerManager";
import { startLSP, stop } from "../utils/LanguageServer";
import { ModuleManager } from "../utils/ModuleManager";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { getDownloadedBoxLangVersions, installVersion } from "../utils/versionManager";
import { DownloadManager } from "../utils/DownloadManager";

type Component = "BoxLang" | "LSP" | "Debugger" | "MiniServer";

async function pickComponent(): Promise<Component | null> {
    return new Promise((resolve) => {
        const picker = vscode.window.createQuickPick();
        picker.title = "Reinstall BoxLang Component";
        picker.placeholder = "Select a component to force-reinstall";
        picker.items = [
            { label: "BoxLang", description: "Reinstall the current BoxLang runtime" },
            { label: "LSP", description: "Reinstall the current Language Server" },
            { label: "Debugger", description: "Reinstall the current Debugger" },
            { label: "MiniServer", description: "Reinstall the current MiniServer" }
        ];

        let accepted = false;

        picker.onDidAccept(() => {
            accepted = true;
            const selection = picker.activeItems[0];
            picker.hide();
            resolve(selection?.label as Component ?? null);
        });

        picker.onDidHide(() => {
            if (!accepted) {
                resolve(null);
            }
            picker.dispose();
        });

        picker.show();
    });
}

async function reinstallBoxLang(): Promise<void> {
    const currentJarPath = ExtensionConfig.boxlangJarPath;
    const downloaded = await getDownloadedBoxLangVersions();
    const current = downloaded.find(v => v.jarPath === currentJarPath);

    if (!current) {
        throw new Error("No managed BoxLang version is currently active. Use 'Select BoxLang Version' to pick one first.");
    }

    await vscode.window.withProgress(
        { title: `BoxLang: Reinstalling ${current.name}`, location: ProgressLocation.Notification },
        async () => {
            const jarPath = await installVersion(current);
            ExtensionConfig.boxlangJarPath = jarPath;
        }
    );

    vscode.window.showInformationMessage(`BoxLang: ${current.name} has been reinstalled`);
}

async function reinstallLSP(context: ExtensionContext): Promise<void> {
    const versionSpec = ExtensionConfig.boxlangLSPVersion;

    if (!versionSpec) {
        throw new Error("No LSP version is currently configured. Use 'Select LSP Version' to pick one first.");
    }

    const lspVersionsParentDir = path.join(context.globalStorageUri.fsPath, "lspVersions");
    const lspVersionDir = path.join(lspVersionsParentDir, versionSpec);

    await vscode.window.withProgress(
        { title: `BoxLang: Reinstalling LSP ${versionSpec}`, location: ProgressLocation.Notification },
        async () => {
            // Remove existing install so ModuleManager installs fresh
            try {
                await fs.rm(lspVersionDir, { recursive: true, force: true });
            } catch {
                // pass
            }

            await fs.mkdir(lspVersionsParentDir, { recursive: true });

            const moduleManager = new ModuleManager(true);
            await moduleManager.installModuleToDir(versionSpec, lspVersionDir, true);

            const boxJsonPath = path.join(lspVersionDir, "bx-lsp", "box.json");
            try {
                await fs.access(boxJsonPath);
            } catch {
                throw new Error(`LSP installation is missing box.json: ${boxJsonPath}`);
            }

            // Record install date so future update checks work
            await fs.writeFile(
                path.join(lspVersionDir, "version.json"),
                JSON.stringify({ versionSpec, createDate: new Date().toISOString() })
            );

            ExtensionConfig.boxlangLSPVersion = versionSpec;
            boxlangOutputChannel.appendLine(`BoxLang: LSP reinstalled: ${versionSpec}`);

            try {
                await stop();
            } catch (e) {
                boxlangOutputChannel.appendLine("Unable to stop LSP during reinstall");
                boxlangOutputChannel.appendLine(e);
            }

            await new Promise<void>((resolve) => setTimeout(resolve, 5000));
            await startLSP();
        }
    );

    vscode.window.showInformationMessage(`BoxLang: LSP ${versionSpec} has been reinstalled`);
}

async function reinstallDebugger(): Promise<void> {
    const versionSpec = getConfiguredDebuggerVersionSpec();

    if (!versionSpec) {
        throw new Error("No debugger version is currently configured. Use 'Select Debugger Version' to pick one first.");
    }

    await vscode.window.withProgress(
        { title: `BoxLang: Reinstalling Debugger ${versionSpec}`, location: ProgressLocation.Notification },
        async () => {
            await installDebuggerVersionSpec(versionSpec);
            ExtensionConfig.boxlangDebuggerModuleVersion = extractVersionFromSpec(versionSpec);
            boxlangOutputChannel.appendLine(`BoxLang: Debugger reinstalled: ${versionSpec}`);
        }
    );

    vscode.window.showInformationMessage(`BoxLang: Debugger ${versionSpec} has been reinstalled`);
}

async function reinstallMiniServer(context: ExtensionContext): Promise<void> {
    const configuredJar = ExtensionConfig.boxlangMiniServerJarPath;
    const configuredFileName = configuredJar ? path.basename(configuredJar) : "";
    const match = /^boxlang-miniserver-(.+)\.jar$/.exec(configuredFileName);
    const version = match?.[1];

    if (!version) {
        throw new Error("No managed MiniServer version is currently active. Use 'Select MiniServer Version' to pick one first.");
    }

    const parentDir = path.join(context.globalStorageUri.fsPath, "miniserverVersions");
    const versionDir = path.join(parentDir, `boxlang-miniserver-${version}`);
    const jarPath = path.join(versionDir, `boxlang-miniserver-${version}.jar`);

    await vscode.window.withProgress(
        { title: `BoxLang: Reinstalling MiniServer ${version}`, location: ProgressLocation.Notification },
        async () => {
            await fs.mkdir(versionDir, { recursive: true });
            await DownloadManager.downloadMiniServer(version, jarPath);

            await fs.writeFile(
                path.join(versionDir, "version.json"),
                JSON.stringify({ name: `boxlang-miniserver-${version}`, version, jarPath, installedAt: new Date().toISOString() }, null, 4)
            );

            ExtensionConfig.boxlangMiniServerJarPath = jarPath;
            boxlangOutputChannel.appendLine(`BoxLang: MiniServer reinstalled: ${version}`);
        }
    );

    vscode.window.showInformationMessage(`BoxLang: MiniServer ${version} has been reinstalled`);
}

export async function reinstallBoxLangComponent(context: ExtensionContext) {
    const component = await pickComponent();

    if (!component) {
        return;
    }

    try {
        if (component === "BoxLang") {
            await reinstallBoxLang();
        } else if (component === "LSP") {
            await reinstallLSP(context);
        } else if (component === "Debugger") {
            await reinstallDebugger();
        } else if (component === "MiniServer") {
            await reinstallMiniServer(context);
        }
    } catch (e) {
        vscode.window.showErrorMessage(`BoxLang: Failed to reinstall ${component}: ${e?.toString?.() || e}`);
        boxlangOutputChannel.appendLine(`Failed to reinstall ${component}: ${e}`);
    }
}
