import * as fs from "fs/promises";
import * as path from "path";
import semver from "semver";
import * as vscode from "vscode";
import { compareBoxLangLspVersionsDescending } from "../commands/lsp/selectLSPVersion";
import { getExtensionContext } from "../context";
import { ExtensionConfig, getBvmrcVersion } from "./Configuration";
import { DownloadManager } from "./DownloadManager";
import { ForgeBoxClient } from "./ForgeBoxClient";
import * as LSP from "./LanguageServer";
import { boxlangOutputChannel } from "./OutputChannels";
import { getAvailableBoxLangVerions } from "./versionManager";
import { PENDING_DEBUGGER_REFRESH_KEY, PENDING_LSP_REFRESH_KEY } from "./versionUpdateState";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const COOLDOWN_KEYS = {
    runtime: "boxlang.updates.lastCheck.runtime",
    miniserver: "boxlang.updates.lastCheck.miniserver",
    lsp: "boxlang.updates.lastCheck.lsp",
    debugger: "boxlang.updates.lastCheck.debugger",
} as const;

type Component = "runtime" | "miniserver" | "lsp" | "debugger";
type UpdateMode = "auto" | "prompt" | "manual";
type UpdateTiming = "now" | "restart";
type UpdateInfo = { current: string; latest: string; updatedDate?: string; binaryHash?: string; needsRefresh?: boolean };

function isExternallyManagedLSP(): boolean {
    return Boolean(process.env.BOXLANG_LSP_PORT);
}

function isPreReleaseExtension(): boolean {
    // Release workflows use odd minor versions for prereleases and even minors for stable releases.
    const version = semver.parse(getExtensionContext().extension.packageJSON.version);
    return version !== null && version.minor % 2 === 1;
}

function isSnapshotVersion(version: string): boolean {
    return semver.parse(version)?.prerelease[0]?.toString().toLowerCase() === "snapshot";
}

function isVersionStreamMismatch(latest: string, current: string): boolean {
    // Switching channels can require the target stream even when semver sees it as older.
    const latestVersion = semver.parse(latest);
    const currentVersion = semver.parse(current);
    if (!latestVersion || !currentVersion) {
        return false;
    }

    if (latestVersion.prerelease.length === 0) {
        return currentVersion.prerelease.length > 0;
    }
    return isSnapshotVersion(latest) && !isSnapshotVersion(current);
}

function getLatestForgeBoxVersion(
    versions: Array<string | undefined>,
    preRelease: boolean,
    compare: (a: string, b: string) => number
): string | undefined {
    const allVersions = Array.from(new Set(versions.filter((version): version is string => Boolean(version && semver.valid(version)))));
    const stableVersions = allVersions.filter(version => !semver.prerelease(version));
    const preferredVersions = preRelease ? allVersions.filter(isSnapshotVersion) : stableVersions;
    return (preferredVersions.length ? preferredVersions : stableVersions).sort(compare)[0];
}

async function getCachedVersionDir(component: "lsp" | "debugger", version: string): Promise<string | undefined> {
    const context = getExtensionContext();
    const moduleName = component === "lsp" ? "bx-lsp" : ExtensionConfig.boxlangDebuggerModuleName;
    const parentDir = path.join(context.globalStorageUri.fsPath, component === "lsp" ? "lspVersions" : "debuggerVersions");
    const versionDir = path.join(parentDir, `${moduleName}@${version}`);

    try {
        return (await fs.stat(versionDir)).isDirectory() ? versionDir : undefined;
    } catch {
        return undefined;
    }
}

async function isCachedVersionOutdated(versionDir: string, binaryHash?: string, updatedDate?: string): Promise<boolean> {
    let installedHash: string | undefined;
    let installedDate: string | undefined;
    try {
        const metadata = JSON.parse(await fs.readFile(path.join(versionDir, "version.json"), "utf8"));
        installedHash = metadata.binaryHash;
        installedDate = metadata.updatedDate ?? metadata.createDate;
    } catch { /* Older installs use the version directory mtime. */ }

    if (binaryHash) {
        return installedHash !== binaryHash;
    }
    if (!updatedDate) {
        return false;
    }

    const remoteTime = Date.parse(updatedDate);
    const installedTime = installedDate ? Date.parse(installedDate) : (await fs.stat(versionDir)).mtime.getTime();
    return Number.isFinite(remoteTime) && (!Number.isFinite(installedTime) || remoteTime > installedTime);
}

