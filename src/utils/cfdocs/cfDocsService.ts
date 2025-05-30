import * as fs from "fs";
import fetch from 'isomorphic-fetch';
import * as path from "path";
import * as vscode from "vscode";
import { commands, Position, Range, TextDocument, TextEditor, TextLine, Uri, window, workspace, WorkspaceConfiguration } from "vscode";
import { getFunctionSuffixPattern } from "../../entities/function";
import { GlobalEntity } from "../../entities/globals";
import { getTagPrefixPattern } from "../../entities/tag";
import * as cachedEntity from "../../features/cachedEntities";
import { extensionContext } from "../../main";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../documentUtil";
import { CFMLEngine, CFMLEngineName } from "./cfmlEngine";
import { CFDocsDefinitionInfo, EngineCompatibilityDetail } from "./definitionInfo";

enum CFDocsSource {
    Remote = "remote",
    Local = "local",
    Extension = "extension"
}

export default class CFDocsService {
    private static cfDocsRepoLinkPrefix: string = "https://raw.githubusercontent.com/foundeo/cfdocs/master/data/en/";
    private static cfDocsLinkPrefix: string = "https://cfdocs.org/";

    /**
     * Gets definition information for global identifiers based on a local CFDocs directory
     * @param identifier The global identifier for which to get definition info
     */
    private static async getLocalDefinitionInfo(identifier: string): Promise<CFDocsDefinitionInfo> {
        const cfmlCfDocsSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.cfDocs");
        const cfdocsPath: string = cfmlCfDocsSettings.get("localPath");

        return new Promise<CFDocsDefinitionInfo>((resolve, reject) => {
            try {
                const docFilePath: string = path.join(cfdocsPath, CFDocsService.getJsonFileName(identifier));
                fs.readFile(docFilePath, "utf8", (err, data) => {
                    if (err) {
                        reject(err);
                    }

                    resolve(CFDocsService.constructDefinitionFromJsonDoc(data));
                });
            } catch (e) {
                console.error(`Error with the JSON doc for ${identifier}:`, (<Error>e).message);
                reject(e);
            }
        });
    }

    /**
     * Gets definition information for global identifiers based on a extension resources directory
     * @param identifier The global identifier for which to get definition info
     */
    private static async getExtensionDefinitionInfo(identifier: string): Promise<CFDocsDefinitionInfo> {

        return new Promise<CFDocsDefinitionInfo>((resolve, reject) => {
            try {
                const docFilePath: string = path.join("./resources/schemas/en/", CFDocsService.getJsonFileName(identifier));
                const pathUri: Uri = vscode.Uri.file(extensionContext.asAbsolutePath(docFilePath));
                try {
                    workspace.fs.readFile(pathUri).then((readData) => {
                        const readStr = Buffer.from(readData).toString('utf8');
                        const readJson = JSON.parse(readStr);
                        resolve(CFDocsService.constructDefinitionFromJsonDoc(readJson));
                    });
                } catch (ex) {
                    console.error(`Error with the JSON doc for ${identifier}:`, (<Error>ex).message);
                    reject(ex);
                }
            } catch (e) {
                console.error(`Error with the JSON doc for ${identifier}:`, (<Error>e).message);
                reject(e);
            }
        });
    }

    /**
     * Gets definition information for global identifiers based on a remote CFDocs repository
     * @param identifier The global identifier for which to get definition info
     */
    private static async getRemoteDefinitionInfo(identifier: string): Promise<CFDocsDefinitionInfo> {
        const cfDocsLink: string = CFDocsService.cfDocsRepoLinkPrefix + CFDocsService.getJsonFileName(identifier);

        return new Promise<CFDocsDefinitionInfo>((resolve, reject) => {
            // Unable to utilize GitHub API due to rate limiting
            fetch(cfDocsLink)
                .then((response) => response.json())
                .then((data) => {
                    try {
                        resolve(CFDocsService.constructDefinitionFromJsonDoc(data));
                    } catch (ex) {
                        console.error(`Error with the JSON doc for ${identifier}:`, (<Error>ex).message);
                        reject(ex);
                    }
                }).catch(function (fex) {
                    console.error("Error retrieving all tag names:", (<Error>fex).message);
                    reject(fex);
                });
        });
    }

    /**
     * Constructs a CFDocsDefinitionInfo object from the respective JSON string
     * @param jsonTextDoc A JSON string conforming to the CFDocs definition structure
     */
    private static constructDefinitionFromJsonDoc(jsonDoc): CFDocsDefinitionInfo {
        //const jsonDoc = JSON.parse(jsonTextDoc);

        return new CFDocsDefinitionInfo(
            jsonDoc.name, jsonDoc.type, jsonDoc.syntax, jsonDoc.member, jsonDoc.script, jsonDoc.returns,
            jsonDoc.related, jsonDoc.description, jsonDoc.discouraged, jsonDoc.params, jsonDoc.engines, jsonDoc.links, jsonDoc.examples
        );
    }

