import * as fs from "fs/promises";
import * as path from "path";
import semver from "semver";
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import { ForgeBoxClient } from "../../utils/ForgeBoxClient";
import { requestRestart } from "../../utils/LanguageServer";
import { parseDate } from "../../utils/dateUtil";
import { ModuleManager } from "../../utils/ModuleManager";
import { boxlangOutputChannel } from "../../utils/OutputChannels";
import { findInstalledLSPBuild, getLSPUpdateChannel, installLSPBuild, listInstalledLSPBuilds, publishLSPUpdate } from "../../utils/SharedLSPUpdates";

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

type InstalledLspVersion = { date: Date; binaryHash?: string };

async function getInstalledVersionData(lspVersionsParentDir: string): Promise<Map<string, InstalledLspVersion>> {
    const result = new Map<string, InstalledLspVersion>();

    const storagePath = path.dirname(lspVersionsParentDir);
    for (const build of await listInstalledLSPBuilds(storagePath)) {
        const fullPath = path.join(storagePath, build.relativePath);
        let installed: InstalledLspVersion;
        let binaryHash: string | undefined;
        try {
            const versionJson = JSON.parse((await fs.readFile(path.join(fullPath, "version.json"))) + "");
            binaryHash = versionJson.binaryHash;
            const parsedDate = parseDate(versionJson.updatedDate) ?? parseDate(versionJson.createDate) ?? parseDate(versionJson.installedAt);
            if (!parsedDate) {
                throw new Error("Invalid install date");
            }
            installed = { date: parsedDate, binaryHash };
        } catch {
            // Fall back to directory mtime for installs predating version.json
            const stat = await fs.stat(fullPath);
            installed = { date: stat.mtime, binaryHash };
        }

        result.set(build.versionSpec, installed);
    }

    return result;
}

type LspPickResult =
    | { needsInstall: true; version: string; versionSpec: string }
    | { versionSpec: string };

const RECENT_VERSION_LIMIT = 10;
const SHOW_ALL_LABEL = "Show older versions...";

function isInstalledVersionOutdated(
    versionSpec: string,
    installedDates: Map<string, InstalledLspVersion>,
    remoteUpdatedDates: Map<string, Date>,
    remoteBinaryHashes: Map<string, string>
): boolean {
    const installed = installedDates.get(versionSpec);
    if (!installed) {
        return false;
    }

    const remoteHash = remoteBinaryHashes.get(versionSpec);
    if (remoteHash) {
        return installed.binaryHash !== remoteHash;
    }

    const remoteDate = remoteUpdatedDates.get(versionSpec);
    return !!remoteDate && remoteDate > installed.date;
}

async function fetchLspData(context: ExtensionContext): Promise<{
    versions: string[];
    remoteUpdatedDates: Map<string, Date>;
    remoteBinaryHashes: Map<string, string>;
    installedDates: Map<string, InstalledLspVersion>;
    currentSpec: string;
}> {
    const lspVersionsParentDir = path.join(context.globalStorageUri.fsPath, "lspVersions");
    const installedDates = await getInstalledVersionData(lspVersionsParentDir);
    const currentSpec = ExtensionConfig.boxlangLSPVersion;

    const forgeBoxClient = new ForgeBoxClient();
    const metadata = await forgeBoxClient.getModuleMetadata("bx-lsp");
    const versionEntries = [metadata.latestVersion, ...(metadata.versions || [])].filter(v => !!v?.version);
    const versionSet = new Set(versionEntries.map(v => v.version));
    const remoteUpdatedDates = new Map<string, Date>();
    const remoteBinaryHashes = new Map<string, string>();

    for (const version of versionEntries) {
        const versionSpec = `bx-lsp@${version.version}`;
        const remoteDate = parseDate(version.modifyDate) ?? parseDate(version.createDate);
        if (remoteDate) {
            remoteUpdatedDates.set(versionSpec, remoteDate);
        }
        if (version.binaryHash) {
            remoteBinaryHashes.set(versionSpec, version.binaryHash);
        }
    }

    await Promise.all(Array.from(installedDates.keys(), async versionSpec => {
        const version = versionSpec.replace(/^bx-lsp@/, "");
        if (!versionSet.has(version) || remoteUpdatedDates.has(versionSpec) || remoteBinaryHashes.has(versionSpec)) {
            return;
        }
        try {
            const versionMetadata = await forgeBoxClient.getModuleVersionMetadata("bx-lsp", version);
            const remoteDate = parseDate(versionMetadata.updatedDate) ?? parseDate(versionMetadata.createdDate);
            if (remoteDate) {
                remoteUpdatedDates.set(versionSpec, remoteDate);
            }
        } catch (error) {
            boxlangOutputChannel.appendLine(`BoxLang LSP: Unable to check ${versionSpec} update date: ${error}`);
        }
    }));

    const versions = Array.from(versionSet)
        .sort(compareBoxLangLspVersionsDescending);

    return { versions, remoteUpdatedDates, remoteBinaryHashes, installedDates, currentSpec };
}