async function getModuleUpdatedDate(forgeBoxClient: ForgeBoxClient, moduleName: string, version: string): Promise<string | undefined> {
    try {
        return (await forgeBoxClient.getModuleVersionMetadata(moduleName, version)).updatedDate;
    } catch (error) {
        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Unable to fetch ${moduleName}@${version} update date: ${error}`);
        return undefined;
    }
}

/**
 * Check all four components for updates in parallel.
 * Respects per-component cooldowns unless force=true.
 */
export async function checkAllUpdates(force: boolean): Promise<void> {
    await Promise.all([
        checkComponentUpdate("runtime", force),
        checkComponentUpdate("miniserver", force),
        checkComponentUpdate("lsp", force),
        checkComponentUpdate("debugger", force),
    ]);
}

/**
 * Reset all component cooldown timestamps, forcing the next call to
 * checkAllUpdates to perform fresh network checks regardless of cooldown.
 */
export async function resetAllCooldowns(): Promise<void> {
    const context = getExtensionContext();
    for (const key of Object.values(COOLDOWN_KEYS)) {
        await context.globalState.update(key, 0);
    }
}

async function checkComponentUpdate(component: Component, force: boolean): Promise<void> {
    const context = getExtensionContext();
    const cooldownKey = COOLDOWN_KEYS[component];

    if (component === "lsp" && isExternallyManagedLSP()) {
        boxlangOutputChannel.appendLine("BoxLang UpdateManager: skipping LSP update check because BOXLANG_LSP_PORT is set");
        return;
    }

    if (!force && !process.env.BOXLANG_IGNORE_UPDATE_COOLDOWN) {
        const lastCheck = context.globalState.get<number>(cooldownKey, 0);
        if (Date.now() - lastCheck < SIX_HOURS_MS) {
            boxlangOutputChannel.appendLine(`BoxLang UpdateManager: skipping ${component} update check (cooldown active)`);
            return;
        }
    }

    await context.globalState.update(cooldownKey, Date.now());

    const mode = getUpdateMode(component);
    if (mode === "manual") {
        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: ${component} update mode is manual, skipping`);
        return;
    }

    if (isVersionPinned(component)) {
        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: ${component} version is pinned via .bvmrc, skipping auto-update`);
        return;
    }

    try {
        const updateInfo = await getLatestVersion(component);
        if (!updateInfo) {
            return;
        }

        const { current, latest } = updateInfo;
        const refresh = updateInfo.needsRefresh ?? false;

        if (!isNewerVersion(component, latest, current) && !refresh) {
            boxlangOutputChannel.appendLine(`BoxLang UpdateManager: ${component} is up to date (${current})`);
            return;
        }

        if (refresh && current === latest) {
            boxlangOutputChannel.appendLine(`BoxLang UpdateManager: updated build available for ${component} ${latest}`);
        } else {
            boxlangOutputChannel.appendLine(`BoxLang UpdateManager: ${component} update available: ${current} -> ${latest}`);
        }
        await handleUpdateFound(component, current, latest, mode, refresh, updateInfo.updatedDate, updateInfo.binaryHash);
    } catch (e) {
        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Unable to check for ${component} updates: ${e}`);
    }
}

function getUpdateMode(component: Component): UpdateMode {
    switch (component) {
        case "runtime": return ExtensionConfig.boxlangRuntimeVersionUpdateMode;
        case "miniserver": return ExtensionConfig.boxlangMiniServerVersionUpdateMode;
        case "lsp": return ExtensionConfig.boxlangLSPVersionUpdateMode;
        case "debugger": return ExtensionConfig.boxlangDebuggerVersionUpdateMode;
    }
}

/**
 * A component version is "pinned" if the user has locked it to a specific version
 * outside of the normal update flow. Currently, only the runtime supports pinning
 * via .bvmrc. For LSP/Debugger, use manual update mode to pin.
 */
function isVersionPinned(component: Component): boolean {
    if (component === "runtime") {
        return getBvmrcVersion() !== null;
    }
    return false;
}

