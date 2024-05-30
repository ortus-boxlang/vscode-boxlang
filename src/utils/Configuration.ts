import path from "path";
import { workspace } from "vscode";

export const INCLUDED_BOXLANG_JAR_PATH = path.resolve(__dirname, path.join("../../", "resources", "lib", "boxlang-1.0.0-all.jar"));
export const INCLUDED_BOXLANG_MINISERVER_JAR_PATH = path.resolve(__dirname, path.join("../../", "resources", "lib", "boxlang-miniserver-1.0.0-all.jar"));
export const INCLUDED_BOXLANG_LSP_PATH = path.resolve(__dirname, path.join("../../", "resources", "lib", "boxlang-lsp-0.0.1-all.jar"));

export const ExtensionConfig = {
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

    get boxlangServerPort() {
        return Number.parseInt(workspace.getConfiguration("cfml.boxlang").get<string>('webPort')) || 8080;
    }
}