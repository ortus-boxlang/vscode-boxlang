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

        if (!isNewerVersion(component, latest, current)) {
            boxlangOutputChannel.appendLine(`BoxLang UpdateManager: ${component} is up to date (${current})`);
            return;
        }

        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: ${component} update available: ${current} -> ${latest}`);
        await handleUpdateFound(component, current, latest, mode);
    } catch (e) {
        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Unable to check for ${component} updates: ${e}`);
    }
}

function getUpdateMode(component: Component): UpdateMode {
    switch (component) {
        case "runtime":   return ExtensionConfig.boxlangRuntimeVersionUpdateMode;
        case "miniserver": return ExtensionConfig.boxlangMiniServerVersionUpdateMode;
        case "lsp":       return ExtensionConfig.boxlangLSPVersionUpdateMode;
        case "debugger":  return ExtensionConfig.boxlangDebuggerVersionUpdateMode;
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

async function getLatestVersion(component: Component): Promise<{ current: string; latest: string } | null> {
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

            const forgeBoxClient = new ForgeBoxClient();
            const metadata = await forgeBoxClient.getModuleMetadata("bx-lsp");
            const allVersions = [metadata.latestVersion, ...(metadata.versions ?? [])].filter(Boolean);
            const candidates = preRelease
                ? allVersions
                : allVersions.filter(v => !hasPreReleaseIdentifier(v?.version));
            const latest = candidates[0]?.version;
            if (!latest) {
                return null;
            }

            return { current, latest };
        }

        case "debugger": {
            const current = ExtensionConfig.boxlangDebuggerModuleVersion;
            if (!current) {
                return null;
            }

            const moduleName = ExtensionConfig.boxlangDebuggerModuleName;
            const forgeBoxClient = new ForgeBoxClient();
            const metadata = await forgeBoxClient.getModuleMetadata(moduleName);
            const allVersions = [metadata.latestVersion, ...(metadata.versions ?? [])].filter(Boolean);
            const candidates = preRelease
                ? allVersions
                : allVersions.filter(v => !hasPreReleaseIdentifier(v?.version));
            const latest = candidates[0]?.version;
            if (!latest) {
                return null;
            }

            return { current, latest };
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
        if (component === "lsp") {
            // compareBoxLangLspVersionsDescending(current, latest) > 0 means current < latest
            return compareBoxLangLspVersionsDescending(current, latest) > 0;
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
    mode: UpdateMode
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
            await applyUpdate(component, latest, timing);
        } else {
            boxlangOutputChannel.appendLine(`BoxLang UpdateManager: auto-updating ${label} from ${current} to ${latest}`);
            await applyUpdate(component, latest, "now");
        }
        return;
    }

    // prompt mode
    const choice = await vscode.window.showInformationMessage(
        `BoxLang: A new ${label} version (${latest}) is available. Currently on ${current}.`,
        "Update Now",
        "Update on Next Restart",
        "Skip"
    );

    if (!choice || choice === "Skip") {
        return;
    }

    await applyUpdate(component, latest, choice === "Update Now" ? "now" : "restart");
}

async function applyUpdate(component: Component, version: string, timing: UpdateTiming): Promise<void> {
    try {
        switch (component) {
            case "runtime":
                await applyRuntimeUpdate(version, timing);
                break;
            case "miniserver":
                await applyMiniServerUpdate(version, timing);
                break;
            case "lsp":
                await applyLSPUpdate(version, timing);
                break;
            case "debugger":
                await applyDebuggerUpdate(version);
                break;
        }
    } catch (e) {
        boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Failed to apply ${component} update to ${version}: ${e}`);
        const choice = await vscode.window.showErrorMessage(
            `BoxLang: Failed to update ${getComponentLabel(component)} to ${version}: ${e}`,
            "Retry"
        );
        if (choice === "Retry") {
            await applyUpdate(component, version, timing);
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

async function applyLSPUpdate(version: string, timing: UpdateTiming): Promise<void> {
    const latestSpec = `bx-lsp@${version}`;
    boxlangOutputChannel.appendLine(`BoxLang UpdateManager: Setting LSP version to ${latestSpec}`);
    ExtensionConfig.boxlangLSPVersion = latestSpec;

    if (timing === "now") {
        boxlangOutputChannel.appendLine("BoxLang UpdateManager: Restarting LSP to apply update");
        await LSP.restart();
    }
}

async function applyDebuggerUpdate(version: string): Promise<void> {
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
        case "runtime":   return "BoxLang Runtime";
        case "miniserver": return "BoxLang MiniServer";
        case "lsp":       return "BoxLang Language Server";
        case "debugger":  return "BoxLang Debugger";
    }
}
