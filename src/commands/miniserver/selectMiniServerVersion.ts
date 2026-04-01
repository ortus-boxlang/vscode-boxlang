import * as fs from "fs/promises";
import * as path from "path";
import semver from "semver";
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import { ExtensionConfig } from "../../utils/Configuration";
import { DownloadManager } from "../../utils/DownloadManager";
import { boxlangOutputChannel } from "../../utils/OutputChannels";

function compareVersionsDescending(a: string, b: string): number {
    return semver.rcompare(a, b);
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function listInstalledVersions(parentDir: string): Promise<Set<string>> {
    const installed = new Set<string>();

    if (!(await fileExists(parentDir))) {
        return installed;
    }

    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const match = /^boxlang-miniserver-(.+)$/.exec(entry.name);
        if (!match) {
            continue;
        }

        const version = match[1];
        const jarPath = path.join(parentDir, entry.name, `boxlang-miniserver-${version}.jar`);
        if (await fileExists(jarPath)) {
            installed.add(version);
        }
    }

    return installed;
}

type MiniServerPickResult =
    | { needsInstall: true; version: string; jarPath: string; versionDir: string }
    | { version: string; jarPath: string };

const RECENT_VERSION_LIMIT = 10;
const SHOW_ALL_LABEL = "Show older versions...";

async function fetchMiniServerData(context: ExtensionContext): Promise<{ versions: string[]; installed: Set<string>; configuredVersion: string; parentDir: string }> {
    const parentDir = path.join(context.globalStorageUri.fsPath, "miniserverVersions");
    const installed = await listInstalledVersions(parentDir);

    const configuredJar = ExtensionConfig.boxlangMiniServerJarPath;
    const configuredFileName = configuredJar ? path.basename(configuredJar) : "";
    const configuredMatch = /^boxlang-miniserver-(.+)\.jar$/.exec(configuredFileName);
    const configuredVersion = configuredMatch?.[1] ?? "";

    const s3Versions = await DownloadManager.listS3MiniServerVersions();
    const versionSet = new Set<string>();
    for (const v of s3Versions) {
        if (v?.version) {
            versionSet.add(v.version);
        }
    }

    const versions = Array.from(versionSet)
        .filter(v => typeof v === "string" && v.length > 0)
        .sort(compareVersionsDescending);

    return { versions, installed, configuredVersion, parentDir };
}

async function pickMiniServerVersion(
    versions: string[],
    installed: Set<string>,
    configuredVersion: string,
    parentDir: string,
    showAll: boolean
): Promise<MiniServerPickResult | null> {
    let visibleVersions = versions;
    let hasOlderVersions = false;

    if (!showAll && versions.length > RECENT_VERSION_LIMIT) {
        const recent = versions.slice(0, RECENT_VERSION_LIMIT);
        const currentIsRecent = !configuredVersion || recent.includes(configuredVersion);
        visibleVersions = currentIsRecent ? recent : [...recent, configuredVersion].filter(v => versions.includes(v));
        hasOlderVersions = true;
    }

    return new Promise((resolve) => {
        const items: vscode.QuickPickItem[] = [];

        if (hasOlderVersions) {
            items.push({ label: SHOW_ALL_LABEL, description: "" });
        }

        for (const version of visibleVersions) {
            const isCurrent = configuredVersion === version;
            const isInstalled = installed.has(version);

            let description = "";
            if (isCurrent) {
                description = "Current";
            } else if (isInstalled) {
                description = "Installed";
            }

            items.push({ label: version, description });
        }

        const picker = vscode.window.createQuickPick();
        picker.title = "Select BoxLang MiniServer Version";
        picker.items = items;
        picker.matchOnDescription = true;

        let accepted = false;

        picker.onDidAccept(() => {
            accepted = true;
            const selection = picker.activeItems[0];
            picker.hide();

            if (selection.label === SHOW_ALL_LABEL) {
                resolve(pickMiniServerVersion(versions, installed, configuredVersion, parentDir, true));
            } else {
                const version = selection.label;
                const versionDir = path.join(parentDir, `boxlang-miniserver-${version}`);
                const jarPath = path.join(versionDir, `boxlang-miniserver-${version}.jar`);
                if (installed.has(version)) {
                    resolve({ version, jarPath });
                } else {
                    resolve({ needsInstall: true, version, jarPath, versionDir });
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

export async function selectMiniServerVersion(context: ExtensionContext) {
    try {
        const data = await vscode.window.withProgress(
            { title: "BoxLang: Fetching MiniServer versions", location: ProgressLocation.Notification },
            async () => fetchMiniServerData(context)
        );

        const result = await pickMiniServerVersion(data.versions, data.installed, data.configuredVersion, data.parentDir, false);

        if (!result) {
            return;
        }

        if ("needsInstall" in result) {
            const { version, jarPath, versionDir } = result;
            await vscode.window.withProgress(
                { title: `BoxLang: Installing MiniServer Version: ${version}`, location: ProgressLocation.Notification },
                async () => {
                    await fs.mkdir(versionDir, { recursive: true });

                    await DownloadManager.downloadMiniServer(version, jarPath);

                    await fs.writeFile(
                        path.join(versionDir, "version.json"),
                        JSON.stringify({ name: `boxlang-miniserver-${version}`, version, jarPath, installedAt: new Date().toISOString() }, null, 4)
                    );

                    ExtensionConfig.boxlangMiniServerJarPath = jarPath;
                    boxlangOutputChannel.appendLine(`BoxLang: MiniServer jar set to ${jarPath}`);
                }
            );
        } else {
            ExtensionConfig.boxlangMiniServerJarPath = result.jarPath;
            boxlangOutputChannel.appendLine(`BoxLang: MiniServer jar set to ${result.jarPath}`);
        }

        vscode.window.showInformationMessage(`BoxLang: MiniServer updated to ${result.version}`);
    } catch (e) {
        boxlangOutputChannel.appendLine("Unable to install MiniServer version");
        boxlangOutputChannel.appendLine(e);
        vscode.window.showErrorMessage(`Unable to install MiniServer version: ${e?.toString?.() || e}`);
    }
}
