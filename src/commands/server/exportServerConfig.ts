import * as path from "path";
import * as vscode from "vscode";
import { exportServerConfig as _exportServerConfig, getServerData } from "../../utils/Server";

export async function exportServerConfig({ key }) {
    const server = getServerData(key);

    if (!server) {
        return;
    }

    const safeName = server.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
    const fileName = safeName.toLowerCase() === "miniserver" ? "miniserver.json" : `${safeName}.miniserver.json`;
    const target = await vscode.window.showSaveDialog({
        title: `Export ${server.name} to a MiniServer configuration file`,
        defaultUri: vscode.Uri.file(path.join(server.directoryAbsolute, fileName)),
        filters: { "MiniServer Configuration": ["json"] }
    });

    if (!target) {
        return;
    }

    // Only files matching the watched glob inside the workspace get loaded back
    const baseName = path.basename(target.fsPath);
    if (baseName !== "miniserver.json" && !baseName.endsWith(".miniserver.json")) {
        vscode.window.showErrorMessage("MiniServer configuration files must be named miniserver.json or <name>.miniserver.json.");
        return;
    }

    if (!vscode.workspace.getWorkspaceFolder(target)) {
        vscode.window.showErrorMessage("MiniServer configuration files must be saved inside the workspace.");
        return;
    }

    _exportServerConfig(server.name, target.fsPath);
    await vscode.window.showTextDocument(target);
}