async function getLatestVersion(component: Component): Promise<UpdateInfo | null> {
    const preRelease = ExtensionConfig.boxlangUpdatesPreRelease;

    switch (component) {
        case "runtime": {
            const current = ExtensionConfig.boxlangVersion;
            if (!current) {
                return null;
            }

            const versions = await getAvailableBoxLangVerions();
            const stablePattern = /^boxlang-\d+\.\d+\.\d+$/;
            const prereleasePattern = /^boxlang-\d+\.\d+\.\d+/;
            const pattern = preRelease ? prereleasePattern : stablePattern;
            const latest = versions.find(v => pattern.test(v.name))?.name.replace("boxlang-", "");
            if (!latest) {
                return null;
            }

            return { current, latest };
        }

        case "miniserver": {
            const currentJar = ExtensionConfig.boxlangMiniServerJarPath;
            const match = /boxlang-miniserver-(.+)\.jar$/.exec(currentJar ?? "");
            const current = match?.[1] ?? "";
            if (!current) {
                return null;
            }

            const s3Versions = await DownloadManager.listS3MiniServerVersions();
            const candidates = preRelease
                ? s3Versions
                : s3Versions.filter(v => !hasPreReleaseIdentifier(v.version));
            const latest = candidates[0]?.version;
            if (!latest) {
                return null;
            }

            return { current, latest };
        }

        case "lsp": {
            const currentSpec = ExtensionConfig.boxlangLSPVersion;
            if (!currentSpec) {
                return null;
            }
            const current = currentSpec.startsWith("bx-lsp@") ? currentSpec.slice("bx-lsp@".length) : currentSpec;
            if (!current) {
                boxlangOutputChannel.appendLine(`BoxLang UpdateManager: LSP version spec "${currentSpec}" has no version number \u2014 skipping update check`);
                return null;
            }

            const forgeBoxClient = new ForgeBoxClient();
            const metadata = await forgeBoxClient.getModuleMetadata("bx-lsp");
            const versions = [metadata.latestVersion?.version, ...(metadata.versions ?? []).map(v => v?.version)];
            const latest = getLatestForgeBoxVersion(versions, isPreReleaseExtension(), compareBoxLangLspVersionsDescending);
            if (!latest) {
                return null;
            }

            const binaryHash = [metadata.latestVersion, ...(metadata.versions ?? [])]
                .find(v => v?.version === latest && v.binaryHash)?.binaryHash;
            const versionDir = await getCachedVersionDir("lsp", latest);
            const updatedDate = versionDir && !binaryHash
                ? await getModuleUpdatedDate(forgeBoxClient, "bx-lsp", latest)
                : undefined;
            const needsRefresh = versionDir ? await isCachedVersionOutdated(versionDir, binaryHash, updatedDate) : false;
            return { current, latest, updatedDate, binaryHash, needsRefresh };
        }

        case "debugger": {
            const current = ExtensionConfig.boxlangDebuggerModuleVersion;
            if (!current) {
                return null;
            }

            const moduleName = ExtensionConfig.boxlangDebuggerModuleName;
            const forgeBoxClient = new ForgeBoxClient();
            const metadata = await forgeBoxClient.getModuleMetadata(moduleName);
            const versions = [metadata.latestVersion?.version, ...(metadata.versions ?? []).map(v => v?.version)];
            const latest = getLatestForgeBoxVersion(versions, isPreReleaseExtension(), semver.rcompare);
            if (!latest) {
                return null;
            }

            const binaryHash = [metadata.latestVersion, ...(metadata.versions ?? [])]
                .find(v => v?.version === latest && v.binaryHash)?.binaryHash;
            const versionDir = await getCachedVersionDir("debugger", latest);
            const updatedDate = versionDir && !binaryHash
                ? await getModuleUpdatedDate(forgeBoxClient, moduleName, latest)
                : undefined;
            const needsRefresh = versionDir ? await isCachedVersionOutdated(versionDir, binaryHash, updatedDate) : false;
            return { current, latest, updatedDate, binaryHash, needsRefresh };
        }
    }
}

function hasPreReleaseIdentifier(version: string | undefined): boolean {
    if (!version) {
        return false;
    }
    return /-(snapshot|alpha|beta|be)(\.|$)/i.test(version);
}

