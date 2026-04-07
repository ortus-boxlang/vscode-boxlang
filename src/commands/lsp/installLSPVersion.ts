import * as fs from "fs/promises";
import * as path from "path";
import semver from "semver";
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import { ForgeBoxClient } from "../../utils/ForgeBoxClient";
import { startLSP, stop } from "../../utils/LanguageServer";
import { ModuleManager } from "../../utils/ModuleManager";
import { boxlangOutputChannel } from "../../utils/OutputChannels";

export function compareBoxLangLspVersionsDescending(a: string, b: string): number {
    const [aBase, aBuild] = a.split("+");
    const [bBase, bBuild] = b.split("+");

    if (!semver.valid(aBase) && !semver.valid(bBase)) {
        boxlangOutputChannel.appendLine(`BoxLang LSP: Skipping sort — both versions are invalid: "${a}" and "${b}"`);
        return 0;
    }
    if (!semver.valid(aBase)) {
        boxlangOutputChannel.appendLine(`BoxLang LSP: Invalid LSP version string encountered during sort: "${a}" — ignoring and sorting to end`);
        return 1;
    }
    if (!semver.valid(bBase)) {
        boxlangOutputChannel.appendLine(`BoxLang LSP: Invalid LSP version string encountered during sort: "${b}" — ignoring and sorting to end`);
        return -1;
    }

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

type LspPickResult =
    | { needsInstall: true; version: string; versionSpec: string }
    | { versionSpec: string };

const RECENT_VERSION_LIMIT = 10;
const SHOW_ALL_LABEL = "Show older versions...";

async function fetchLspData(context: ExtensionContext): Promise<{ versions: string[]; installedSpecs: Set<string>; currentSpec: string }> {
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

    return { versions, installedSpecs, currentSpec };
}

async function pickLspVersion(
    versions: string[],
    installedSpecs: Set<string>,
    currentSpec: string,
    context: ExtensionContext,
    showAll: boolean
): Promise<LspPickResult | null> {
    let visibleVersions = versions;
    let hasOlderVersions = false;

    if (!showAll && versions.length > RECENT_VERSION_LIMIT) {
        const recent = versions.slice(0, RECENT_VERSION_LIMIT);
        const currentVersion = currentSpec ? currentSpec.replace(/^bx-lsp@/, "") : "";
        const currentIsRecent = !currentVersion || recent.includes(currentVersion);
        visibleVersions = currentIsRecent ? recent : [...recent, currentVersion].filter(v => versions.includes(v));
        hasOlderVersions = true;
    }

    return new Promise((resolve) => {
        const items: vscode.QuickPickItem[] = [];

        if (hasOlderVersions) {
            items.push({ label: SHOW_ALL_LABEL, description: "" });
        }

        for (const version of visibleVersions) {
            const versionSpec = `bx-lsp@${version}`;
            const isCurrent = currentSpec === versionSpec;
            const isInstalled = installedSpecs.has(versionSpec);

            let description = "";
            if (isCurrent) {
                description = "Current";
            } else if (isInstalled) {
                description = "Installed";
            }

            items.push({ label: version, description });
        }

        const picker = vscode.window.createQuickPick();
        picker.title = "Select BoxLang LSP Version";
        picker.items = items;
        picker.matchOnDescription = true;

        let accepted = false;

        picker.onDidAccept(() => {
            accepted = true;
            const selection = picker.activeItems[0];
            picker.hide();

            if (selection.label === SHOW_ALL_LABEL) {
                resolve(pickLspVersion(versions, installedSpecs, currentSpec, context, true));
            } else {
                const versionSpec = `bx-lsp@${selection.label}`;
                if (installedSpecs.has(versionSpec)) {
                    resolve({ versionSpec });
                } else {
                    resolve({ needsInstall: true, version: selection.label, versionSpec });
                }
            }
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
        const data = await vscode.window.withProgress(
            { title: "BoxLang: Fetching LSP versions", location: ProgressLocation.Notification },
            async () => fetchLspData(context)
        );

        const result = await pickLspVersion(data.versions, data.installedSpecs, data.currentSpec, context, false);

        if (!result) {
            return;
        }

        if ("needsInstall" in result) {
            const { version, versionSpec } = result;
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
        } else {
            await vscode.window.withProgress(
                { title: `BoxLang: Switching to LSP Version: ${result.versionSpec}`, location: ProgressLocation.Notification },
                async () => {
                    ExtensionConfig.boxlangLSPVersion = result.versionSpec;
                    boxlangOutputChannel.appendLine(`BoxLang: LSP version set to ${result.versionSpec}`);
                    await restartLsp();
                }
            );
        }

        vscode.window.showInformationMessage(`BoxLang: LSP updated to ${result.versionSpec}`);
    } catch (e) {
        boxlangOutputChannel.appendLine("Unable to install LSP version");
        boxlangOutputChannel.appendLine(e);
        vscode.window.showErrorMessage(`Unable to install LSP version: ${e?.toString?.() || e}`);
    }
}
