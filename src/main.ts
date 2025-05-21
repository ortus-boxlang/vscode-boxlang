import * as fs from "fs";
import * as micromatch from "micromatch";
import * as path from "path";
import {
    ConfigurationChangeEvent, ConfigurationTarget, DocumentSelector, ExtensionContext,
    FileSystemWatcher, IndentAction,
    TextDocument,
    Uri,
    WorkspaceConfiguration,
    commands,
    debug,
    extensions,
    languages,
    tasks,
    window,
    workspace
} from "vscode";
import { setExtensionContext } from "./context";
import { BoxLangDebugAdapter } from "./debug/BoxlangDebugDescriptor";
import { COMPONENT_FILE_GLOB } from "./entities/component";
import { Scope } from "./entities/scope";
import { decreasingIndentingTags, goToMatchingTag, nonClosingTags, nonIndentingTags } from "./entities/tag";
import { Variable, parseVariableAssignments } from "./entities/variable";
import { insertAutoCloseTag } from "./features/autoclose";
import * as cachedEntity from "./features/cachedEntities";
import CFMLDocumentColorProvider from "./features/colorProvider";
import { foldAllFunctions, refreshGlobalDefinitionCache, refreshWorkspaceDefinitionCache, showApplicationDocument } from "./features/commands";
import { CommentType, toggleComment } from "./features/comment";
import CFMLCompletionItemProvider from "./features/completionItemProvider";
import CFMLDefinitionProvider from "./features/definitionProvider";
import DocBlockCompletions from "./features/docBlocker/docCompletionProvider";
import CFMLDocumentLinkProvider from "./features/documentLinkProvider";
import CFMLDocumentSymbolProvider from "./features/documentSymbolProvider";
import CFMLHoverProvider from "./features/hoverProvider";
import CFMLSignatureHelpProvider from "./features/signatureHelpProvider";
import CFMLTypeDefinitionProvider from "./features/typeDefinitionProvider";
import CFMLWorkspaceSymbolProvider from "./features/workspaceSymbolProvider";
import { boxlangOutputChannel } from "./utils/OutputChannels";
import CFDocsService from "./utils/cfdocs/cfDocsService";
import { APPLICATION_CFM_GLOB, isCfcFile } from "./utils/contextUtil";
import { DocumentStateContext, getDocumentStateContext } from "./utils/documentUtil";


import {
    LanguageClient
} from 'vscode-languageclient/node';
import { setupChatIntegration } from "./chat/tools";
import * as extensionCommands from "./commands";
import { BoxLangDebugAdapterTrackerFactory } from "./debug/BoxLangDebugAdapterTracker";
import { registerStatusBar } from "./features/statusBar";
import { migrateSettings } from "./settingMigration";
import { BoxLangTaskProvider } from "./tasks/BoxLangTaskProvider";
import { setupVSCodeBoxLangHome } from "./utils/BoxLang";
import { setupConfiguration } from "./utils/Configuration";
import { setupLocalJavaInstall } from "./utils/Java";
import * as LSP from "./utils/LanguageServer";
import { cleanupTrackedProcesses } from "./utils/ProcessTracker";
import { setupServers } from "./utils/Server";
import { setupVersionManagement } from "./utils/versionManager";
import { setupWorkspace } from "./utils/workspaceSetup";
import { boxlangServerHomeTreeDataProvider } from "./views/ServerHomesView";
import { boxlangServerTreeDataProvider } from "./views/ServerView";

export const CFML_LANGUAGE_ID: string = "cfml";
export const BL_LANGUAGE_ID: string = "boxlang";


const DOCUMENT_SELECTOR: DocumentSelector = [
    {
        language: CFML_LANGUAGE_ID,
        scheme: "file"
    },
    {
        language: CFML_LANGUAGE_ID,
        scheme: "untitled"
    },
    {
        language: BL_LANGUAGE_ID,
        scheme: "file"
    },
    {
        language: BL_LANGUAGE_ID,
        scheme: "untitled"
    }
];
const CF_DOCUMENT_SELECTOR: DocumentSelector = [
    {
        language: CFML_LANGUAGE_ID,
        scheme: "file"
    },
    {
        language: CFML_LANGUAGE_ID,
        scheme: "untitled"
    }
];
// we may need this in order to specifically taret BoxLang files for different features
// const BX_DOCUMENT_SELECTOR: DocumentSelector = [
//     {
//         language: BL_LANGUAGE_ID,
//         scheme: "file"
//     },
//     {
//         language: BL_LANGUAGE_ID,
//         scheme: "untitled"
//     }
// ];

