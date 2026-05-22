import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { ExecuteCommandRequest } from "vscode-languageclient/node";
import { getLanguageClient, supportsServerCommand } from "../../utils/LanguageServer";

const CREATE_BXLINT_CONFIG_COMMAND = "boxlang.createBxlintConfig";
const CREATE_FORMATTER_CONFIG_COMMAND = "boxlang.createFormatterConfig";
const CONVERT_CFFORMAT_CONFIG_COMMAND = "boxlang.convertCFFormatConfig";
const CFFORMAT_CONFIG_FILE_NAME = ".cfformat.json";
const CFCONFIG_FILE_NAME = ".cfconfig.json";

type CreateConfigCommandOptions = {
    commandId: string;
    fileName: string;
    workspaceTitle: string;
    unavailableMessage?: string;
    missingSourceFiles?: string[];
    missingSourceMessage?: string;
    actionLabel?: string;
};

type CreateConfigCommandArguments = {
    workspaceUri: string;
    overwrite: boolean;
    openDocument: boolean;
};

type WorkspaceFolderQuickPickItem = vscode.QuickPickItem & {
    folder: vscode.WorkspaceFolder;
};

export async function createBxlintConfig() {
    await createConfigFile({
        commandId: CREATE_BXLINT_CONFIG_COMMAND,
        fileName: ".bxlint.json",
        workspaceTitle: "Select a workspace folder for .bxlint.json"
    });
}

export async function createFormatterConfig() {
    if (!supportsServerCommand(CREATE_FORMATTER_CONFIG_COMMAND)) {
        vscode.window.showErrorMessage(
            "BoxLang: Formatter config creation is unavailable because the current language server does not advertise it."
        );
        return;
    }

    await createConfigFile({
        commandId: CREATE_FORMATTER_CONFIG_COMMAND,
        fileName: ".bxformat.json",
        workspaceTitle: "Select a workspace folder for .bxformat.json",
        unavailableMessage: "BoxLang: Formatter config creation is unavailable because the current language server does not advertise it."
    });
}

export async function convertCFFormatConfig() {
    await createConfigFile({
        commandId: CONVERT_CFFORMAT_CONFIG_COMMAND,
        fileName: ".bxformat.json",
        workspaceTitle: "Select a workspace folder to convert a CFFormat config",
        unavailableMessage: "BoxLang: CFFormat conversion is unavailable because the current language server does not advertise it.",
        missingSourceFiles: [CFFORMAT_CONFIG_FILE_NAME, CFCONFIG_FILE_NAME],
        missingSourceMessage: "BoxLang: No .cfformat.json or .cfconfig.json was found in the selected workspace folder.",
        actionLabel: "convert"
    });
}

async function createConfigFile(options: CreateConfigCommandOptions) {
    if (options.unavailableMessage && !supportsServerCommand(options.commandId)) {
        vscode.window.showErrorMessage(options.unavailableMessage);
        return;
    }

    const client = getLanguageClient();

    if (!client) {
        vscode.window.showErrorMessage("BoxLang: The language server is not running.");
        return;
    }

    const workspaceFolder = await pickTargetWorkspaceFolder(options.workspaceTitle);

    if (!workspaceFolder) {
        return;
    }

    if (options.missingSourceFiles?.length) {
        const hasSourceConfig = await workspaceHasAnyFile(workspaceFolder, options.missingSourceFiles);

        if (!hasSourceConfig) {
            vscode.window.showWarningMessage(
                options.missingSourceMessage
                ?? "BoxLang: No supported source config file was found in the selected workspace folder."
            );
            return;
        }
    }

    const configUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, options.fileName));
    const overwrite = await resolveOverwrite(configUri, workspaceFolder, options.fileName);

    if (overwrite == null) {
        return;
    }

    const argumentsPayload: CreateConfigCommandArguments = {
        workspaceUri: workspaceFolder.uri.toString(),
        overwrite,
        openDocument: true
    };

    try {
        await client.sendRequest(ExecuteCommandRequest.type, {
            command: options.commandId,
            arguments: [argumentsPayload]
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const actionLabel = options.actionLabel ?? "create";
        vscode.window.showErrorMessage(`BoxLang: Unable to ${actionLabel} ${options.fileName}. ${message}`);
    }
}

async function pickTargetWorkspaceFolder(title: string): Promise<vscode.WorkspaceFolder | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

    if (workspaceFolders.length === 0) {
        vscode.window.showWarningMessage("BoxLang: Open a workspace folder to create a config file.");
        return undefined;
    }

    if (workspaceFolders.length === 1) {
        return workspaceFolders[0];
    }

    const quickPickItems: WorkspaceFolderQuickPickItem[] = workspaceFolders.map(folder => ({
        label: folder.name,
        description: folder.uri.fsPath,
        folder
    }));

    const selectedFolder = await vscode.window.showQuickPick(
        quickPickItems,
        { placeHolder: title }
    );

    return selectedFolder?.folder;
}

async function resolveOverwrite(
    configUri: vscode.Uri,
    workspaceFolder: vscode.WorkspaceFolder,
    fileName: string
): Promise<boolean | null> {
    if (!(await fileExists(configUri))) {
        return false;
    }

    const overwriteChoice = await vscode.window.showWarningMessage(
        `BoxLang: ${fileName} already exists in ${workspaceFolder.name}. Overwrite it?`,
        { modal: true },
        "Overwrite"
    );

    if (overwriteChoice !== "Overwrite") {
        return null;
    }

    return true;
}

async function fileExists(uri: vscode.Uri) {
    try {
        await fs.access(uri.fsPath);
        return true;
    } catch {
        return false;
    }
}

async function workspaceHasAnyFile(workspaceFolder: vscode.WorkspaceFolder, fileNames: string[]) {
    for (const fileName of fileNames) {
        const fileUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, fileName));

        if (await fileExists(fileUri)) {
            return true;
        }
    }

    return false;
}