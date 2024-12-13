import path from "path";
import { ConfigurationTarget, workspace } from "vscode";

export const INCLUDED_BOXLANG_JAR_PATH = path.resolve(__dirname, path.join("../../", "resources", "lib", "boxlang.jar"));
export const INCLUDED_BOXLANG_MINISERVER_JAR_PATH = path.resolve(__dirname, path.join("../../", "resources", "lib", "boxlang-miniserver.jar"));
export const INCLUDED_BOXLANG_LSP_PATH = path.resolve(__dirname, path.join("../../", "resources", "lib", "boxlang-lsp.jar"));

export const ExtensionConfig = {
    set ignoreOldSettings(value) {
        workspace.getConfiguration("boxlang.settings").update("ignoreOldSettings", value, ConfigurationTarget.Global);
    },

    get ignoreOldSettings() {
        return workspace.getConfiguration("boxlang.settings").get<boolean>('ignoreOldSettings');
    },

    get customAntlrToolsCommand() {
        return workspace.getConfiguration("cfml.boxlang").get<string>('customAntlrToolsCommand');
    },

    get boxlangJavaHome() {
        const javaPath = workspace.getConfiguration("boxlang.java").get<string>('javaHome');
        // figure out how to make this work!
        return javaPath ? javaPath + "/java" : "java";
    },

    get boxlangMiniServerJarPath() {
        const jarPath = workspace.getConfiguration("cfml.boxlang").get<string>('miniserverjarpath');

        return jarPath || INCLUDED_BOXLANG_MINISERVER_JAR_PATH;
    },

    get boxlangJarPath() {
        const jarPath = workspace.getConfiguration("cfml.boxlang").get<string>('jarpath');

        return jarPath || INCLUDED_BOXLANG_JAR_PATH;
    },

    get boxlangLSPPath() {
        const jarPath = workspace.getConfiguration("cfml.boxlang").get<string>('lspjarpath');

        return jarPath || INCLUDED_BOXLANG_LSP_PATH;
    },

    get boxlangMaxHeapSize() {
        const maxHeapSize = workspace.getConfiguration("boxlang.lsp").get<string>('maxHeapSize');
        const parsed = Number.parseInt(maxHeapSize);

        return Number.isNaN(parsed) || parsed == 0 ? 512 : parsed;
    },

    get boxlangServerPort() {
        return Number.parseInt(workspace.getConfiguration("cfml.boxlang").get<string>('webPort')) || 8080;
    },

    get showImplicitFunctions() {
        return workspace.getConfiguration("cfml.outline").get<boolean>("showImplicitFunctions", true);
    }
}