export let extensionContext: ExtensionContext;

let client: LanguageClient;

/**
 * Gets a ConfigurationTarget enumerable based on a string representation
 * @param target A string representing a configuration target
 */
export function getConfigurationTarget(target: string): ConfigurationTarget {
    let configTarget: ConfigurationTarget;
    switch (target) {
        case "Global":
            configTarget = ConfigurationTarget.Global;
            break;
        case "Workspace":
            configTarget = ConfigurationTarget.Workspace;
            break;
        case "WorkspaceFolder":
            configTarget = ConfigurationTarget.WorkspaceFolder;
            break;
        default:
            configTarget = ConfigurationTarget.Global;
    }

    return configTarget;
}

/**
 * Checks whether the given document should be excluded from being used.
 * @param documentUri The URI of the document to check against
 */
function shouldExcludeDocument(documentUri: Uri): boolean {
    const fileSettings: WorkspaceConfiguration = workspace.getConfiguration("files", documentUri);

    const fileExcludes: {} = fileSettings.get<{}>("exclude", []);
    let fileExcludeGlobs: string[] = [];
    for (let fileExcludeGlob in fileExcludes) {
        if (fileExcludes[fileExcludeGlob]) {
            if (fileExcludeGlob.endsWith("/")) {
                fileExcludeGlob += "**";
            }
            fileExcludeGlobs.push(fileExcludeGlob);
        }
    }

    const relativePath = workspace.asRelativePath(documentUri);

    return micromatch.some(relativePath, fileExcludeGlobs);
}



/**
 * This method is called when the extension is activated.
 * @param context The context object for this extension.
 */
