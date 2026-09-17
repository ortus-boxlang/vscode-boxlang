import { spawn } from "child_process";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { ExtensionConfig } from "./Configuration";
import axios from "axios";
import extract from "extract-zip";
import fs from "fs";
import fsp from "fs/promises";
import { findJavaHome } from "./JavaHomeFinder";
import path from "path";
import * as tar from "tar";
import vscode, { ExtensionContext, ProgressLocation } from "vscode";
import * as LSP from "../utils/LanguageServer";

let javaIsOkay = null;
let JAVA_INSTALL_DIR = null;

// pulled from https://api.adoptium.net/v3/types/operating_systems
const osMap = {
    "aix": "aix",
    "darwin": "mac",
    "freebsd": "linux",
    "linux": "linux",
    "openbsd": "linux",
    "sunos": "linux",
    "win32": "windows"
};

// pulled from https://api.adoptium.net/v3/types/architectures
const archMap = {
    "arm": "arm",
    "arm64": "aarch64",
    "ia32": "x32",
    // "loong64": "loong64",
    // "mips": "mips",
    // "mipsel": "mipsel",
    // "ppc": "ppc",
    // "ppc64": "ppc64",
    "riscv64": "riscv64",
    // "s390": "s390",
    "s390x": "s390x",
    "x64": "x64"
};

export function getJavaInstallDir() {
    return JAVA_INSTALL_DIR;
}

export function detectJavaVerison(refresh = false) {
    return new Promise((resolve, reject) => {
        if (!refresh && javaIsOkay !== null) {
            resolve(javaIsOkay);
            return;
        }

        const javaExecutable = ExtensionConfig.boxlangJavaHome;

        const boxLang = spawn(javaExecutable, ["--version"]);
        let stdout = '';
        let stderr = '';

        boxLang.stdout.on("data", data => stdout += data);
        boxLang.stderr.on("data", data => stderr += data);

        boxLang.on("error", e => {
            resolve(false);
        });

        boxLang.on("exit", code => {
            const matches = /(\d+)\.\d+\.\d+/g.exec(stdout);

            if (!matches || !matches.length) {
                boxlangOutputChannel.appendLine("No java executable was found on the path");
                javaIsOkay = false;
                resolve(javaIsOkay);
                return;
            }

            if (Number.parseInt(matches[1]) < 21) {
                boxlangOutputChannel.appendLine(`This extension requires a version of java newer than ${matches[0]}. Try setting a custom JVM location in boxlang.java.javaHome setting.`);
                javaIsOkay = false;
                resolve(javaIsOkay);
                return;
            }

            javaIsOkay = true;
            resolve(javaIsOkay);
        });
    });
}

export async function setupLocalJavaInstall(context: ExtensionContext) {
    // Download Java may select a nested JDK inside java_install. Do not erase
    // an explicitly configured installation while repairing the managed one.
    if (vscode.workspace.getConfiguration("boxlang.java").get<string>("javaHome")) {
        return;
    }

    JAVA_INSTALL_DIR = null;
    const javaInstallDir = path.join(context.globalStorageUri.fsPath, "java_install");
    const javaExecutable = path.join(
        javaInstallDir,
        "bin",
        process.platform === "win32" ? "java.exe" : "java"
    );
    const accessMode = process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK;

    try {
        await fsp.access(javaExecutable, accessMode);
        JAVA_INSTALL_DIR = javaInstallDir;
        boxlangOutputChannel.appendLine(`Java installation is ready: ${javaExecutable}`);
        return;
    } catch {
        boxlangOutputChannel.appendLine(`Java installation is missing or incomplete: ${javaExecutable}`);
    }

    try {
        await fsp.rm(javaInstallDir, { recursive: true, force: true });
        await fsp.mkdir(javaInstallDir, { recursive: true });
        boxlangOutputChannel.appendLine("Downloading local Java 21 installation");

        const link = await getSpecificDownloadLink();
        const filePath = await downloadFile(javaInstallDir, link);
        const extractedPath = await extractArchive(javaInstallDir, filePath);

        const settingPath = await findJavaHome(extractedPath);
        if (!settingPath) {
            throw new Error(`Could not find bin/java executable in extracted archive at ${extractedPath}`);
        }

        // Copy the Java home contents into the stable installation path.
        for (const file of fs.readdirSync(settingPath)) {
            await fsp.cp(path.join(settingPath, file), path.join(javaInstallDir, file), { recursive: true });
        }

        await fsp.rm(extractedPath, { recursive: true, force: true });
        await fsp.rm(filePath, { force: true });
        await fsp.access(javaExecutable, accessMode);

        JAVA_INSTALL_DIR = javaInstallDir;
        boxlangOutputChannel.appendLine(`Java was downloaded and extracted successfully: ${javaExecutable}`);
    } catch (error) {
        await fsp.rm(javaInstallDir, { recursive: true, force: true }).catch(cleanupError => {
            boxlangOutputChannel.appendLine(`Unable to remove incomplete Java installation: ${cleanupError}`);
        });
        boxlangOutputChannel.appendLine(`Local Java setup failed: ${error}. Falling back to ${ExtensionConfig.boxlangJavaExecutable}`);
    }
}