    /**
     * Generates the respective JSON file name from the global identifier
     * @param identifier The global identifier for which to the file name will be generated
     */
    private static getJsonFileName(identifier: string): string {
        return `${identifier.toLowerCase()}.json`;
    }

    /**
     * Returns a list of all global CFML functions documented on CFDocs
     * @param source Indicates whether the data will be retrieved locally or remotely
     */
    public static async getAllFunctionNames(source = CFDocsSource.Remote): Promise<string[]> {
        const jsonFileName: string = CFDocsService.getJsonFileName("functions");

        return new Promise<string[]>((resolve, reject) => {
            if (source === CFDocsSource.Local && vscode.env.appHost === "desktop") {
                const cfmlCfDocsSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.cfDocs");
                const cfdocsPath: string = cfmlCfDocsSettings.get("localPath");
                let docFilePath: string = path.join(cfdocsPath, jsonFileName);

                try {
                    fs.readFile(docFilePath, "utf8", (err, data) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(JSON.parse(data).related);
                    });
                } catch (ex) {
                    console.error("Error retrieving all function names:", (<Error>ex).message);
                    reject(ex);
                }
            } else if (source === CFDocsSource.Extension) {
                const extensionDocFilePath: string = path.join("./resources/schemas/en/", jsonFileName);
                const extensionPathUri: Uri = vscode.Uri.file(extensionContext.asAbsolutePath(extensionDocFilePath));
                try {
                    workspace.fs.readFile(extensionPathUri).then((readData) => {
                        const readStr = Buffer.from(readData).toString('utf8');
                        const readJson = JSON.parse(readStr);
                        resolve(readJson.related);
                    });
                } catch (ex) {
                    console.error("Error retrieving all function names:", (<Error>ex).message);
                    reject(ex);
                }
            } else {
                const cfDocsLink: string = CFDocsService.cfDocsRepoLinkPrefix + jsonFileName;
                fetch(cfDocsLink)
                    .then((response) => response.json())
                    .then((data) => {
                        try {
                            resolve(data.related);
                        } catch (ex) {
                            console.error("Error retrieving all function names:", (<Error>ex).message);
                            reject(ex);
                        }
                    }).catch(function (fex) {
                        console.error("Error retrieving all function names:", (<Error>fex).message);
                        reject(fex);
                    });
            }
        });
    }

    /**
     * Returns a list of all global CFML tags documented on CFDocs
     * @param source Indicates whether the data will be retrieved locally or remotely
     */
    public static async getAllTagNames(source = CFDocsSource.Remote): Promise<string[]> {
        const jsonFileName: string = CFDocsService.getJsonFileName("tags");

        return new Promise<string[]>((resolve, reject) => {
            if (source === CFDocsSource.Local && vscode.env.appHost === "desktop") {
                const cfmlCfDocsSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.cfDocs");
                const cfdocsPath: string = cfmlCfDocsSettings.get("localPath");
                let docFilePath: string = path.join(cfdocsPath, jsonFileName);

                try {
                    fs.readFile(docFilePath, "utf8", (err, data) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(JSON.parse(data).related);
                    });
                } catch (ex) {
                    console.error("Error retrieving all tag names:", (<Error>ex).message);
                    reject(ex);
                }
            } else if (source === CFDocsSource.Extension) {
                const extensionDocFilePath: string = path.join("./resources/schemas/en/", jsonFileName);
                const extensionPathUri: Uri = vscode.Uri.file(extensionContext.asAbsolutePath(extensionDocFilePath));
                try {
                    workspace.fs.readFile(extensionPathUri).then((readData) => {
                        const readStr = Buffer.from(readData).toString('utf8');
                        const readJson = JSON.parse(readStr);
                        resolve(readJson.related);
                    });
                } catch (ex) {
                    console.error("Error retrieving all tag names:", (<Error>ex).message);
                    reject(ex);
                }
            } else {
                const cfDocsLink: string = CFDocsService.cfDocsRepoLinkPrefix + jsonFileName;

                fetch(cfDocsLink)
                    .then((response) => response.json())
                    .then((data) => {
                        try {
                            resolve(data.related);
                        } catch (ex) {
                            console.error("Error retrieving all tag names:", (<Error>ex).message);
                            reject(ex);
                        }
                    }).catch(function (fex) {
                        console.error("Error retrieving all tag names:", (<Error>fex).message);
                        reject(fex);
                    });
            }

        });
    }

    /**
     * Sets the given definition as a global function in the cached entities
     * @param definition The definition object to cache
     */
    public static setGlobalFunction(definition: CFDocsDefinitionInfo): boolean {
        const cfmlEngineSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.engine");
        const userEngineName: CFMLEngineName = CFMLEngineName.valueOf(cfmlEngineSettings.get<string>("name"));
        const userEngine: CFMLEngine = new CFMLEngine(userEngineName, cfmlEngineSettings.get<string>("version"));
        if (definition.type === "function" && definition.isCompatible(userEngine)) {
            cachedEntity.setGlobalFunction(definition.toGlobalFunction());
            // TODO: Add member function also
            cachedEntity.setGlobalEntityDefinition(definition);
            return true;
        }
        return false;
    }

    /**
     * Sets the given definition as a global function in the cached entities
     * @param definition The definition object to cache
     */
    public static setGlobalMemberFunction(definition: CFDocsDefinitionInfo): boolean {
        const cfmlEngineSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.engine");
        const userEngineName: CFMLEngineName = CFMLEngineName.valueOf(cfmlEngineSettings.get<string>("name"));
        const userEngine: CFMLEngine = new CFMLEngine(userEngineName, cfmlEngineSettings.get<string>("version"));
        if (definition.type === "function" && definition.isCompatible(userEngine)) {
            cachedEntity.setGlobalMemberFunction(definition.toGlobalFunction());
            // TODO: Add member function also
            cachedEntity.setGlobalEntityDefinition(definition);
            return true;
        }
        return false;
    }

    /**
     * Sets the given definition as a global tag in the cached entities
     * @param definition The definition object to cache
     */
    public static setGlobalTag(definition: CFDocsDefinitionInfo): boolean {
        const cfmlEngineSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.engine");
        const userEngineName: CFMLEngineName = CFMLEngineName.valueOf(cfmlEngineSettings.get<string>("name"));
        const userEngine: CFMLEngine = new CFMLEngine(userEngineName, cfmlEngineSettings.get<string>("version"));
        if (definition.type === "tag" && definition.isCompatible(userEngine)) {
            cachedEntity.setGlobalTag(definition.toGlobalTag());
            cachedEntity.setGlobalEntityDefinition(definition);
            return true;
        }
        return false;
    }

    /**
     * Caches all documented tags and functions from CFDocs
     */
    public static async cacheAll(): Promise<boolean> {
        const cfmlCfDocsSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.cfDocs");
        const cfdocsSource: CFDocsSource = cfmlCfDocsSettings.get<CFDocsSource>("source", CFDocsSource.Remote);
        const getDefinitionInfo = cfdocsSource === CFDocsSource.Local && vscode.env.appHost === "desktop" ?
            CFDocsService.getLocalDefinitionInfo : (cfdocsSource === CFDocsSource.Extension ?
                CFDocsService.getExtensionDefinitionInfo : CFDocsService.getRemoteDefinitionInfo);
        //const getMemberFunctionDefinition = CFDocsService.getExtensionDefinitionInfo;

        CFDocsService.getAllFunctionNames(cfdocsSource).then((allFunctionNames: string[]) => {
            allFunctionNames.forEach((functionName: string) => {
                getDefinitionInfo(functionName).then((definitionInfo: CFDocsDefinitionInfo) => {
                    CFDocsService.setGlobalFunction(definitionInfo);
                });
            });
        });

        /*CFDocsService.getAllMemberFunctionNames(cfdocsSource).then((allMemberFunctionNames: string[]) => {
            allMemberFunctionNames.forEach((memberFunctionName: string) => {
                getMemberFunctionDefinition("member-" + memberFunctionName).then((definitionInfo: CFDocsDefinitionInfo) => {
                    CFDocsService.setGlobalMemberFunction(definitionInfo);
                });
            });
        });*/

        CFDocsService.getAllTagNames(cfdocsSource).then((allTagNames: string[]) => {
            allTagNames.forEach((tagName: string) => {
                getDefinitionInfo(tagName).then((definitionInfo: CFDocsDefinitionInfo) => {
                    CFDocsService.setGlobalTag(definitionInfo);
                });
            });
        });

        return true;
    }

    /**
     * Opens the documentation web page on CFDocs for the word at the current cursor position
     * @editor The text editor which represents the document for which to check the word
     */
    public static async openCfDocsForCurrentWord(editor: TextEditor): Promise<void> {
        const document: TextDocument = editor.document;
        const position: Position = editor.selection.start;

        const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.suggest", document.uri);
        const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

        const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(document, position, false, replaceComments);

        if (documentPositionStateContext.positionInComment) {
            return;
        }

        const docPrefix: string = documentPositionStateContext.docPrefix;
        const textLine: TextLine = document.lineAt(position);
        const wordRange: Range = documentPositionStateContext.wordRange;
        const lineSuffix: string = documentPositionStateContext.sanitizedDocumentText.slice(document.offsetAt(wordRange.end), document.offsetAt(textLine.range.end));
        const userEngine: CFMLEngine = documentPositionStateContext.userEngine;

        const currentWord: string = documentPositionStateContext.currentWord;

        let globalEntity: GlobalEntity;
        const tagPrefixPattern: RegExp = getTagPrefixPattern();
        const functionSuffixPattern: RegExp = getFunctionSuffixPattern();

        if ((tagPrefixPattern.test(docPrefix) || (userEngine.supportsScriptTags() && functionSuffixPattern.test(lineSuffix))) && cachedEntity.isGlobalTag(currentWord)) {
            globalEntity = cachedEntity.getGlobalTag(currentWord);
        } else if (!documentPositionStateContext.isContinuingExpression && functionSuffixPattern.test(lineSuffix) && cachedEntity.isGlobalFunction(currentWord)) {
            globalEntity = cachedEntity.getGlobalFunction(currentWord);
        }

        if (globalEntity) {
            commands.executeCommand("vscode.open", Uri.parse(CFDocsService.cfDocsLinkPrefix + globalEntity.name));
        } else {
            window.showInformationMessage("No matching CFDocs entity was found");
        }
    }

    /**
     * Opens the documentation web page of the currently set CF engine for the word at the current cursor position
     * @editor The text editor which represents the document for which to check the word
     */
    public static async openEngineDocsForCurrentWord(editor: TextEditor): Promise<void> {
        const document: TextDocument = editor.document;
        const position: Position = editor.selection.start;

        const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.suggest", document.uri);
        const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

        const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(document, position, false, replaceComments);

        if (documentPositionStateContext.positionInComment) {
            return;
        }

        const userEngine: CFMLEngine = documentPositionStateContext.userEngine;

        if (userEngine.getName() === CFMLEngineName.Unknown) {
            window.showInformationMessage("CFML engine is not set");
            return;
        }

        const docPrefix: string = documentPositionStateContext.docPrefix;
        const textLine: TextLine = document.lineAt(position);
        const wordRange: Range = documentPositionStateContext.wordRange;
        const lineSuffix: string = documentPositionStateContext.sanitizedDocumentText.slice(document.offsetAt(wordRange.end), document.offsetAt(textLine.range.end));

        const currentWord: string = documentPositionStateContext.currentWord;

        let globalEntity: CFDocsDefinitionInfo;
        const tagPrefixPattern: RegExp = getTagPrefixPattern();
        const functionSuffixPattern: RegExp = getFunctionSuffixPattern();

        if ((tagPrefixPattern.test(docPrefix) || (userEngine.supportsScriptTags() && functionSuffixPattern.test(lineSuffix))) && cachedEntity.isGlobalTag(currentWord)) {
            globalEntity = cachedEntity.getGlobalEntityDefinition(currentWord);
        } else if (!documentPositionStateContext.isContinuingExpression && functionSuffixPattern.test(lineSuffix) && cachedEntity.isGlobalFunction(currentWord)) {
            globalEntity = cachedEntity.getGlobalEntityDefinition(currentWord);
        }

        if (globalEntity && globalEntity.engines && globalEntity.engines.hasOwnProperty(userEngine.getName())) {
            const engineInfo: EngineCompatibilityDetail = globalEntity.engines[userEngine.getName()];
            if (engineInfo.docs) {
                commands.executeCommand("vscode.open", Uri.parse(engineInfo.docs));
            } else {
                window.showInformationMessage("No engine docs for this entity was found");
            }

            return;
        }

        window.showInformationMessage("No matching compatible entity was found");
    }

    /**
     * Returns a list of all global CFML functions documented on CFDocs
     * @param source Indicates whether the data will be retrieved locally or remotely
     */
    /*public static async getAllMemberFunctionNames(source = CFDocsSource.Remote): Promise<string[]> {
      const jsonFileName: string = CFDocsService.getJsonFileName("memberfunctions");

      return new Promise<string[]>((resolve, reject) => {
          const extensionDocFilePath: string = path.join("./resources/schemas/en/", jsonFileName);
          const extensionPathUri: Uri = vscode.Uri.file(extensionContext.asAbsolutePath(extensionDocFilePath));
          try {
              workspace.fs.readFile(extensionPathUri).then((readData) => {
                  const readStr = Buffer.from(readData).toString('utf8');
                  const readJson = JSON.parse(readStr);
                  resolve(readJson.related);
              });
          } catch (ex) {
              console.error("Error retrieving all member function names:", (<Error>ex).message);
              reject(ex);
          }
      });

    }*/
}
