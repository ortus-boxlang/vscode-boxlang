import path from "path";
import { workspace } from "vscode";

export const INCLUDED_BOXLANG_JAR_PATH = path.resolve(__dirname, path.join("../../", "resources", "lib", "boxlang-1.0.0-all.jar"));

export const ExtensionConfig = {
    get customAntlrToolsCommand() {
        return workspace.getConfiguration("cfml.boxlang").get<string>('customAntlrToolsCommand');
    },

    get boxlangJarPath() {
        const jarPath = workspace.getConfiguration("cfml.boxlang").get<string>('jarpath');

        return jarPath || INCLUDED_BOXLANG_JAR_PATH;
    },

    get boxlangServerPort() {
        return Number.parseInt(workspace.getConfiguration("cfml.boxlang").get<string>('webPort')) || 8080;
    }
}