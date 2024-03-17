import * as micromatch from "micromatch";
import * as path from "path";
import {
    ConfigurationChangeEvent, ConfigurationTarget, DocumentSelector, ExtensionContext,
    FileSystemWatcher, IndentAction,
    TextDocument, Uri,
    WorkspaceConfiguration,
    commands,
    debug,
    extensions,
    languages,
    workspace
} from "vscode";
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
import CFDocsService from "./utils/cfdocs/cfDocsService";
import { APPLICATION_CFM_GLOB, isCfcFile } from "./utils/contextUtil";
import { DocumentStateContext, getDocumentStateContext } from "./utils/documentUtil";

import * as extensionCommands from "./commands";
import { BoxLangDebugAdapterTrackerFactory } from "./debug/BoxLangDebugAdapterTracker";

export const LANGUAGE_ID: string = "cfml";
const DOCUMENT_SELECTOR: DocumentSelector = [
    {
        language: LANGUAGE_ID,
        scheme: "file"
    },
    {
        language: LANGUAGE_ID,
        scheme: "untitled"
    }
];

export let extensionContext: ExtensionContext;

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

    languages.setLanguageConfiguration(LANGUAGE_ID, {
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


    context.subscriptions.push(commands.registerCommand("boxlang.runFile", extensionCommands.runBoxLangFile));
    context.subscriptions.push(commands.registerCommand("boxlang.runWebServer", extensionCommands.runBoxLangWebServer));
    context.subscriptions.push(commands.registerCommand("boxlang.transpileToJava", extensionCommands.transpileToJava));
    context.subscriptions.push(commands.registerCommand("boxlang.showANTLRGraph", extensionCommands.showANTLRGraph));
    context.subscriptions.push(commands.registerCommand("boxlang.showBoxLangASTGraph", extensionCommands.showBoxLangASTGraph));
    context.subscriptions.push(commands.registerCommand("cfml.refreshGlobalDefinitionCache", refreshGlobalDefinitionCache));
    context.subscriptions.push(commands.registerCommand("cfml.refreshWorkspaceDefinitionCache", refreshWorkspaceDefinitionCache));
    context.subscriptions.push(commands.registerTextEditorCommand("cfml.toggleLineComment", toggleComment(CommentType.Line)));
    context.subscriptions.push(commands.registerTextEditorCommand("cfml.toggleBlockComment", toggleComment(CommentType.Block)));
    context.subscriptions.push(commands.registerTextEditorCommand("cfml.openActiveApplicationFile", showApplicationDocument));
    context.subscriptions.push(commands.registerTextEditorCommand("cfml.goToMatchingTag", goToMatchingTag));
    context.subscriptions.push(commands.registerTextEditorCommand("cfml.openCfDocs", CFDocsService.openCfDocsForCurrentWord));
    context.subscriptions.push(commands.registerTextEditorCommand("cfml.openEngineDocs", CFDocsService.openEngineDocsForCurrentWord));
    context.subscriptions.push(commands.registerTextEditorCommand("cfml.foldAllFunctions", foldAllFunctions));


    context.subscriptions.push(languages.registerHoverProvider(DOCUMENT_SELECTOR, new CFMLHoverProvider()));
    context.subscriptions.push(languages.registerDocumentSymbolProvider(DOCUMENT_SELECTOR, new CFMLDocumentSymbolProvider()));
    context.subscriptions.push(languages.registerSignatureHelpProvider(DOCUMENT_SELECTOR, new CFMLSignatureHelpProvider(), "(", ","));
    context.subscriptions.push(languages.registerDocumentLinkProvider(DOCUMENT_SELECTOR, new CFMLDocumentLinkProvider()));
    context.subscriptions.push(languages.registerWorkspaceSymbolProvider(new CFMLWorkspaceSymbolProvider()));
    context.subscriptions.push(languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, new CFMLCompletionItemProvider(), "."));
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
            const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
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
            const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
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
        if (evt.affectsConfiguration("cfml.globalDefinitions") || evt.affectsConfiguration("cfml.cfDocs") || evt.affectsConfiguration("cfml.engine")) {
            commands.executeCommand("cfml.refreshGlobalDefinitionCache");
        }
    }));

    const cfmlSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml");
    const autoCloseTagExtId = "formulahendry.auto-close-tag";
    const autoCloseTagExt = extensions.getExtension(autoCloseTagExtId);
    const enableAutoCloseTags: boolean = cfmlSettings.get<boolean>("autoCloseTags.enable", true);
    if (autoCloseTagExt) {
        const autoCloseTagsSettings: WorkspaceConfiguration = workspace.getConfiguration("auto-close-tag", null);
        const autoCloseLanguages: string[] = autoCloseTagsSettings.get<string[]>("activationOnLanguage");
        const autoCloseExcludedTags: string[] = autoCloseTagsSettings.get<string[]>("excludedTags");

        if (enableAutoCloseTags) {
            if (!autoCloseLanguages.includes(LANGUAGE_ID)) {
                autoCloseLanguages.push(LANGUAGE_ID);
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
            const index: number = autoCloseLanguages.indexOf(LANGUAGE_ID);
            if (index !== -1) {
                autoCloseLanguages.splice(index, 1);
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

    commands.executeCommand("cfml.refreshGlobalDefinitionCache");
    commands.executeCommand("cfml.refreshWorkspaceDefinitionCache");
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate(): void {
}
