import * as fs from "fs/promises";
import * as path from "path";
import semver from "semver";
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import { ForgeBoxClient } from "../../utils/ForgeBoxClient";
import { startLSP, stop } from "../../utils/LanguageServer";
import { ModuleManager } from "../../utils/ModuleManager";
import { boxlangOutputChannel } from "../../utils/OutputChannels";

function compareBoxLangLspVersionsDescending(a: string, b: string): number {
    const [aBase, aBuild] = a.split("+");
    const [bBase, bBuild] = b.split("+");

    const baseCmp = semver.rcompare(aBase, bBase);
    if (baseCmp !== 0) {
        return baseCmp;
    }

    const aBuildNum = aBuild ? Number.parseInt(aBuild, 10) : -1;
    const bBuildNum = bBuild ? Number.parseInt(bBuild, 10) : -1;

    if (Number.isNaN(aBuildNum) && Number.isNaN(bBuildNum)) {
        return 0;
    }

    if (Number.isNaN(aBuildNum)) {
        return 1;
    }

    if (Number.isNaN(bBuildNum)) {
        return -1;
    }

    return bBuildNum - aBuildNum;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function isNonEmptyDir(dirPath: string): Promise<boolean> {
    try {
        const entries = await fs.readdir(dirPath);
        return entries.length > 0;
    } catch {
        return false;
    }
}

async function getInstalledVersionSpecs(lspVersionsParentDir: string): Promise<Set<string>> {
    const specs = new Set<string>();

    if (!(await fileExists(lspVersionsParentDir))) {
        return specs;
    }

    const entries = await fs.readdir(lspVersionsParentDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const fullPath = path.join(lspVersionsParentDir, entry.name);
        if (await isNonEmptyDir(fullPath)) {
            specs.add(entry.name);
        }
    }

    return specs;
}

async function pickLspVersion(context: ExtensionContext): Promise<string> {
    const lspVersionsParentDir = path.join(context.globalStorageUri.fsPath, "lspVersions");
    const installedSpecs = await getInstalledVersionSpecs(lspVersionsParentDir);

    const currentSpec = ExtensionConfig.boxlangLSPVersion;

    const forgeBoxClient = new ForgeBoxClient();
    const metadata = await forgeBoxClient.getModuleMetadata("bx-lsp");

    const versionSet = new Set<string>();
    if (metadata.latestVersion?.version) {
        versionSet.add(metadata.latestVersion.version);
    }
    for (const v of metadata.versions || []) {
        if (v?.version) {
            versionSet.add(v.version);
        }
    }

    const versions = Array.from(versionSet)
        .filter(v => typeof v === "string" && v.length > 0)
        .sort(compareBoxLangLspVersionsDescending);

    const items: Array<vscode.QuickPickItem & { version: string }> = versions.map(version => {
        const spec = `bx-lsp@${version}`;
        const isCurrent = currentSpec === spec;
        const isInstalled = installedSpecs.has(spec);

        let description = "";
        if (isCurrent) {
            description = "Current";
        } else if (isInstalled) {
            description = "Already Installed";
        }

        return {
            label: version,
            description,
            version
        };
    });

    return new Promise((resolve) => {
        const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { version: string }>();
        picker.title = "Install BoxLang LSP Version";
        picker.items = items;
        picker.matchOnDescription = true;
        picker.canSelectMany = false;

        picker.onDidAccept(() => {
            const selection = picker.activeItems[0];
            if (selection) {
                resolve(selection.version);
            }
            picker.hide();
        });

        picker.onDidHide(() => {
            picker.dispose();
        });

        picker.show();
    });
}

async function restartLsp(): Promise<void> {
    try {
        await stop();
    } catch (e) {
        boxlangOutputChannel.appendLine("Unable to stop LSP");
        boxlangOutputChannel.appendLine(e);
    }

    await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 5000);
    });

    await startLSP();
}

export async function installLSPVersion(context: ExtensionContext) {
    try {
        const version = await vscode.window.withProgress(
            { title: "BoxLang: Fetching LSP versions", location: ProgressLocation.Notification },
            async () => {
                return pickLspVersion(context);
            }
        );

        if (!version) {
            return;
        }

        const versionSpec = `bx-lsp@${version}`;
        const lspVersionsParentDir = path.join(context.globalStorageUri.fsPath, "lspVersions");
        const lspVersionDir = path.join(lspVersionsParentDir, versionSpec);

        await vscode.window.withProgress(
            { title: `BoxLang: Installing LSP Version: ${version}`, location: ProgressLocation.Notification },
            async () => {
                await fs.mkdir(lspVersionsParentDir, { recursive: true });

                const moduleManager = new ModuleManager(true);
                await moduleManager.installModuleToDir(versionSpec, lspVersionDir, true);

                const boxJsonPath = path.join(lspVersionDir, "bx-lsp", "box.json");
                if (!(await fileExists(boxJsonPath))) {
                    throw new Error(`LSP installation is missing box.json: ${boxJsonPath}`);
                }

                ExtensionConfig.boxlangLSPVersion = versionSpec;

                boxlangOutputChannel.appendLine(`BoxLang: LSP version set to ${versionSpec}`);

                await restartLsp();
            }
        );

        vscode.window.showInformationMessage(`BoxLang: LSP updated to ${versionSpec}`);
    } catch (e) {
        boxlangOutputChannel.appendLine("Unable to install LSP version");
        boxlangOutputChannel.appendLine(e);
        vscode.window.showErrorMessage(`Unable to install LSP version: ${e?.toString?.() || e}`);
    }
}
