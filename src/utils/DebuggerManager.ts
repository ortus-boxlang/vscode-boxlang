import fs from "fs/promises";
import path from "path";
import { getExtensionContext } from "../context";
import { ExtensionConfig } from "./Configuration";
import { ForgeBoxClient } from "./ForgeBoxClient";
import { ModuleManager } from "./ModuleManager";
import { boxlangOutputChannel } from "./OutputChannels";
import { getConfiguredBoxLangJarPath } from "./versionManager";

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

async function findFirstBoxJson(dir: string): Promise<string | null> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === "box.json") {
            return fullPath;
        }
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const found = await findFirstBoxJson(path.join(dir, entry.name));
        if (found) {
            return found;
        }
    }

    return null;
}

export async function getDebuggerVersionsParentDir(): Promise<string> {
    const context = getExtensionContext();
    const parentDir = path.join(context.globalStorageUri.fsPath, "debuggerVersions");

    if (!(await fileExists(parentDir))) {
        await fs.mkdir(parentDir, { recursive: true });
    }

    return parentDir;
}

export async function ensureDebuggerBoxLangHome(): Promise<string> {
    const debuggerBoxLangHome = ExtensionConfig.boxlangDebuggerBoxLangHome;

    try {
        await fs.access(debuggerBoxLangHome);
        boxlangOutputChannel.appendLine(`Debugger BOXLANG_HOME exists: ${debuggerBoxLangHome}`);
    }
    catch (e) {
        await fs.mkdir(debuggerBoxLangHome, { recursive: true });
        await fs.mkdir(path.join(debuggerBoxLangHome, "modules"), { recursive: true });
        boxlangOutputChannel.appendLine(`Created debugger BOXLANG_HOME directory: ${debuggerBoxLangHome}`);
    }

    return debuggerBoxLangHome;
}

export function getDebuggerVersionSpec(version: string): string {
    return `${ExtensionConfig.boxlangDebuggerModuleName}@${version}`;
}

export function getConfiguredDebuggerVersionSpec(): string {
    return ExtensionConfig.boxlangDebuggerVersionSpec;
}

export function extractVersionFromSpec(versionSpec: string): string {
    const atPos = versionSpec.lastIndexOf("@");

    if (atPos < 0) {
        return versionSpec;
    }

    return versionSpec.slice(atPos + 1);
}

export async function getInstalledDebuggerVersionSpecs(moduleName?: string): Promise<string[]> {
    const parentDir = await getDebuggerVersionsParentDir();
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    const specs: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const fullPath = path.join(parentDir, entry.name);
        if (!(await isNonEmptyDir(fullPath))) {
            continue;
        }

        if (!!moduleName && !entry.name.startsWith(`${moduleName}@`)) {
            continue;
        }

        specs.push(entry.name);
    }

    return specs;
}

export async function installDebuggerVersionSpec(versionSpec: string): Promise<string> {
    const parentDir = await getDebuggerVersionsParentDir();
    const versionDir = path.join(parentDir, versionSpec);
    const moduleName = versionSpec.split("@")[0];

    const moduleManager = new ModuleManager(true);
    await moduleManager.installModuleToDir(versionSpec, versionDir, true);

    const boxJsonPath = path.join(versionDir, moduleName, "box.json");
    if (!(await fileExists(boxJsonPath))) {
        throw new Error(`Debugger installation is missing box.json: ${boxJsonPath}`);
    }

    return versionDir;
}

export async function removeDebuggerVersionSpec(versionSpec: string): Promise<void> {
    const parentDir = await getDebuggerVersionsParentDir();
    const versionDir = path.join(parentDir, versionSpec);

    if (!(await fileExists(versionDir))) {
        return;
    }

    await fs.rm(versionDir, { recursive: true, force: true });
}

export async function getAvailableDebuggerVersions(): Promise<string[]> {
    const moduleName = ExtensionConfig.boxlangDebuggerModuleName;
    const forgeBoxClient = new ForgeBoxClient();
    const metadata = await forgeBoxClient.getModuleMetadata(moduleName);

    const versions = new Set<string>();
    if (metadata.latestVersion?.version) {
        versions.add(metadata.latestVersion.version);
    }

    for (const version of metadata.versions || []) {
        if (!!version?.version) {
            versions.add(version.version);
        }
    }

    return Array.from(versions);
}

async function getRequiredBoxLangVersion(modulePath: string): Promise<string> {
    try {
        const boxJSON = await findFirstBoxJson(modulePath);
        if (!boxJSON) {
            return "";
        }

        const moduleJson = JSON.parse((await fs.readFile(boxJSON)) + "");
        return moduleJson.boxlang?.minimumVersion || moduleJson.boxlang?.version || "";
    } catch (e) {
        boxlangOutputChannel.appendLine("Error reading box.json to determine required BoxLang version for debugger module");
        boxlangOutputChannel.appendLine(`${e}`);
        return "";
    }
}

export async function ensureConfiguredDebuggerModule(): Promise<{ modulePath: string; runtimeJarPath: string; versionSpec: string; moduleName: string; boxlangHome: string }> {
    const versionSpec = getConfiguredDebuggerVersionSpec();
    const moduleName = ExtensionConfig.boxlangDebuggerModuleName;

    boxlangOutputChannel.appendLine(`Ensuring debugger module is installed: ${versionSpec}`);

    const parentDir = await getDebuggerVersionsParentDir();
    const versionDir = path.join(parentDir, versionSpec);
    const expectedBoxJson = path.join(versionDir, moduleName, "box.json");

    if (!(await fileExists(expectedBoxJson))) {
        await installDebuggerVersionSpec(versionSpec);
    }

    const requiredVersion = await getRequiredBoxLangVersion(versionDir);

    if (requiredVersion) {
        boxlangOutputChannel.appendLine(`Debugger module minimum BoxLang version: ${requiredVersion}`);
    }

    const runtimeJarPath = await getConfiguredBoxLangJarPath();
    boxlangOutputChannel.appendLine(`Using configured BoxLang runtime for debugger module: ${runtimeJarPath}`);

    const boxlangHome = await ensureDebuggerBoxLangHome();

    return {
        modulePath: versionDir,
        runtimeJarPath,
        versionSpec,
        moduleName,
        boxlangHome
    };
}
