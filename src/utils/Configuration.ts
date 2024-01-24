import { workspace } from "vscode";

export const ExtensionConfig = {
    get customAntlrToolsCommand() {
        return workspace.getConfiguration("cfml.boxlang").get<string>('customAntlrToolsCommand');
    }
}