function isNewerVersion(component: Component, latest: string, current: string): boolean {
    try {
        if ((component === "lsp" || component === "debugger") && isVersionStreamMismatch(latest, current)) {
            return true;
        }
        if (component === "lsp") {
            // compareBoxLangLspVersionsDescending(current, latest) > 0 means current < latest
            return compareBoxLangLspVersionsDescending(current, latest) > 0;
        }
        if (component === "debugger") {
            const latestVersion = semver.parse(latest);
            const currentVersion = semver.parse(current);
            return latestVersion !== null && currentVersion !== null && semver.gt(latestVersion, currentVersion);
        }
        const latestCoerced = semver.coerce(latest);
        const currentCoerced = semver.coerce(current);
        if (!latestCoerced || !currentCoerced) {
            return false;
        }
        return semver.gt(latestCoerced, currentCoerced);
    } catch {
        return false;
    }
}

async function handleUpdateFound(
    component: Component,
    current: string,
    latest: string,
    mode: UpdateMode,
    refresh: boolean,
    updatedDate?: string,
    binaryHash?: string
): Promise<void> {
    const label = getComponentLabel(component);

    if (mode === "auto") {
        // For runtime/miniserver in auto mode, still warn if a server or debug session is active
        if ((component === "runtime" || component === "miniserver") && isComponentActive()) {
            const choice = await vscode.window.showWarningMessage(
                `BoxLang: ${label} ${latest} is available, but a server or debug session is active. The update will be applied on next restart.`,
                "Update Now Anyway",
                "Update on Next Restart"
            );
            const timing: UpdateTiming = choice === "Update Now Anyway" ? "now" : "restart";
            await applyUpdate(component, latest, timing, refresh, updatedDate, binaryHash);
        } else {
            const action = refresh && current === latest ? "refreshing" : "auto-updating";
            boxlangOutputChannel.appendLine(`BoxLang UpdateManager: ${action} ${label} from ${current} to ${latest}`);
            await applyUpdate(component, latest, "now", refresh, updatedDate, binaryHash);
        }
        return;
    }

    // prompt mode
    const message = refresh && current === latest
        ? `BoxLang: An updated ${label} build (${latest}) is available.`
        : `BoxLang: A new ${label} version (${latest}) is available. Currently on ${current}.`;
    const choice = await vscode.window.showInformationMessage(
        message,
        "Update Now",
        "Update on Next Restart",
        "Skip"
    );

    if (!choice || choice === "Skip") {
        return;
    }

    await applyUpdate(component, latest, choice === "Update Now" ? "now" : "restart", refresh, updatedDate, binaryHash);
}

async function applyUpdate(
    component: Component,
    version: string,
    timing: UpdateTiming,
    refresh = false,
    updatedDate?: string,
    binaryHash?: string
): Promise<void> {
    try {
        switch (component) {
            case "runtime":
                await applyRuntimeUpdate(version, timing);
                break;
            case "miniserver":
                await applyMiniServerUpdate(version, timing);
                break;
            case "lsp":
                await applyLSPUpdate(version, timing, refresh, updatedDate, binaryHash);
                break;
            case "debugger":
                await applyDebuggerUpdate(version, refresh, updatedDate, binaryHash);
                break;
        }
    } catch (e) {
        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Failed to apply ${component} update to ${version}: ${e}`);
        const choice = await vscode.window.showErrorMessage(
            `BoxLang: Failed to update ${getComponentLabel(component)} to ${version}: ${e}`,
            "Retry"
        );
        if (choice === "Retry") {
            await applyUpdate(component, version, timing, refresh, updatedDate, binaryHash);
        }
    }
}

async function applyRuntimeUpdate(version: string, timing: UpdateTiming): Promise<void> {
    if (timing === "now" && isComponentActive()) {
        const proceed = await vscode.window.showWarningMessage(
            `BoxLang: A MiniServer or debug session is active. Updating the runtime will stop it. Continue?`,
            "Continue",
            "Cancel"
        );
        if (proceed !== "Continue") {
            return;
        }
    }

    boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Setting runtime version to ${version}`);
    await vscode.workspace.getConfiguration("boxlang").update("boxlangVersion", version, vscode.ConfigurationTarget.Global);

    if (timing === "now") {
        if (isExternallyManagedLSP()) {
            boxlangOutputChannel.appendLine("BoxLang UpdateManager: skipping LSP restart for runtime update because BOXLANG_LSP_PORT is set");
            return;
        }

        boxlangOutputChannel.appendLine("BoxLang UpdateManager: Restarting LSP to apply runtime update");
        await LSP.restart();
    }
}

