import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ExtensionContext } from "vscode";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { downloadFile, extractArchive } from "./fileUtil";

type CommandBoxResult = {
    code: number,
    stdout: string,
    stderr: string
}

type CommandBoxExecutable = {
    path: string,
    isSystemBox: boolean,
    commandBoxHome?: string
}

let context: ExtensionContext;
let boxExecutable: CommandBoxExecutable | null = null;

export let boxlangModuleCache = [];

/**
 * Sets up CommandBox detection and installation
 * @param extensionContext VSCode extension context
 */
export async function setupCommandBox(extensionContext: ExtensionContext): Promise<void> {
    context = extensionContext;
    await detectAndSetupCommandBox();
    await refresBoxLangModuleCache();
}

/**
 * Detects CommandBox installation and sets up the appropriate executable
 */
async function detectAndSetupCommandBox(): Promise<void> {
    boxlangOutputChannel.appendLine("Checking for CommandBox installation...");
    
    // First, try to use system CommandBox
    if (await checkSystemCommandBox()) {
        boxExecutable = {
            path: "box",
            isSystemBox: true
        };
        boxlangOutputChannel.appendLine("✓ CommandBox found on system PATH");
        return;
    }
    
    boxlangOutputChannel.appendLine("CommandBox not found on system PATH");
    
    // If system CommandBox not available, try to use local CommandBox
    const localBoxPath = await getLocalCommandBoxPath();
    if (localBoxPath && fs.existsSync(localBoxPath)) {
        const commandBoxHome = path.join(context.globalStorageUri.fsPath, "commandbox_home");
        boxExecutable = {
            path: localBoxPath,
            isSystemBox: false,
            commandBoxHome: commandBoxHome
        };
        boxlangOutputChannel.appendLine("✓ Using local CommandBox installation");
        return;
    }
    
    // If no CommandBox available, download and install it
    boxlangOutputChannel.appendLine("Downloading CommandBox for local use...");
    await downloadAndInstallCommandBox();
}

/**
 * Checks if CommandBox is available on the system PATH
 */
async function checkSystemCommandBox(): Promise<boolean> {
    return new Promise((resolve) => {
        const child = spawn("box", ["version"], {
            stdio: "pipe"
        });
        
        let hasOutput = false;
        
        child.stdout.on("data", () => {
            hasOutput = true;
        });
        
        child.on("close", (code) => {
            resolve(code === 0 && hasOutput);
        });
        
        child.on("error", () => {
            resolve(false);
        });
        
        // Timeout after 5 seconds
        setTimeout(() => {
            if (!child.killed) {
                child.kill();
                resolve(false);
            }
        }, 5000);
    });
}

/**
 * Gets the path to the local CommandBox executable
 */
async function getLocalCommandBoxPath(): Promise<string | null> {
    if (!context) {
        return null;
    }
    
    const commandBoxDir = path.join(context.globalStorageUri.fsPath, "commandbox");
    const isWindows = os.platform() === "win32";
    const boxExecutableName = isWindows ? "box.exe" : "box";
    
    return path.join(commandBoxDir, "bin", boxExecutableName);
}

/**
 * Downloads and installs CommandBox for local use
 */
