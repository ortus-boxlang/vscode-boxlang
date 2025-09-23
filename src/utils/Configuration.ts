import path from "path";
import { ConfigurationTarget, ExtensionContext, workspace } from "vscode";
import { getJavaInstallDir } from "./Java";

let INCLUDED_BOXLANG_JAR_PATH = "";
let INCLUDED_BOXLANG_MINISERVER_JAR_PATH = "";
let INCLUDED_BOXLANG_LSP_PATH = "";
let DEFAULT_LSP_BOXLANG_HOME = "";
let BVMRC_VERSION: string | null = null;
let BVMRC_JAR_PATH: string | null = null;

export function setupConfiguration(context: ExtensionContext) {
    INCLUDED_BOXLANG_JAR_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang.jar");
    INCLUDED_BOXLANG_MINISERVER_JAR_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang-miniserver.jar");
    INCLUDED_BOXLANG_LSP_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang-lsp.jar");
    DEFAULT_LSP_BOXLANG_HOME = path.join(context.storageUri.fsPath, "default_lsp_boxlang_home");
}

export function getUserProfileBoxLangHome() {
    const userProfile = process.env.USERPROFILE || process.env.HOME;

    return path.join(userProfile, ".boxlang");
}

/**
 * Sets the .bvmrc version to be used for the current workspace
 * @param version The version string from .bvmrc
 * @param jarPath The path to the JAR file for this version
 */
export function setBvmrcVersion(version: string | null, jarPath: string | null = null) {
    BVMRC_VERSION = version;
    BVMRC_JAR_PATH = jarPath;
}

/**
 * Gets the current .bvmrc version if set
 * @returns The version string or null if not set
 */
export function getBvmrcVersion(): string | null {
    return BVMRC_VERSION;
}

export const ExtensionConfig = {
    set ignoreOldSettings(value) {
        workspace.getConfiguration("boxlang.settings").update("ignoreOldSettings", value, ConfigurationTarget.Global);
    },

    get ignoreOldSettings() {
        return workspace.getConfiguration("boxlang.settings").get<boolean>('ignoreOldSettings');
    },

    get customAntlrToolsCommand() {
        return workspace.getConfiguration("boxlang").get<string>('customAntlrToolsCommand');
    },

    /**
     * The path to the boxlang home directory
     *
     * Defaults to the user's home directory but this can be overridden by setting the `boxLangHome` setting
     */
    get boxLangHome(){
        const configuredHome = workspace.getConfiguration("boxlang").get<string>('boxLangHome');

        if( !!configuredHome ){
            return configuredHome;
        }

        return getUserProfileBoxLangHome();
    },

    set boxlangJavaHome(path: string) {
        workspace.getConfiguration("boxlang.java").update("javaHome", path, ConfigurationTarget.Global);
    },

    get boxlangJavaExecutable() {
        return path.join(this.boxlangJavaHome, "bin", "java");
    },

    get boxlangJavaHome() {
        const javaPath = workspace.getConfiguration("boxlang.java").get<string>('javaHome');

        if (!javaPath) {
            return getJavaInstallDir();
        }

        return javaPath;
    },

    get boxlangMiniServerJarPath() {
        const jarPath = workspace.getConfiguration("boxlang").get<string>('miniserverjarpath');

        return jarPath || INCLUDED_BOXLANG_MINISERVER_JAR_PATH;
    },

    set boxlangJarPath(path: string) {
        workspace.getConfiguration("boxlang").update("jarpath", path, ConfigurationTarget.Global);
    },

    get boxlangJarPath() {
        // If .bvmrc version is set and jar path is available, use it
        if (BVMRC_VERSION && BVMRC_JAR_PATH) {
            return BVMRC_JAR_PATH;
        }

        const jarPath = workspace.getConfiguration("boxlang").get<string>('jarpath');

        return jarPath || INCLUDED_BOXLANG_JAR_PATH;
    },

    get boxlangLSPPath() {
        const jarPath = workspace.getConfiguration("boxlang").get<string>('lspjarpath');

        return jarPath || INCLUDED_BOXLANG_LSP_PATH;
    },

    get boxLangLSPBoxLangVersion() {
        return workspace.getConfiguration("boxlang.lsp").get<string>('boxLangVersion');
    },

    get boxlangLSPVersion() {
        return workspace.getConfiguration("boxlang.lsp").get<string>('lspVersion');
    },

    get boxlangLSPBoxLangHome() {
        const lspBoxLangHome = workspace.getConfiguration("boxlang.lsp").get<string>('boxLangHome');

        if( !lspBoxLangHome ){
            return DEFAULT_LSP_BOXLANG_HOME;
        }

        if( path.isAbsolute(lspBoxLangHome) ){
            return lspBoxLangHome;
        }

        return path.join( workspace.workspaceFolders[0].uri.fsPath, lspBoxLangHome);
    },

    get boxlangMaxHeapSize() {
        const maxHeapSize = workspace.getConfiguration("boxlang.lsp").get<string>('maxHeapSize');
        const parsed = Number.parseInt(maxHeapSize);

        return Number.isNaN(parsed) || parsed == 0 ? 512 : parsed;
    },

    get boxlangLSPJVMArgs() {
        return workspace.getConfiguration("boxlang.lsp").get<string>('jvmArgs');
    },

    get boxlangLSPModules() {
        return workspace.getConfiguration("boxlang.lsp").get<string>('modules') || '';
    },

    get boxlangServerPort() {
        return Number.parseInt(workspace.getConfiguration("boxlang").get<string>('webPort')) || 8080;
    },

    get showImplicitFunctions() {
        return workspace.getConfiguration("boxlang.cfml.outline").get<boolean>("showImplicitFunctions", true);
    }
}