export async function downloadJava(context: ExtensionContext) {
    const javaInstallDir = path.join(context.globalStorageUri.fsPath, "java_install");
    const os = osMap[process.platform];
    const arch = archMap[process.arch];

    if (!os || !arch) {
        vscode.window.showErrorMessage(`Unable to find correct java version for your os or architecture: ${process.platform} ${process.arch}`);
        return;
    }

    try {

        try {
            await LSP.stop();
        }
        catch (e) {

        }

        if (fs.existsSync(javaInstallDir)) {
            fs.rmSync(javaInstallDir, { recursive: true, force: true });
        }

        fs.mkdirSync(javaInstallDir);

        await vscode.window.withProgress(
            { title: "BoxLang: Downloading Java 21", location: ProgressLocation.Notification },
            async () => {
                const link = await getDownloadLink(os, arch);
                const filePath = await downloadFile(javaInstallDir, link);

                const extractedPath = await extractArchive(javaInstallDir, filePath);

                const settingPath = os == "windows"
                    ? path.join(extractedPath)
                    : path.join(extractedPath, "Contents", "Home");

                ExtensionConfig.boxlangJavaHome = settingPath;
            }
        );

        vscode.window.showInformationMessage("BoxLang: Java 21 was succesfully downloaded.");
    }
    catch (e) {
        vscode.window.showErrorMessage("BoxLang: Error downloading Java 21.");
    }

}

async function getSpecificDownloadLink() {
    return getDownloadLink(osMap[process.platform], archMap[process.arch]);
}

async function extractArchive(javaInstallDir: string, archiveFilePath: string): Promise<string> {
    if (/\.zip$/.test(archiveFilePath)) {
        return await extractZip(javaInstallDir, archiveFilePath);
    }
    else {
        return await extractTarGz(javaInstallDir, archiveFilePath);
    }
}

async function extractTarGz(javaInstallDir: string, archiveFilePath: string): Promise<string> {
    // Use tar.list() to get the first entry which is usually the root directory
    const entries: string[] = [];
    await tar.list({
        file: archiveFilePath,
        onentry: (entry) => {
            entries.push(entry.path);
        }
    });

    // Extract the archive
    await tar.x({
        f: archiveFilePath,
        C: javaInstallDir
    });

    if (entries.length === 0) {
        throw new Error("Archive appears to be empty");
    }

    // Find the root directory/file - typically the first entry or the shortest path
    const rootEntry = entries
        .filter(entry => !entry.includes('/') || entry.split('/').length === 2)
        .sort((a, b) => a.length - b.length)[0];

    if (!rootEntry) {
        // Fallback: use the common prefix of all entries
        const commonPrefix = entries.reduce((prefix, entry) => {
            const entryPath = entry.split('/')[0];
            return prefix === null ? entryPath : (prefix === entryPath ? prefix : '');
        }, null as string | null);

        if (commonPrefix) {
            return path.join(javaInstallDir, commonPrefix);
        }

        // Last resort: return the destination path
        return javaInstallDir;
    }

    // Remove trailing slash if present and get the first part of the path
    const cleanEntry = rootEntry.replace(/\/$/, '').split('/')[0];
    return path.join(javaInstallDir, cleanEntry);
}

async function extractZip(javaInstallDir: string, archiveFilePath: string): Promise<string> {
    // Extract and get the list of extracted entries
    const extractedEntries: string[] = [];

    await extract(archiveFilePath, {
        dir: javaInstallDir,
        onEntry: (entry) => {
            extractedEntries.push(entry.fileName);
        }
    });

    if (extractedEntries.length === 0) {
        throw new Error("Archive appears to be empty");
    }

    // Find the root directory/file - typically the first entry or the shortest path
    const rootEntry = extractedEntries
        .filter(entry => !entry.includes('/') || entry.split('/').length === 2)
        .sort((a, b) => a.length - b.length)[0];

    if (!rootEntry) {
        // Fallback: use the common prefix of all entries
        const commonPrefix = extractedEntries.reduce((prefix, entry) => {
            const entryPath = entry.split('/')[0];
            return prefix === null ? entryPath : (prefix === entryPath ? prefix : '');
        }, null as string | null);

        if (commonPrefix) {
            return path.join(javaInstallDir, commonPrefix);
        }

        // Last resort: return the destination path
        return javaInstallDir;
    }

    // Remove trailing slash if present and get the first part of the path
    const cleanEntry = rootEntry.replace(/\/$/, '').split('/')[0];
    return path.join(javaInstallDir, cleanEntry);
}


async function downloadFile(javaInstallDir: string, url: string): Promise<string> {
    const javaPath = path.join(javaInstallDir, getFileName(url));

    const readStream = await axios.get(url, {
        responseType: "stream"
    });

    return new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(javaPath);
        readStream.data.pipe(stream);

        stream.on("error", (err) => {
            reject(err);
        });

        stream.on("close", () => {
            resolve(javaPath)
        });
    });
}

function getFileName(url: string) {
    const extension = url.split(".").pop();

    return "java." + extension;
}

async function getDownloadLink(os: string, architecture: string) {
    const res = await axios.get("https://api.adoptium.net/v3/assets/feature_releases/21/ga", {
        params: {
            image_type: "jdk",
            os,
            architecture
        }
    });

    if (!res.data.length && !res.data[0].binaries.length) {
        return;
    }

    return res.data[0].binaries[0].package.link;
}