async function downloadAndInstallCommandBox(): Promise<void> {
    const platform = os.platform();
    const commandBoxDir = path.join(context.globalStorageUri.fsPath, "commandbox");
    const commandBoxHome = path.join(context.globalStorageUri.fsPath, "commandbox_home");
    
    // Create directories if they don't exist
    if (!fs.existsSync(commandBoxDir)) {
        fs.mkdirSync(commandBoxDir, { recursive: true });
    }
    
    if (!fs.existsSync(commandBoxHome)) {
        fs.mkdirSync(commandBoxHome, { recursive: true });
    }
    
    let downloadUrl: string;
    let fileName: string;
    
    switch (platform) {
        case "win32":
            downloadUrl = "https://www.ortussolutions.com/parent/download/commandbox/type/windows-jre64";
            fileName = "commandbox-windows-jre64.zip";
            break;
        case "darwin":
            downloadUrl = "https://www.ortussolutions.com/parent/download/commandbox/type/bin-jre";
            fileName = "commandbox-mac-jre.zip";
            break;
        case "linux":
            downloadUrl = "https://www.ortussolutions.com/parent/download/commandbox/type/linux-jre64";
            fileName = "commandbox-linux-jre64.zip";
            break;
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
    
    try {
        const downloadPath = path.join(commandBoxDir, fileName);
        boxlangOutputChannel.appendLine(`Downloading CommandBox from: ${downloadUrl}`);
        
        await downloadFile(downloadUrl, downloadPath);
        boxlangOutputChannel.appendLine("CommandBox download completed");
        
        // Extract the archive
        boxlangOutputChannel.appendLine("Extracting CommandBox...");
        await extractArchive(downloadPath, commandBoxDir);
        
        // Remove the downloaded archive
        fs.unlinkSync(downloadPath);
        
        // Set up the executable
        const boxExecutablePath = await getLocalCommandBoxPath();
        if (boxExecutablePath && fs.existsSync(boxExecutablePath)) {
            // Make sure the executable has proper permissions on Unix-like systems
            if (platform !== "win32") {
                fs.chmodSync(boxExecutablePath, 0o755);
            }
            
            boxExecutable = {
                path: boxExecutablePath,
                isSystemBox: false,
                commandBoxHome: commandBoxHome
            };
            
            boxlangOutputChannel.appendLine("✓ CommandBox installed and configured for local use");
        } else {
            throw new Error("CommandBox executable not found after installation");
        }
        
    } catch (error) {
        boxlangOutputChannel.appendLine(`Error installing CommandBox: ${error.message}`);
        throw error;
    }
}

async function refresBoxLangModuleCache() {
    boxlangModuleCache = [];

    try {
        const res = await getBoxlangModuleList();

        if (res.code != 0) {
            return;
        }

        boxlangModuleCache = JSON.parse(res.stdout).results;
    }
    catch (e) {
        boxlangOutputChannel.appendLine("Unable to retrieve boxlang modules from forgebox");
        boxlangOutputChannel.append(e.toString());
    }
}


// function getCommandBoxHome() {
//     if (process.env.COMMANDBOX_HOME) {
//         return process.env.COMMANDBOX_HOME
//     }

//     return path.join(process.env.USERPROFILE, ".CommandBox")
// }

async function runCommandBox(env: Record<string, any>, ...args: string[]): Promise<CommandBoxResult> {
    if (!boxExecutable) {
        throw new Error("CommandBox is not available. Please ensure CommandBox is installed or restart the extension.");
    }
    
    const environment = { ...process.env, ...env };
    
    // If using local CommandBox, set the COMMANDBOX_HOME environment variable
    if (!boxExecutable.isSystemBox && boxExecutable.commandBoxHome) {
        environment.COMMANDBOX_HOME = boxExecutable.commandBoxHome;
    }
    
    return new Promise((resolve, reject) => {
        const boxLang = spawn(boxExecutable.path, args, {
            env: environment
        });
        let stdout = '';
        let stderr = '';

        boxLang.stdout.on("data", data => {
            stdout += data;
        });

        boxLang.stderr.on("data", data => {
            stderr += data;
        });

        boxLang.on("exit", code => {
            resolve({
                code,
                stdout,
                stderr
            });
        });
        
        boxLang.on("error", error => {
            reject(error);
        });
    });
}

export async function installBoxLangModuleToDir( moduleName: string, directory: string ): Promise<CommandBoxResult> {
    return runCommandBox({}, "install", `id=${moduleName}`, `directory="${directory}"`);
}

export async function installBoxLangModule(boxlangHome: string, moduleName: string): Promise<CommandBoxResult> {
    return runCommandBox({ BOXLANG_HOME: boxlangHome }, "install", moduleName, "--verbose");
}

export async function uninstallBoxLangModule(boxlangHome, moduleName: string): Promise<CommandBoxResult> {
    return runCommandBox({ BOXLANG_HOME: boxlangHome }, "uninstall", moduleName, "--verbose");
}

export async function getBoxlangModuleList(): Promise<CommandBoxResult> {
    return runCommandBox({}, "forgebox", "show", "boxlang-modules", "--json");
}

/**
 * Gets information about the current CommandBox setup
 */
export function getCommandBoxInfo(): CommandBoxExecutable | null {
    return boxExecutable;
}

/**
 * Checks if CommandBox is available and properly set up
 */
export function isCommandBoxAvailable(): boolean {
    return boxExecutable !== null;
}