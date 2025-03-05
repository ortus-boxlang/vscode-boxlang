import path from "path";
import { ConfigurationTarget, ExtensionContext, workspace } from "vscode";
import { getJavaInstallDir } from "./Java";

let INCLUDED_BOXLANG_JAR_PATH = "";
let INCLUDED_BOXLANG_MINISERVER_JAR_PATH = "";
let INCLUDED_BOXLANG_LSP_PATH = "";

export function setupConfiguration(context: ExtensionContext) {
    INCLUDED_BOXLANG_JAR_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang.jar");
    INCLUDED_BOXLANG_MINISERVER_JAR_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang-miniserver.jar");
    INCLUDED_BOXLANG_LSP_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang-lsp.jar");
}

export function getUserProfileBoxLangHome() {
    const userProfile = process.env.USERPROFILE || process.env.HOME;

    return path.join(userProfile, ".boxlang");
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
        const jarPath = workspace.getConfiguration("boxlang").get<string>('jarpath');

        return jarPath || INCLUDED_BOXLANG_JAR_PATH;
    },

    get boxlangLSPPath() {
        const jarPath = workspace.getConfiguration("boxlang").get<string>('lspjarpath');

        return jarPath || INCLUDED_BOXLANG_LSP_PATH;
    },

    get boxlangMaxHeapSize() {
        const maxHeapSize = workspace.getConfiguration("boxlang.lsp").get<string>('maxHeapSize');
        const parsed = Number.parseInt(maxHeapSize);

        return Number.isNaN(parsed) || parsed == 0 ? 512 : parsed;
    },

    get boxlangLSPJVMArgs() {
        return workspace.getConfiguration("boxlang.lsp").get<string>('jvmArgs');
    },

    get boxlangServerPort() {
        return Number.parseInt(workspace.getConfiguration("boxlang").get<string>('webPort')) || 8080;
    },

    get showImplicitFunctions() {
        return workspace.getConfiguration("boxlang.cfml.outline").get<boolean>("showImplicitFunctions", true);
    }
}