async function applyMiniServerUpdate(version: string, timing: UpdateTiming): Promise<void> {
    if (timing === "now" && hasActiveMiniServer()) {
        const proceed = await vscode.window.showWarningMessage(
            `BoxLang: A MiniServer is currently running. Updating will require a server restart. Continue?`,
            "Continue",
            "Cancel"
        );
        if (proceed !== "Continue") {
            return;
        }
    }

    const context = getExtensionContext();
    const parentDir = path.join(context.globalStorageUri.fsPath, "miniserverVersions");
    const versionDir = path.join(parentDir, `boxlang-miniserver-${version}`);
    const jarPath = path.join(versionDir, `boxlang-miniserver-${version}.jar`);

    let jarExists = false;
    try {
        await fs.access(jarPath);
        jarExists = true;
    } catch { /* needs download */ }

    if (!jarExists) {
        await vscode.window.withProgress(
            { title: `BoxLang: Downloading MiniServer ${version}`, location: vscode.ProgressLocation.Notification },
            async () => {
                await fs.mkdir(versionDir, { recursive: true });
                try {
                    await DownloadManager.downloadMiniServer(version, jarPath);
                    await fs.writeFile(
                        path.join(versionDir, "version.json"),
                        JSON.stringify({ name: `boxlang-miniserver-${version}`, version, jarPath, installedAt: new Date().toISOString() }, null, 4)
                    );
                } catch (e) {
                    try { await fs.rm(versionDir, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
                    throw e;
                }
            }
        );
    }

    ExtensionConfig.boxlangMiniServerJarPath = jarPath;
    boxlangOutputChannel.appendLine(`BoxLang UpdateManager: MiniServer updated to ${version}`);
    vscode.window.showInformationMessage(`BoxLang: MiniServer updated to version ${version}`);
}

async function applyLSPUpdate(version: string, timing: UpdateTiming, refresh: boolean, updatedDate?: string, binaryHash?: string): Promise<void> {
    if (isExternallyManagedLSP()) {
        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: skipping LSP update to bx-lsp@${version} because BOXLANG_LSP_PORT is set`);
        return;
    }

    const latestSpec = `bx-lsp@${version}`;
    if (refresh || updatedDate || binaryHash) {
        await getExtensionContext().globalState.update(PENDING_LSP_REFRESH_KEY, {
            versionSpec: latestSpec,
            forceRefresh: refresh,
            ...(updatedDate ? { updatedDate } : {}),
            ...(binaryHash ? { binaryHash } : {})
        });
    }
    boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Setting LSP version to ${latestSpec}`);
    await ExtensionConfig.updateBoxlangLSPVersion(latestSpec);

    if (timing === "now") {
        boxlangOutputChannel.appendLine("BoxLang UpdateManager: Restarting LSP to apply update");
        await LSP.restart();
    }
}

async function applyDebuggerUpdate(version: string, refresh: boolean, updatedDate?: string, binaryHash?: string): Promise<void> {
    if (refresh || updatedDate || binaryHash) {
        const versionSpec = `${ExtensionConfig.boxlangDebuggerModuleName}@${version}`;
        await getExtensionContext().globalState.update(PENDING_DEBUGGER_REFRESH_KEY, {
            versionSpec,
            forceRefresh: refresh,
            ...(updatedDate ? { updatedDate } : {}),
            ...(binaryHash ? { binaryHash } : {})
        });
    }
    boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Setting debugger version to ${version}`);
    ExtensionConfig.boxlangDebuggerModuleVersion = version;
}

/** Returns true if any MiniServer is currently running or a debug session is active. */
function isComponentActive(): boolean {
    return hasActiveMiniServer() || hasActiveDebugSession();
}

function hasActiveMiniServer(): boolean {
    try {
        // Dynamic require avoids circular dependency with Server module
        const Server = require("./Server");
        const serverNames: string[] = Server.getAvailableServerNames();
        return serverNames.some(name => {
            const data = Server.getServerData(name);
            return data?.status === "running";
        });
    } catch {
        return false;
    }
}

function hasActiveDebugSession(): boolean {
    return vscode.debug.activeDebugSession !== undefined;
}

function getComponentLabel(component: Component): string {
    switch (component) {
        case "runtime": return "BoxLang Runtime";
        case "miniserver": return "BoxLang MiniServer";
        case "lsp": return "BoxLang Language Server";
        case "debugger": return "BoxLang Debugger";
    }
}
