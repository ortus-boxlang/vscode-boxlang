// import fs from "fs";
import fs from "fs/promises";
import path from "path";
import { ExtensionContext } from "vscode";
import { ExtensionConfig } from "./Configuration";
import { DownloadManager } from "./DownloadManager";
import * as fileUtil from "./fileUtil";
import { boxlangOutputChannel } from "./OutputChannels";
import { PENDING_RUNTIME_REFRESH_KEY, PendingModuleRefresh } from "./versionUpdateState";


export type BoxLangVersion = {
    url: string,
    lastModified: Date,
    name: string,
    etag?: string,
    jarPath?: string
}

let BOXLANG_INSTALLATIONS = "";
let BOXLANG_LOCAL_VERSIONS_CACHE = "";
let context = null;

export async function setupVersionManagement(_context: ExtensionContext): Promise<void> {
    context = _context;
    BOXLANG_INSTALLATIONS = path.join(context.globalStorageUri.fsPath, "boxlang_versions");
    BOXLANG_LOCAL_VERSIONS_CACHE = path.join(context.globalStorageUri.fsPath, "boxlang_version_cache.json");

    try {
        await fs.access(BOXLANG_INSTALLATIONS);
    }
    catch (e) {
        await fs.mkdir(BOXLANG_INSTALLATIONS);
    }
}

export async function removeVersion(versionToRemove: BoxLangVersion): Promise<void> {
    await fs.rm(path.join(BOXLANG_INSTALLATIONS, versionToRemove.name), { recursive: true });
}

export async function getDownloadedBoxLangVersions(): Promise<BoxLangVersion[]> {
    const entries = await fs.readdir(BOXLANG_INSTALLATIONS, { withFileTypes: true });
    const versions = [];

    for (const entry of entries) {
        if( !entry.isDirectory() ){
            continue;
        }
        try {
            const version = JSON.parse((await fs.readFile(path.join(BOXLANG_INSTALLATIONS, entry.name, "version.json"))) + "");
            version.lastModified = new Date(version.lastModified);
            version.jarPath = path.join(BOXLANG_INSTALLATIONS, entry.name, version.name + ".jar");

            versions.push(version);
        }
        catch (e) {
            boxlangOutputChannel.appendLine( "Error reading BoxLang version: " + entry.name );
            boxlangOutputChannel.appendLine( e );
        }
    }

    return versions;
}

export async function getConfiguredBoxLangJarPath(): Promise<string> {
    const configuredJarPath = ExtensionConfig.boxlangJarPath;

    if( configuredJarPath ){
        boxlangOutputChannel.appendLine("Using configured BoxLang JAR path: " + configuredJarPath);
        return configuredJarPath;
    }

    const configuredVersion = ExtensionConfig.boxlangVersion;

    try{
        return await ensureBoxLangVersion( configuredVersion );
    }
    catch( e ){
        boxlangOutputChannel.appendLine("Error ensuring BoxLang version: " + configuredVersion);
        boxlangOutputChannel.appendLine( e );
        boxlangOutputChannel.appendLine("Falling back to included BoxLang JAR path: " + ExtensionConfig.includedBoxLangJarPath);
        return ExtensionConfig.includedBoxLangJarPath;
    }
}


function isRuntimeInUse(): boolean {
    try {
        if (require("vscode").debug?.activeDebugSession) {
            return true;
        }
    } catch { /* VS Code API unavailable in tests. */ }

    try {
        const Server = require("./Server");
        const serverNames: string[] = Server.getAvailableServerNames();
        return serverNames.some(name => Server.getServerData(name)?.status === "running");
    } catch {
        return false;
    }
}