async function pickLspVersion(
    versions: string[],
    remoteUpdatedDates: Map<string, Date>,
    remoteBinaryHashes: Map<string, string>,
    installedDates: Map<string, InstalledLspVersion>,
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
            const installed = installedDates.get(versionSpec);
            const isUpdateAvailable = isInstalledVersionOutdated(versionSpec, installedDates, remoteUpdatedDates, remoteBinaryHashes);

            let description = "";
            if (isCurrent && isUpdateAvailable) {
                description = "Update Available";
            } else if (isCurrent) {
                description = "Current";
            } else if (isUpdateAvailable) {
                description = "Update Available";
            } else if (installed) {
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
                resolve(pickLspVersion(versions, remoteUpdatedDates, remoteBinaryHashes, installedDates, currentSpec, context, true));
            } else {
                const versionSpec = `bx-lsp@${selection.label}`;
                const isInstalled = installedDates.has(versionSpec) && !isInstalledVersionOutdated(versionSpec, installedDates, remoteUpdatedDates, remoteBinaryHashes);
                if (isInstalled) {
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
    await requestRestart("selectLSPVersion");
}

export async function selectLSPVersion(context: ExtensionContext) {
    try {
        const data = await vscode.window.withProgress(
            { title: "BoxLang: Fetching LSP versions", location: ProgressLocation.Notification },
            async () => fetchLspData(context)
        );

        const result = await pickLspVersion(data.versions, data.remoteUpdatedDates, data.remoteBinaryHashes, data.installedDates, data.currentSpec, context, false);

        if (!result) {
            return;
        }

        if ("needsInstall" in result) {
            const { version, versionSpec } = result;
            const storagePath = context.globalStorageUri.fsPath;
            const remoteUpdatedDate = data.remoteUpdatedDates.get(versionSpec);
            const remoteBinaryHash = data.remoteBinaryHashes.get(versionSpec);

            await vscode.window.withProgress(
                { title: `BoxLang: Installing LSP Version: ${version}`, location: ProgressLocation.Notification },
                async () => {
                    const build = await installLSPBuild(storagePath, versionSpec, {
                        forceRefresh: data.installedDates.has(versionSpec),
                        updatedDate: remoteUpdatedDate?.toISOString(),
                        binaryHash: remoteBinaryHash
                    }, directory => new ModuleManager(true).installModuleToDir(versionSpec, directory));
                    if (ExtensionConfig.boxlangLSPUsesSharedUpdates) {
                        await publishLSPUpdate(storagePath, getLSPUpdateChannel(context.extension.packageJSON.version), build, "now", true);
                    }
                    await ExtensionConfig.updateBoxlangLSPVersion(versionSpec);
                    boxlangOutputChannel.appendLine(`BoxLang: LSP version set to ${versionSpec}`);
                    await restartLsp();
                }
            );
        } else {
            await vscode.window.withProgress(
                { title: `BoxLang: Switching to LSP Version: ${result.versionSpec}`, location: ProgressLocation.Notification },
                async () => {
                    const storagePath = context.globalStorageUri.fsPath;
                    const build = await findInstalledLSPBuild(storagePath, result.versionSpec);
                    if (build && ExtensionConfig.boxlangLSPUsesSharedUpdates) {
                        await publishLSPUpdate(storagePath, getLSPUpdateChannel(context.extension.packageJSON.version), build, "now", true);
                    }
                    await ExtensionConfig.updateBoxlangLSPVersion(result.versionSpec);
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
