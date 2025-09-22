import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { workspace } from "vscode";
import { boxlangOutputChannel } from "./OutputChannels";

/**
 * Checks if a .bvmrc file exists in the workspace root and returns the BoxLang version specified
 * @param workspaceFolder The workspace folder to check for .bvmrc
 * @returns Promise<string | null> The version string if found, null otherwise
 */
export async function getBvmrcVersion(workspaceFolder?: vscode.WorkspaceFolder): Promise<string | null> {
    try {
        // If no workspace folder provided, use the first one
        if (!workspaceFolder && workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
            workspaceFolder = workspace.workspaceFolders[0];
        }

        if (!workspaceFolder) {
            return null;
        }

        const bvmrcPath = path.join(workspaceFolder.uri.fsPath, ".bvmrc");
        
        try {
            await fs.access(bvmrcPath);
        } catch (e) {
            // .bvmrc file doesn't exist
            return null;
        }

        const content = await fs.readFile(bvmrcPath, "utf-8");
        const version = content.trim();

        if (!version) {
            boxlangOutputChannel.appendLine("Warning: .bvmrc file exists but is empty");
            return null;
        }

        // Validate version format (basic validation)
        if (version === "latest" || /^\d+(\.\d+)*$/.test(version)) {
            boxlangOutputChannel.appendLine(`Found .bvmrc with BoxLang version: ${version}`);
            return version;
        } else {
            boxlangOutputChannel.appendLine(`Warning: Invalid version format in .bvmrc: ${version}`);
            return null;
        }
    } catch (error) {
        boxlangOutputChannel.appendLine(`Error reading .bvmrc: ${error.toString()}`);
        return null;
    }
}

/**
 * Checks all workspace folders for .bvmrc files and returns the first valid version found
 * @returns Promise<string | null> The first valid version found, null if none
 */
export async function getWorkspaceBvmrcVersion(): Promise<string | null> {
    if (!workspace.workspaceFolders) {
        return null;
    }

    for (const workspaceFolder of workspace.workspaceFolders) {
        const version = await getBvmrcVersion(workspaceFolder);
        if (version) {
            return version;
        }
    }

    return null;
}