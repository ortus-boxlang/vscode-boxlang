import * as fs from "fs";
import * as path from "path";
import { DownloadManager } from "./DownloadManager";
import { ForgeBoxClient, ForgeBoxEntry } from "./ForgeBoxClient";

// Conditional import for VS Code output channel
let boxlangOutputChannel: any;
try {
    boxlangOutputChannel = require("./OutputChannels").boxlangOutputChannel;
} catch (e) {
    // Fallback for testing without VS Code
    boxlangOutputChannel = {
        appendLine: (msg: string) => console.log(msg),
        append: (msg: string) => process.stdout.write(msg)
    };
}

// Lazy-load CommandBox to avoid VS Code dependencies in tests
let commandBoxModule: any = null;
function getCommandBox() {
    if (!commandBoxModule) {
        commandBoxModule = require("./CommandBox");
    }
    return commandBoxModule;
}

export interface BoxJsonModule {
    name?: string;
    version?: string;
    boxlang?: {
        version?: string;
        minimumVersion?: string;
    };
    dependencies?: Record<string, string>;
}

/**
 * Module management using native TypeScript with CommandBox fallback
 * Replaces direct CommandBox dependencies for module operations
 */
export class ModuleManager {
    private forgeBoxClient: ForgeBoxClient;
    private useNativeMode: boolean;

    constructor(useNativeMode: boolean = true) {
        this.forgeBoxClient = new ForgeBoxClient();
        this.useNativeMode = useNativeMode;
    }

    /**
     * Install a BoxLang module
     * @param moduleName - Module slug (e.g., "bx-lsp@1.5.0" or just "bx-compat")
     * @param boxlangHome - BoxLang home directory
     * @param fallbackToCommandBox - Whether to use CommandBox on native failure
     */
    async installModule(
        moduleName: string,
        boxlangHome: string,
        fallbackToCommandBox: boolean = true
    ): Promise<boolean> {
        if (!this.useNativeMode) {
            return this.installViaCommandBox(moduleName, boxlangHome);
        }

        try {
            boxlangOutputChannel.appendLine(`Installing module: ${moduleName} (native mode)`);

            // Parse module name and version
            const [slug, version] = this.parseModuleSpec(moduleName);

            // Get download URL from ForgeBox
            const downloadURL = await this.forgeBoxClient.getDownloadURL(slug, version);
            boxlangOutputChannel.appendLine(`Download URL: ${downloadURL}`);

            // Determine installation directory
            const modulesDir = path.join(boxlangHome, "modules");
            const moduleDir = path.join(modulesDir, slug);

            // Clean existing installation
            if (fs.existsSync(moduleDir)) {
                boxlangOutputChannel.appendLine(`Removing existing module: ${moduleDir}`);
                await fs.promises.rm(moduleDir, { recursive: true, force: true });
            }

            // Download and extract
            await DownloadManager.downloadAndExtract(downloadURL, moduleDir);

            // Validate installation by checking for box.json
            const boxJsonPath = path.join(moduleDir, "box.json");
            if (!fs.existsSync(boxJsonPath)) {
                throw new Error(`Module installation failed: box.json not found at ${boxJsonPath}`);
            }

            // Parse box.json for shallow dependency resolution
            const boxJson = await this.readBoxJson(boxJsonPath);
            if (boxJson.dependencies && Object.keys(boxJson.dependencies).length > 0) {
                boxlangOutputChannel.appendLine(`Module has dependencies: ${Object.keys(boxJson.dependencies).join(", ")}`);
                // Note: Not installing dependencies recursively (as per user requirement #2)
            }

            boxlangOutputChannel.appendLine(`Module installed successfully: ${slug}`);
            return true;

        } catch (error) {
            boxlangOutputChannel.appendLine(`Native installation failed: ${error}`);

            if (fallbackToCommandBox) {
                boxlangOutputChannel.appendLine(`Falling back to CommandBox...`);
                return this.installViaCommandBox(moduleName, boxlangHome);
            }

            throw error;
        }
    }

    /**
     * Install module to a specific directory (not standard BoxLang home)
     */
    async installModuleToDir(
        moduleName: string,
        directory: string,
        fallbackToCommandBox: boolean = true
    ): Promise<boolean> {
        if (!this.useNativeMode) {
            // CommandBox doesn't have installToDir, so we'll use standard install
            // This is a simplified fallback
            return this.installViaCommandBox(moduleName, directory);
        }

        try {
            boxlangOutputChannel.appendLine(`Installing module to directory: ${moduleName} -> ${directory}`);

            const [slug, version] = this.parseModuleSpec(moduleName);
            const downloadURL = await this.forgeBoxClient.getDownloadURL(slug, version);

            // Create target directory
            await fs.promises.mkdir(directory, { recursive: true });

            // Download and extract directly to target
            await DownloadManager.downloadAndExtract(downloadURL, directory);

            // Normalize extraction so content always lives under <directory>/<slug>/*
            await this.ensureNestedModuleDirectory(directory, slug);

            // Validate installation by checking for box.json
            const boxJsonPath = path.join(directory, slug, "box.json");
            if (!fs.existsSync(boxJsonPath)) {
                throw new Error(`Module installation failed: box.json not found at ${boxJsonPath}`);
            }

            boxlangOutputChannel.appendLine(`Module installed to directory: ${directory}`);
            return true;

        } catch (error) {
            boxlangOutputChannel.appendLine(`Native installation failed: ${error}`);

            if (fallbackToCommandBox) {
                boxlangOutputChannel.appendLine(`Falling back to CommandBox...`);
                return this.installViaCommandBox(moduleName, directory);
            }

            throw error;
        }
    }

