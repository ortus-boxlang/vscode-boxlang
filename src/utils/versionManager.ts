// import fs from "fs";
import fs from "fs/promises";
import path from "path";
import { ExtensionContext } from "vscode";
import { ExtensionConfig } from "./Configuration";
import * as fileUtil from "./fileUtil";
import { boxlangOutputChannel } from "./OutputChannels";

const AWS = require('aws-sdk');

const BUCKET_NAME = "downloads.ortussolutions.com";
const client = new AWS.S3({});


export type BoxLangVersion = {
    url: string,
    lastModified: Date,
    name: string,
    jarPath?: string
}

let BOXLANG_INSTALLATIONS = "";
let BOXLANG_LOCAL_VERSIONS_CACHE = "";
let context = null;

export async function setupVersionManagement(_context: ExtensionContext): Promise<void> {
    context = _context;
    BOXLANG_INSTALLATIONS = path.join(context.globalStorageUri.fsPath, "boxlang_versions");
    BOXLANG_LOCAL_VERSIONS_CACHE = path.join(context.globalStorageUri.fsPath, "boxlang_version_cache.json");

    getAvailableBoxLangVerions();

    try {
        await fs.access(BOXLANG_INSTALLATIONS);
    }
    catch (e) {
        fs.mkdir(BOXLANG_INSTALLATIONS);
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

    if( !validateConfiguredVersion( configuredVersion ) ){
        boxlangOutputChannel.appendLine("Configured BoxLang version is not valid: " + configuredVersion);
        boxlangOutputChannel.appendLine("Falling back to included BoxLang JAR path: " + ExtensionConfig.includedBoxLangJarPath);
        return ExtensionConfig.includedBoxLangJarPath;
    }

    try{
        return ensureBoxLangVersion( configuredVersion );
    }
    catch( e ){
        boxlangOutputChannel.appendLine("Error ensuring BoxLang version: " + configuredVersion);
        boxlangOutputChannel.appendLine( e );
        boxlangOutputChannel.appendLine("Falling back to included BoxLang JAR path: " + ExtensionConfig.includedBoxLangJarPath);
        return ExtensionConfig.includedBoxLangJarPath;
    }
}


export async function ensureBoxLangVersion(version: String): Promise<string> {
    boxlangOutputChannel.appendLine("Ensuring BoxLang version is installed: " + version);
    const boxlangVersionSring = version.startsWith("boxlang-") ? version : `boxlang-${version}`;
    const downloadedVersions = await getDownloadedBoxLangVersions();

    const versionObj = downloadedVersions.find(v => v.name === boxlangVersionSring);

    try {
        await fs.access(versionObj.jarPath);
        boxlangOutputChannel.appendLine("BoxLang version found: " + boxlangVersionSring);
        return versionObj.jarPath;
    }
    catch (e) {
        const availableVersions = await getAvailableBoxLangVerions();
        const versionToDownload = availableVersions.find(v => v.name === boxlangVersionSring);
        boxlangOutputChannel.appendLine("BoxLang version not found, installing: " + versionToDownload.name);
        try{
            const jarPath = await installVersion(versionToDownload);
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


export async function getAvailableBoxLangVerions(): Promise<BoxLangVersion[]> {
    if (!(await isLocalVersionFileUsable() )) {
        const versionsFromAWS = await getBoxLangVersionsFromAWS();
        await writeVersionsToLocalCache( versionsFromAWS );

        return versionsFromAWS;
    }

    return readVersionsFromLocalCache();
}

async function getBoxLangVersionsFromAWS(): Promise<BoxLangVersion[]> {
    return new Promise((resolve, reject) => {
        const boxlangVersions = [];
        const versionPattern = /\.jar$/i;
        const isJavaDoc = /javadoc/i;

        client.makeUnauthenticatedRequest(
            'listObjects',
            { Bucket: BUCKET_NAME, Prefix: "ortussolutions/boxlang/" },
            function (err, data) {

                if (err) {
                    console.log("Error", err);
                    reject();
                }

                data.Contents.forEach(item => {
                    if (!versionPattern.test(item.Key)) {
                        return;
                    }

                    if (isJavaDoc.test(item.Key)) {
                        return;
                    }

                    boxlangVersions.push({
                        url: `https://${BUCKET_NAME}/${item.Key}`,
                        lastModified: item.LastModified,
                        name: item.Key.split("/").pop().replace(".jar", "")
                    });
                });

                boxlangVersions.sort((a, b) => a.lastModified < b.lastModified ? 1 : -1);

                resolve(boxlangVersions);
            }
        );
    });
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
    return JSON.parse(data + "");
}

async function writeVersionsToLocalCache( versions: BoxLangVersion[] ): Promise<void> {
    await fs.writeFile( BOXLANG_LOCAL_VERSIONS_CACHE, JSON.stringify( versions ) );
}

async function validateConfiguredVersion( version: string ): Promise<boolean> {
    const availableVersions = await getAvailableBoxLangVerions();
    const boxlangVersionString = version.startsWith("boxlang-") ? version : `boxlang-${version}`;
    return availableVersions.some(v => v.name === boxlangVersionString);
}