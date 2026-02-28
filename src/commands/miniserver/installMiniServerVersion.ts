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

async function pickMiniServerVersion(context: ExtensionContext): Promise<string | undefined> {
    const parentDir = path.join(context.globalStorageUri.fsPath, "miniserverVersions");
    const installed = await listInstalledVersions(parentDir);

    // Best-effort current version from configured jar filename
    const configuredJar = ExtensionConfig.boxlangMiniServerJarPath;
    const configuredFileName = configuredJar ? path.basename(configuredJar) : "";
    const configuredMatch = /^boxlang-miniserver-(.+)\.jar$/.exec(configuredFileName);
    const configuredVersion = configuredMatch?.[1];

    const versions = await DownloadManager.listS3MiniServerVersions();
    const versionSet = new Set<string>();
    for (const v of versions) {
        if (v?.version) {
            versionSet.add(v.version);
        }
    }

    const sorted = Array.from(versionSet)
        .filter(v => typeof v === "string" && v.length > 0)
        .sort(compareVersionsDescending);

    const items: Array<vscode.QuickPickItem & { version: string }> = sorted.map(version => {
        const isCurrent = configuredVersion === version;
        const isInstalled = installed.has(version);

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
        picker.title = "Install BoxLang MiniServer Version";
        picker.items = items;
        picker.matchOnDescription = true;
        picker.canSelectMany = false;

        picker.onDidAccept(() => {
            const selection = picker.activeItems[0];
            resolve(selection?.version);
            picker.hide();
        });

        picker.onDidHide(() => {
            picker.dispose();
            resolve(undefined);
        });

        picker.show();
    });
}

export async function installMiniServerVersion(context: ExtensionContext) {
    try {
        const version = await vscode.window.withProgress(
            { title: "BoxLang: Fetching MiniServer versions", location: ProgressLocation.Notification },
            async () => pickMiniServerVersion(context)
        );

        if (!version) {
            return;
        }

        const parentDir = path.join(context.globalStorageUri.fsPath, "miniserverVersions");
        const versionDir = path.join(parentDir, `boxlang-miniserver-${version}`);
        const jarPath = path.join(versionDir, `boxlang-miniserver-${version}.jar`);

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

        vscode.window.showInformationMessage(`BoxLang: MiniServer updated to ${version}`);
    } catch (e) {
        boxlangOutputChannel.appendLine("Unable to install MiniServer version");
        boxlangOutputChannel.appendLine(e);
        vscode.window.showErrorMessage(`Unable to install MiniServer version: ${e?.toString?.() || e}`);
    }
}