    /**
     * Ensures extracted content is nested under <directory>/<slug>.
     * Some archives extract directly into the target directory, while other
     * archives include a top-level folder. We normalize both cases so callers
     * can rely on <directory>/<slug>/box.json existing.
     */
    private async ensureNestedModuleDirectory(directory: string, slug: string): Promise<void> {
        const slugDir = path.join(directory, slug);

        // Already nested correctly
        try {
            const stat = await fs.promises.stat(slugDir);
            if (stat.isDirectory()) {
                return;
            }
        } catch {
            // ignore
        }

        await fs.promises.mkdir(slugDir, { recursive: true });

        const entries = await fs.promises.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === slug) {
                continue;
            }

            const fromPath = path.join(directory, entry.name);
            const toPath = path.join(slugDir, entry.name);

            // If destination exists, remove it first to make rename safe.
            try {
                if (fs.existsSync(toPath)) {
                    await fs.promises.rm(toPath, { recursive: true, force: true } as any);
                }
            } catch {
                // ignore
            }

            await fs.promises.rename(fromPath, toPath);
        }
    }

    /**
     * Uninstall a BoxLang module
     */
    async uninstallModule(
        moduleName: string,
        boxlangHome: string,
        fallbackToCommandBox: boolean = true
    ): Promise<boolean> {
        if (!this.useNativeMode) {
            return this.uninstallViaCommandBox(moduleName, boxlangHome);
        }

        try {
            boxlangOutputChannel.appendLine(`Uninstalling module: ${moduleName}`);

            const [slug] = this.parseModuleSpec(moduleName);
            const moduleDir = path.join(boxlangHome, "modules", slug);

            if (!fs.existsSync(moduleDir)) {
                boxlangOutputChannel.appendLine(`Module not found: ${moduleDir}`);
                return true; // Already uninstalled
            }

            await fs.promises.rm(moduleDir, { recursive: true, force: true });
            boxlangOutputChannel.appendLine(`Module uninstalled: ${slug}`);
            return true;

        } catch (error) {
            boxlangOutputChannel.appendLine(`Native uninstallation failed: ${error}`);

            if (fallbackToCommandBox) {
                boxlangOutputChannel.appendLine(`Falling back to CommandBox...`);
                return this.uninstallViaCommandBox(moduleName, boxlangHome);
            }

            throw error;
        }
    }

    /**
     * List all available BoxLang modules from ForgeBox
     */
    async listModules(fallbackToCommandBox: boolean = true): Promise<ForgeBoxEntry[]> {
        if (!this.useNativeMode) {
            return this.listViaCommandBox();
        }

        try {
            boxlangOutputChannel.appendLine(`Fetching BoxLang modules from ForgeBox...`);
            const modules = await this.forgeBoxClient.listBoxLangModules();
            boxlangOutputChannel.appendLine(`Found ${modules.length} modules`);
            return modules;

        } catch (error) {
            boxlangOutputChannel.appendLine(`Native module listing failed: ${error}`);

            if (fallbackToCommandBox) {
                boxlangOutputChannel.appendLine(`Falling back to CommandBox...`);
                return this.listViaCommandBox();
            }

            throw error;
        }
    }

    /**
     * Read and parse box.json file
     */
    private async readBoxJson(boxJsonPath: string): Promise<BoxJsonModule> {
        try {
            const content = await fs.promises.readFile(boxJsonPath, "utf-8");
            return JSON.parse(content);
        } catch (error) {
            boxlangOutputChannel.appendLine(`Failed to read box.json: ${error}`);
            return {};
        }
    }

    /**
     * Parse module specification (e.g., "bx-lsp@1.5.0" -> ["bx-lsp", "1.5.0"])
     */
    private parseModuleSpec(moduleSpec: string): [string, string | undefined] {
        const parts = moduleSpec.split("@");
        return [parts[0], parts[1]];
    }

    /**
     * CommandBox fallback methods
     */
    private async installViaCommandBox(moduleName: string, boxlangHome: string): Promise<boolean> {
        try {
            const { installBoxLangModule } = getCommandBox();
            await installBoxLangModule(boxlangHome, moduleName);
            return true;
        } catch (error) {
            boxlangOutputChannel.appendLine(`CommandBox installation failed: ${error}`);
            throw error;
        }
    }

    private async uninstallViaCommandBox(moduleName: string, boxlangHome: string): Promise<boolean> {
        try {
            const { uninstallBoxLangModule } = getCommandBox();
            await uninstallBoxLangModule(boxlangHome, moduleName);
            return true;
        } catch (error) {
            boxlangOutputChannel.appendLine(`CommandBox uninstallation failed: ${error}`);
            throw error;
        }
    }

    private async listViaCommandBox(): Promise<ForgeBoxEntry[]> {
        try {
            const { getBoxlangModuleList } = getCommandBox();
            const result = await getBoxlangModuleList();

            // Parse CommandBox JSON output
            if (result.code !== 0) {
                boxlangOutputChannel.appendLine(`CommandBox module listing failed with code ${result.code}`);
                return [];
            }

            const parsed = JSON.parse(result.stdout);
            return parsed.results || [];
        } catch (error) {
            boxlangOutputChannel.appendLine(`CommandBox module listing failed: ${error}`);
            throw error;
        }
    }

    /**
     * Get the BoxLang minimum version requirement from a module's box.json
     */
    async getModuleMinimumBoxLangVersion(moduleDir: string): Promise<string | null> {
        const boxJsonPath = path.join(moduleDir, "box.json");

        if (!fs.existsSync(boxJsonPath)) {
            return null;
        }

        const boxJson = await this.readBoxJson(boxJsonPath);
        return boxJson.boxlang?.minimumVersion || boxJson.boxlang?.version || null;
    }
}
