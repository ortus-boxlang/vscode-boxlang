
import { spawn } from "child_process";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { ExtensionConfig } from "./Configuration";
import axios from "axios";
import extract from "extract-zip";
import fs from "fs";
import fsp from "fs/promises";
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

export function getJavaInstallDir(){
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

            if ( !matches || !matches.length) {
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

export async function setupLocalJavaInstall( context: ExtensionContext ){
    JAVA_INSTALL_DIR = path.join(context.globalStorageUri.fsPath, "java_install");

    // Create the java install directory if it doesn't exist
    try{
        await fsp.access(JAVA_INSTALL_DIR);
        boxlangOutputChannel.appendLine("Java install directory already exists - skipping download");
        return;
    }
    catch( e ){
        boxlangOutputChannel.appendLine("Java install directory does not exist - downloading java");
        await fsp.mkdir(JAVA_INSTALL_DIR);
    }

    // download a java version if it doesn't exist
    const link = await getSpecificDownloadLink();
    const filePath = await downloadFile(JAVA_INSTALL_DIR, link);

    const extractedPath = await extractArchive(JAVA_INSTALL_DIR, filePath);

    const settingPath = osMap[process.platform] == "windows"
        ? path.join(extractedPath)
        : path.join(extractedPath, "Contents", "Home");

    // copy contents of setting path to JAVA_INSTALL_DIR
    const files = fs.readdirSync(settingPath);
    for( const file of files ){
        const src = path.join(settingPath, file);
        const dest = path.join(JAVA_INSTALL_DIR, file);
        await fsp.cp(src, dest, { recursive: true } );
    }

    //clean up extractedPath
    fsp.rm(extractedPath, { recursive: true, force: true });
    // clean up filePath
    fsp.rm(filePath, { force: true });

    boxlangOutputChannel.appendLine("Java was downloaded and extracted successfully - setting java home to " + settingPath);
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

async function getSpecificDownloadLink(){
    return getDownloadLink(osMap[process.platform], archMap[process.arch]);
}

async function extractArchive(javaInstallDir: string, archiveFilePath: string) {
    const existingFiles = fs.readdirSync(javaInstallDir);

    if (/\.zip$/.test(archiveFilePath)) {
        await extractZip(javaInstallDir, archiveFilePath);
    }
    else {
        await extractTarGz(javaInstallDir, archiveFilePath);
    }

    const newFiles = fs.readdirSync(javaInstallDir);

    return path.join(javaInstallDir, newFiles.find(file => !existingFiles.includes(file)));
}

async function extractTarGz(javaInstallDir: string, archiveFilePath: string) {
    return tar.x({
        f: archiveFilePath,
        C: javaInstallDir // alias for cwd:'some-dir', also ok
    });
}

async function extractZip(javaInstallDir: string, archiveFilePath: string) {
    await extract(archiveFilePath, {
        dir: javaInstallDir
    });
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