export function activate(context: ExtensionContext): void {
    extensionContext = context;

    setExtensionContext( context );
    runSetup( context );
    setupChatIntegration( context );

    languages.setLanguageConfiguration(CFML_LANGUAGE_ID, {
        indentationRules: {
            increaseIndentPattern: new RegExp(`<(?!\\?|(?:${nonIndentingTags.join("|")})\\b|[^>]*\\/>)([-_.A-Za-z0-9]+)(?=\\s|>)\\b[^>]*>(?!.*<\\/\\1>)|<!--(?!.*-->)|\\{[^}\"']*$`, "i"),
            decreaseIndentPattern: new RegExp(`^\\s*(<\\/[-_.A-Za-z0-9]+\\b[^>]*>|-?-->|\\}|<(${decreasingIndentingTags.join("|")})\\b[^>]*>)`, "i")
        },
        onEnterRules: [
            {
                // e.g. /** | */
                beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
                afterText: /^\s*\*\/$/,
                action: { indentAction: IndentAction.IndentOutdent, appendText: " * " }
            },
            {
                // e.g. /** ...|
                beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
                action: { indentAction: IndentAction.None, appendText: " * " }
            },
            {
                // e.g.  * ...|
                beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
                action: { indentAction: IndentAction.None, appendText: "* " }
            },
            {
                // e.g.  */|
                beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
                action: { indentAction: IndentAction.None, removeText: 1 }
            },
            {
                // e.g. <cfloop> | </cfloop>
                beforeText: new RegExp(`<(?!(?:${nonIndentingTags.join("|")})\\b)([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, "i"),
                afterText: new RegExp(`^(<\\/([_:\\w][_:\\w-.\\d]*)\\s*>|<(?:${decreasingIndentingTags.join("|")})\\b)`, "i"),
                action: { indentAction: IndentAction.IndentOutdent }
            }
        ]
    });

    languages.setLanguageConfiguration(BL_LANGUAGE_ID, {
        indentationRules: {
            increaseIndentPattern: new RegExp(`<(?!\\?|(?:${nonIndentingTags.join("|")})\\b|[^>]*\\/>)([-_.A-Za-z0-9]+)(?=\\s|>)\\b[^>]*>(?!.*<\\/\\1>)|<!--(?!.*-->)|\\{[^}\"']*$`, "i"),
            decreaseIndentPattern: new RegExp(`^\\s*(<\\/[-_.A-Za-z0-9]+\\b[^>]*>|-?-->|\\}|<(${decreasingIndentingTags.join("|")})\\b[^>]*>)`, "i")
        },
        onEnterRules: [
            {
                // e.g. /** | */
                beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
                afterText: /^\s*\*\/$/,
                action: { indentAction: IndentAction.IndentOutdent, appendText: " * " }
            },
            {
                // e.g. /** ...|
                beforeText: /^\s*\/\*\*(?!\/)([^\*]|\*(?!\/))*$/,
                action: { indentAction: IndentAction.None, appendText: " * " }
            },
            {
                // e.g.  * ...|
                beforeText: /^(\t|(\ \ ))*\ \*(\ ([^\*]|\*(?!\/))*)?$/,
                action: { indentAction: IndentAction.None, appendText: "* " }
            },
            {
                // e.g.  */|
                beforeText: /^(\t|(\ \ ))*\ \*\/\s*$/,
                action: { indentAction: IndentAction.None, removeText: 1 }
            },
            {
                // e.g. <cfloop> | </cfloop>
                beforeText: new RegExp(`<(?!(?:${nonIndentingTags.join("|")})\\b)([_:\\w][_:\\w-.\\d]*)([^/>]*(?!/)>)[^<]*$`, "i"),
                afterText: new RegExp(`^(<\\/([_:\\w][_:\\w-.\\d]*)\\s*>|<(?:${decreasingIndentingTags.join("|")})\\b)`, "i"),
                action: { indentAction: IndentAction.IndentOutdent }
            }
        ]
    });

    context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory("boxlang", new BoxLangDebugAdapter()));
    context.subscriptions.push(debug.registerDebugAdapterTrackerFactory("boxlang", new BoxLangDebugAdapterTrackerFactory()));

    const applyContext = (fn) => {
        return function () {
            return fn(context, ...arguments);
        }
    };

    tasks.registerTaskProvider("boxlang", BoxLangTaskProvider );

    context.subscriptions.push(commands.registerCommand("boxlang.showStatusBarCommandPicker", applyContext(extensionCommands.showStatusBarCommandPicker)));
    context.subscriptions.push(commands.registerCommand("boxlang.runBoxLangREPL", applyContext(extensionCommands.runBoxLangREPL)));
    context.subscriptions.push(commands.registerCommand("boxlang.hardResetWorkspaceHome", applyContext(extensionCommands.hardResetWorkspaceHome)));
    context.subscriptions.push(commands.registerCommand("boxlang.restartLSP", applyContext(extensionCommands.restartLSP)));
    context.subscriptions.push(commands.registerCommand("boxlang.selectBoxLangVersion", applyContext(extensionCommands.selectBoxLangVersion)));
    context.subscriptions.push(commands.registerCommand("boxlang.installBoxLangVersion", applyContext(extensionCommands.installBoxLangVersion)));
    context.subscriptions.push(commands.registerCommand("boxlang.removeBoxLangVersion", applyContext(extensionCommands.removeBoxLangVersion)));
    context.subscriptions.push(commands.registerCommand("boxlang.addBoxLangHome", extensionCommands.addBoxLangHome));
    context.subscriptions.push(commands.registerCommand("boxlang.removeBoxLangHome", extensionCommands.removeBoxLangHome));
    context.subscriptions.push(commands.registerCommand("boxlang.downloadJava", applyContext(extensionCommands.downloadJava)));
    context.subscriptions.push(commands.registerCommand("boxlang.migrateVSCodeSettings", extensionCommands.migrateVSCodeSettings));
    context.subscriptions.push(commands.registerCommand("boxlang.clearClassFiles", extensionCommands.clearClassFiles));
    context.subscriptions.push(commands.registerCommand("boxlang.openBoxLangConfigFile", extensionCommands.openBoxLangConfigFile));
    context.subscriptions.push(commands.registerCommand("boxlang.openBoxLangHome", extensionCommands.openBoxLangHome));
    context.subscriptions.push(commands.registerCommand("boxlang.removeModule", extensionCommands.removeModule));
    context.subscriptions.push(commands.registerCommand("boxlang.installModule", extensionCommands.installModule));
    context.subscriptions.push(commands.registerCommand("boxlang.openModuleHomePage", extensionCommands.openModuleHomePage));
    context.subscriptions.push(commands.registerCommand("boxlang.openLogFile", extensionCommands.openLogFile));
    context.subscriptions.push(commands.registerCommand("boxlang.clearLogFile", extensionCommands.clearLogFile));
    context.subscriptions.push(commands.registerCommand("boxlang.addServer", extensionCommands.addServer));
    context.subscriptions.push(commands.registerCommand("boxlang.openServerInBrowser", extensionCommands.openServerInBrowser));
    context.subscriptions.push(commands.registerCommand("boxlang.stopServer", extensionCommands.stopServer));
    context.subscriptions.push(commands.registerCommand("boxlang.runConfiguredServer", extensionCommands.runConfiguredServer));
    context.subscriptions.push(commands.registerCommand("boxlang.runServerFromLocation", extensionCommands.runServerFromLocation));
    context.subscriptions.push(commands.registerCommand("boxlang.debugServer", extensionCommands.debugServer));
    context.subscriptions.push(commands.registerCommand("boxlang.deleteServer", extensionCommands.deleteServer));
    context.subscriptions.push(commands.registerCommand("boxlang.editServerProperty", extensionCommands.editServerProperty));
    context.subscriptions.push(commands.registerCommand("boxlang.runFile", applyContext(extensionCommands.runBoxLangFile)));
    context.subscriptions.push(commands.registerCommand("boxlang.runWebServer", extensionCommands.runBoxLangWebServer));
    // commenting these out as they broke sometime over the past few months
    // these should be moved into a bx-language-tools repo instead
    // context.subscriptions.push(commands.registerCommand("boxlang.transpileToJava", extensionCommands.transpileToJava));
    // context.subscriptions.push(commands.registerCommand("boxlang.showANTLRGraph", extensionCommands.showANTLRGraph));
    // context.subscriptions.push(commands.registerCommand("boxlang.showBoxLangASTGraph", extensionCommands.showBoxLangASTGraph));
    context.subscriptions.push(commands.registerCommand("boxlang.outputVersionInfo", applyContext(extensionCommands.outputVersionInfo)));
    context.subscriptions.push(commands.registerCommand("boxlang.refreshGlobalDefinitionCache", refreshGlobalDefinitionCache));
    context.subscriptions.push(commands.registerCommand("boxlang.refreshWorkspaceDefinitionCache", refreshWorkspaceDefinitionCache));
    context.subscriptions.push(commands.registerTextEditorCommand("boxlang.toggleLineComment", toggleComment(CommentType.Line)));
    context.subscriptions.push(commands.registerTextEditorCommand("boxlang.toggleBlockComment", toggleComment(CommentType.Block)));
    context.subscriptions.push(commands.registerTextEditorCommand("boxlang.openActiveApplicationFile", showApplicationDocument));
    context.subscriptions.push(commands.registerTextEditorCommand("boxlang.goToMatchingTag", goToMatchingTag));
    context.subscriptions.push(commands.registerTextEditorCommand("boxlang.openCfDocs", CFDocsService.openCfDocsForCurrentWord));
    context.subscriptions.push(commands.registerTextEditorCommand("boxlang.openEngineDocs", CFDocsService.openEngineDocsForCurrentWord));
    context.subscriptions.push(commands.registerTextEditorCommand("boxlang.foldAllFunctions", foldAllFunctions));


    context.subscriptions.push(languages.registerHoverProvider(DOCUMENT_SELECTOR, new CFMLHoverProvider()));
    context.subscriptions.push(languages.registerDocumentSymbolProvider(DOCUMENT_SELECTOR, new CFMLDocumentSymbolProvider()));
    context.subscriptions.push(languages.registerSignatureHelpProvider(DOCUMENT_SELECTOR, new CFMLSignatureHelpProvider(), "(", ","));
    context.subscriptions.push(languages.registerDocumentLinkProvider(DOCUMENT_SELECTOR, new CFMLDocumentLinkProvider() as any));
    context.subscriptions.push(languages.registerWorkspaceSymbolProvider(new CFMLWorkspaceSymbolProvider() as any));
    context.subscriptions.push(languages.registerCompletionItemProvider(CF_DOCUMENT_SELECTOR, new CFMLCompletionItemProvider(), "."));
    context.subscriptions.push(languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, new DocBlockCompletions(), "*", "@", "."));
    context.subscriptions.push(languages.registerDefinitionProvider(DOCUMENT_SELECTOR, new CFMLDefinitionProvider()));
    context.subscriptions.push(languages.registerTypeDefinitionProvider(DOCUMENT_SELECTOR, new CFMLTypeDefinitionProvider()));
    context.subscriptions.push(languages.registerColorProvider(DOCUMENT_SELECTOR, new CFMLDocumentColorProvider()));

    context.subscriptions.push(workspace.onDidSaveTextDocument((document: TextDocument) => {
        const documentUri = document.uri;

        if (shouldExcludeDocument(documentUri)) {
            return;
        }

        if (isCfcFile(document)) {
            const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.suggest", document.uri);
            const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);
            cachedEntity.cacheComponentFromDocument(document, false, replaceComments);
        } else if (path.basename(document.fileName) === "Application.cfm") {
            const documentStateContext: DocumentStateContext = getDocumentStateContext(document, false, true);
            const thisApplicationVariables: Variable[] = parseVariableAssignments(documentStateContext, documentStateContext.docIsScript);
            const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
                return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
            });
            cachedEntity.setApplicationVariables(document.uri, thisApplicationFilteredVariables);
        }
    }));

    const componentWatcher: FileSystemWatcher = workspace.createFileSystemWatcher(COMPONENT_FILE_GLOB, false, true, false);
    componentWatcher.onDidCreate((componentUri: Uri) => {
        if (shouldExcludeDocument(componentUri)) {
            return;
        }

        workspace.openTextDocument(componentUri).then((document: TextDocument) => {
            const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.suggest", document.uri);
            const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);
            cachedEntity.cacheComponentFromDocument(document, false, replaceComments);
        });
    });
    componentWatcher.onDidDelete((componentUri: Uri) => {
        if (shouldExcludeDocument(componentUri)) {
            return;
        }

        cachedEntity.clearCachedComponent(componentUri);

        const fileName: string = path.basename(componentUri.fsPath);
        if (fileName === "Application.cfc") {
            cachedEntity.removeApplicationVariables(componentUri);
        }
    });
    context.subscriptions.push(componentWatcher);

    const applicationCfmWatcher: FileSystemWatcher = workspace.createFileSystemWatcher(APPLICATION_CFM_GLOB, false, true, false);
    context.subscriptions.push(applicationCfmWatcher);
    applicationCfmWatcher.onDidCreate((applicationUri: Uri) => {
        if (shouldExcludeDocument(applicationUri)) {
            return;
        }

        workspace.openTextDocument(applicationUri).then((document: TextDocument) => {
            const documentStateContext: DocumentStateContext = getDocumentStateContext(document, false, true);
            const thisApplicationVariables: Variable[] = parseVariableAssignments(documentStateContext, documentStateContext.docIsScript);
            const thisApplicationFilteredVariables: Variable[] = thisApplicationVariables.filter((variable: Variable) => {
                return [Scope.Application, Scope.Session, Scope.Request].includes(variable.scope);
            });
            cachedEntity.setApplicationVariables(applicationUri, thisApplicationFilteredVariables);
        });
    });
    applicationCfmWatcher.onDidDelete((applicationUri: Uri) => {
        if (shouldExcludeDocument(applicationUri)) {
            return;
        }

        cachedEntity.removeApplicationVariables(applicationUri);
    });

    context.subscriptions.push(workspace.onDidChangeConfiguration((evt: ConfigurationChangeEvent) => {
        if (evt.affectsConfiguration("boxlang.cfml.globalDefinitions") || evt.affectsConfiguration("boxlang.cfml.cfDocs") || evt.affectsConfiguration("boxlang.cfml.engine")) {
            commands.executeCommand("boxlang.refreshGlobalDefinitionCache");
        }
    }));

    const cfmlSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang");
    const autoCloseTagExtId = "formulahendry.auto-close-tag";
    const autoCloseTagExt = extensions.getExtension(autoCloseTagExtId);
    const enableAutoCloseTags: boolean = cfmlSettings.get<boolean>("autoCloseTags.enable", true);
    if (autoCloseTagExt) {
        const autoCloseTagsSettings: WorkspaceConfiguration = workspace.getConfiguration("auto-close-tag", null);
        const autoCloseLanguages: string[] = autoCloseTagsSettings.get<string[]>("activationOnLanguage");
        const autoCloseExcludedTags: string[] = autoCloseTagsSettings.get<string[]>("excludedTags");

        if (enableAutoCloseTags) {
            if (!autoCloseLanguages.includes(CFML_LANGUAGE_ID)) {
                autoCloseLanguages.push(CFML_LANGUAGE_ID);
                autoCloseTagsSettings.update(
                    "activationOnLanguage",
                    autoCloseLanguages,
                    getConfigurationTarget(cfmlSettings.get<string>("autoCloseTags.configurationTarget"))
                );
            }

            if (!autoCloseLanguages.includes(BL_LANGUAGE_ID)) {
                autoCloseLanguages.push(BL_LANGUAGE_ID);
                autoCloseTagsSettings.update(
                    "activationOnLanguage",
                    autoCloseLanguages,
                    getConfigurationTarget(cfmlSettings.get<string>("autoCloseTags.configurationTarget"))
                );
            }

            nonClosingTags.filter((tagName: string) => {
                // Consider ignoring case
                return !autoCloseExcludedTags.includes(tagName);
            }).forEach((tagName: string) => {
                autoCloseExcludedTags.push(tagName);
            });
            autoCloseTagsSettings.update(
                "excludedTags",
                autoCloseExcludedTags,
                getConfigurationTarget(cfmlSettings.get<string>("autoCloseTags.configurationTarget"))
            );
        } else {
            const cfIndex: number = autoCloseLanguages.indexOf(CFML_LANGUAGE_ID);
            if (cfIndex !== -1) {
                autoCloseLanguages.splice(cfIndex, 1);
                autoCloseTagsSettings.update(
                    "activationOnLanguage",
                    autoCloseLanguages,
                    getConfigurationTarget(cfmlSettings.get<string>("autoCloseTags.configurationTarget"))
                );
            }

            const blIndex: number = autoCloseLanguages.indexOf(BL_LANGUAGE_ID);
            if (blIndex !== -1) {
                autoCloseLanguages.splice(blIndex, 1);
                autoCloseTagsSettings.update(
                    "activationOnLanguage",
                    autoCloseLanguages,
                    getConfigurationTarget(cfmlSettings.get<string>("autoCloseTags.configurationTarget"))
                );
            }
        }
    } else if (enableAutoCloseTags) {
        workspace.onDidChangeTextDocument(event => {
            insertAutoCloseTag(event);
        });
    }

    commands.executeCommand("boxlang.refreshGlobalDefinitionCache");
    commands.executeCommand("boxlang.refreshWorkspaceDefinitionCache");

    context.subscriptions.push(workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
        if (e.affectsConfiguration("boxlang.lsp")) {
            client.sendRequest("boxlang/changesettings", workspace.getConfiguration("boxlang.lsp"));
        }
    }));

    context.subscriptions.push(workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
        if (e.affectsConfiguration("boxlang.java.javaHome")) {
            boxlangOutputChannel.appendLine("Switching to new JVM: " + workspace.getConfiguration("boxlang.java").get("javaHome"));
            restartAllProcesses();
        }

        if (e.affectsConfiguration("boxlang.lsp.maxHeapSize")) {
            boxlangOutputChannel.appendLine("Detected a change in LSP maxHeapSize configuration: " + workspace.getConfiguration("boxlang.lsp").get("maxHeapSize"));
            restartAllProcesses();
        }

        if (e.affectsConfiguration("boxlang.boxLangHome")) {
            boxlangOutputChannel.appendLine("Switching to new BoxLang Home: " + workspace.getConfiguration("boxlang.boxLangHome").get("boxLangHome"));
            restartAllProcesses();
        }
    }));

    window.registerTreeDataProvider("boxlang-servers", boxlangServerTreeDataProvider());
    window.registerTreeDataProvider("boxlang-server-homes", boxlangServerHomeTreeDataProvider(context));
}


/**
 * This method is called when the extension is deactivated.
 */
export function deactivate(): void {
    LSP.stop();

    cleanupTrackedProcesses();
}

export function restartAllProcesses( refreshWorkspace = false) {
    deactivate();

    if( refreshWorkspace ){
        setupWorkspace( extensionContext );
    }

    setTimeout(() => {
        LSP.startLSP();
    }, 5000);
}

async function runSetup( context: ExtensionContext ){

    registerStatusBar( context );

    if (!fs.existsSync(context.globalStorageUri.fsPath)) {
        fs.mkdirSync(context.globalStorageUri.fsPath);
    }

    if (!fs.existsSync(context.globalStorageUri.fsPath)) {
        fs.mkdirSync(path.join( context.globalStorageUri.fsPath, "globalModules" ));
    }

    await setupLocalJavaInstall( context );
    await setupWorkspace( context );
    setupConfiguration(context);
    setupVSCodeBoxLangHome(context);
    setupVersionManagement(context);
    migrateSettings(false);

    LSP.startLSP()

    try {
        setupServers(context);
    }
    catch (e) {
        boxlangOutputChannel.appendLine("Error setting up BoxLang servers");
        boxlangOutputChannel.appendLine(e.message);
    }
}