export async function ensureBoxLangVersion(version: string): Promise<string> {
    boxlangOutputChannel.appendLine("Ensuring BoxLang version is installed: " + version);
    const boxlangVersionSring = version?.startsWith("boxlang-") ? version : `boxlang-${version}`;

    if (!version || boxlangVersionSring === "boxlang-") {
        boxlangOutputChannel.appendLine("Invalid or empty BoxLang version specified, falling back to bundled JAR");
        return ExtensionConfig.includedBoxLangJarPath;
    }

    const pendingRefresh = context?.globalState?.get(PENDING_RUNTIME_REFRESH_KEY) as PendingModuleRefresh | undefined;
    const shouldRefresh = pendingRefresh?.versionSpec === boxlangVersionSring && pendingRefresh.forceRefresh === true;
    const versionPath = path.join(BOXLANG_INSTALLATIONS, boxlangVersionSring);
    if (shouldRefresh && !isRuntimeInUse()) {
        await fs.rm(versionPath, { recursive: true, force: true });
    } else if (shouldRefresh) {
        boxlangOutputChannel.appendLine(`Deferring BoxLang ${boxlangVersionSring} refresh until active sessions stop`);
    }

    const downloadedVersions = await getDownloadedBoxLangVersions();

    const versionObj = downloadedVersions.find(v => v.name === boxlangVersionSring);

    try {
        await fs.access(versionObj.jarPath);
        boxlangOutputChannel.appendLine("BoxLang version found: " + boxlangVersionSring);
        return versionObj.jarPath;
    }
    catch (e) {
        const availableVersions = await getAvailableBoxLangVerions();
        const availableVersion = availableVersions.find(v => v.name === boxlangVersionSring);
        if (!availableVersion) {
            throw new Error(`BoxLang version is not available: ${boxlangVersionSring}`);
        }
        const versionToDownload = shouldRefresh && availableVersion
            ? {
                ...availableVersion,
                etag: pendingRefresh.etag ?? availableVersion.etag,
                lastModified: pendingRefresh.lastModified ? new Date(pendingRefresh.lastModified) : availableVersion.lastModified
            }
            : availableVersion;
        boxlangOutputChannel.appendLine("BoxLang version not found, installing: " + versionToDownload.name);
        try{
            const jarPath = await installVersion(versionToDownload);
            if (shouldRefresh) {
                await context?.globalState?.update(PENDING_RUNTIME_REFRESH_KEY, undefined);
            }
            return jarPath;
        }
        catch(e){
            boxlangOutputChannel.appendLine("Error installing BoxLang version: " + versionToDownload.name);
            throw e;
        }
    }
}

export async function installVersion(version: BoxLangVersion) {
    const versionPath = path.join(BOXLANG_INSTALLATIONS, version.name);

    try {
        await fs.access(versionPath);
        await fs.rm(versionPath, { recursive: true });
    }
    catch (e) {
        // pass
    }

    await fs.mkdir(versionPath);

    const jarPath = await fileUtil.downloadFile(version.url, path.join(versionPath, version.url.split("/").pop()));
    await fs.writeFile(path.join(versionPath, "version.json"), JSON.stringify(version));

    return jarPath;
}


export async function getAvailableBoxLangVerions( force: boolean = false ): Promise<BoxLangVersion[]> {

    if( await isLocalVersionFileUsable() && !force ) {
        try {
            return await readVersionsFromLocalCache();
        } catch (error) {
            boxlangOutputChannel.appendLine(`Unable to read BoxLang version cache: ${error}`);
        }
    }

    let versionsFromAWS: BoxLangVersion[];
    try {
        versionsFromAWS = await getBoxLangVersionsFromAWS();
    } catch (error) {
        try {
            const cachedVersions = await readVersionsFromLocalCache();
            boxlangOutputChannel.appendLine(`Using stale BoxLang version cache because S3 discovery failed: ${error}`);
            return cachedVersions;
        } catch (cacheError) {
            boxlangOutputChannel.appendLine(`No usable BoxLang version cache: ${cacheError}`);
        }
        throw error;
    }

    try {
        await writeVersionsToLocalCache(versionsFromAWS);
    } catch (error) {
        boxlangOutputChannel.appendLine(`Unable to save BoxLang version cache: ${error}`);
    }
    return versionsFromAWS;
}

async function getBoxLangVersionsFromAWS(): Promise<BoxLangVersion[]> {
    try {
        boxlangOutputChannel.appendLine("Fetching BoxLang versions from S3...");
        const versions = await DownloadManager.listS3BoxLangVersions();

        // Convert to legacy format
        const boxlangVersions: BoxLangVersion[] = versions.map(v => ({
            url: v.url,
            lastModified: v.date,
            name: `boxlang-${v.version}`,
            etag: v.etag
        }));

        boxlangOutputChannel.appendLine(`Found ${boxlangVersions.length} BoxLang versions`);
        return boxlangVersions;
    } catch (error) {
        boxlangOutputChannel.appendLine(`Error fetching BoxLang versions: ${error}`);
        throw error;
    }
}

async function isLocalVersionFileUsable(): Promise<boolean>{
    try {
        const stats = await fs.stat(BOXLANG_LOCAL_VERSIONS_CACHE);

        const now = new Date();
        const modifiedTime = new Date(stats.mtime);
        const diffInMinutes = (now.getTime() - modifiedTime.getTime()) / (1000 * 60);
       return diffInMinutes < 30;
    }
    catch (e) {
        return false;
    }
}

async function readVersionsFromLocalCache(): Promise<BoxLangVersion[]> {
    const data = await fs.readFile(BOXLANG_LOCAL_VERSIONS_CACHE);
    return JSON.parse(data + "").map((version: BoxLangVersion) => ({
        ...version,
        lastModified: new Date(version.lastModified)
    }));
}

async function writeVersionsToLocalCache( versions: BoxLangVersion[] ): Promise<void> {
    await fs.writeFile( BOXLANG_LOCAL_VERSIONS_CACHE, JSON.stringify( versions ) );
}
