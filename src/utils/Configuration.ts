import path from "path";
import { ConfigurationTarget, ExtensionContext, workspace } from "vscode";

let INCLUDED_BOXLANG_JAR_PATH = "";
let INCLUDED_BOXLANG_MINISERVER_JAR_PATH = "";
let INCLUDED_BOXLANG_LSP_PATH = "";

export function setupConfiguration(context: ExtensionContext) {
    INCLUDED_BOXLANG_JAR_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang.jar");
    INCLUDED_BOXLANG_MINISERVER_JAR_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang-miniserver.jar");
    INCLUDED_BOXLANG_LSP_PATH = path.join(context.extensionPath, "resources", "lib", "boxlang-lsp.jar");
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

    set boxlangJavaHome(path: string) {
        workspace.getConfiguration("boxlang.java").update("javaHome", path, ConfigurationTarget.Global);
    },

    get boxlangJavaHome() {
        const javaPath = workspace.getConfiguration("boxlang.java").get<string>('javaHome');

        // if we don't have a path configured just use the executable directly and let the OS figure it out
        if (!javaPath) {
            return "java";
        }

        // if the user added the path with bin on the end we will only append "java"
        if (/bin$/.test(javaPath)) {
            return path.join(javaPath, "java");
        }

        return path.join(javaPath, "bin", "java");
    },

    get boxlangMiniServerJarPath() {
        const jarPath = workspace.getConfiguration("boxlang").get<string>('miniserverjarpath');

        return jarPath || INCLUDED_BOXLANG_MINISERVER_JAR_PATH;
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

    get boxlangServerPort() {
        return Number.parseInt(workspace.getConfiguration("boxlang").get<string>('webPort')) || 8080;
    },

    get showImplicitFunctions() {
        return workspace.getConfiguration("boxlang.cfml.outline").get<boolean>("showImplicitFunctions", true);
    }
}