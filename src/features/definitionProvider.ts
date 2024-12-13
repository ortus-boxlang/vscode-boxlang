import { CancellationToken, DefinitionLink, DefinitionProvider, Position, Range, TextDocument, Uri, workspace, WorkspaceConfiguration } from "vscode";
import { Component, objectReferencePatterns, ReferencePattern } from "../entities/component";
import { getFunctionSuffixPattern } from "../entities/function";
import { Property } from "../entities/property";
import { getValidScopesPrefixPattern, getVariableScopePrefixPattern, Scope, unscopedPrecedence } from "../entities/scope";
import { Argument, getFunctionFromPrefix, getLocalVariables, UserFunction, UserFunctionSignature } from "../entities/userFunction";
import { getApplicationVariables, getServerVariables, parseVariableAssignments, Variable } from "../entities/variable";
import { SearchMode } from "../utils/collections";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../utils/documentUtil";
import { equalsIgnoreCase } from "../utils/textUtil";
import { componentPathToUri, getComponent, searchAllFunctionNames } from "./cachedEntities";

export default class CFMLDefinitionProvider implements DefinitionProvider {

    /**
     * Provide the definition of the symbol at the given position in the given document.
     * @param document The document for which the command was invoked.
     * @param position The position for which the command was invoked.
     * @param _token A cancellation token.
     */
    public async provideDefinition(document: TextDocument, position: Position, _token: CancellationToken): Promise<DefinitionLink[]> {
        const cfmlDefinitionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.definition", document.uri);
        if (!cfmlDefinitionSettings.get<boolean>("enable", true)) {
            return null;
        }

        const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.suggest", document.uri);
        const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

        const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(document, position, false, replaceComments);

        if (documentPositionStateContext.positionInComment) {
            return null;
        }

        const results: DefinitionLink[] = [];

        const docIsCfcFile: boolean = documentPositionStateContext.isCfcFile;
        const docIsCfmFile: boolean = documentPositionStateContext.isCfmFile;
        const documentText: string = documentPositionStateContext.sanitizedDocumentText;
        let wordRange: Range = document.getWordRangeAtPosition(position);
        const currentWord: string = documentPositionStateContext.currentWord;
        const lowerCurrentWord: string = currentWord.toLowerCase();
        if (!wordRange) {
            wordRange = new Range(position, position);
        }

        const docPrefix: string = documentPositionStateContext.docPrefix;

        // TODO: These references should ideally be in cachedEntities.
        let referenceMatch: RegExpExecArray | null;
        objectReferencePatterns.forEach((element: ReferencePattern) => {
            const pattern: RegExp = element.pattern;
            while ((referenceMatch = pattern.exec(documentText))) {
                const path: string = referenceMatch[element.refIndex];
                const offset: number = referenceMatch.index + referenceMatch[0].lastIndexOf(path);
                const pathRange = new Range(
                    document.positionAt(offset),
                    document.positionAt(offset + path.length)
                );

                if (pathRange.contains(position)) {
                    const componentUri: Uri = componentPathToUri(path, document.uri);
                    if (componentUri) {
                        const comp: Component = getComponent(componentUri);
                        if (comp) {
                            results.push({
                                originSelectionRange: pathRange,
                                targetUri: comp.uri,
                                targetRange: comp.declarationRange,
                                targetSelectionRange: comp.declarationRange
                            });
                        }
                    }
                }
            }
        });

        if (docIsCfcFile) {
            const thisComponent: Component = documentPositionStateContext.component;
            if (thisComponent) {
                // Extends
                if (thisComponent.extendsRange && thisComponent.extendsRange.contains(position)) {
                    const extendsComp: Component = getComponent(thisComponent.extends);
                    if (extendsComp) {
                        results.push({
                            originSelectionRange: thisComponent.extendsRange,
                            targetUri: extendsComp.uri,
                            targetRange: extendsComp.declarationRange,
                            targetSelectionRange: extendsComp.declarationRange
                        });
                    }
                }

                // Implements
                if (thisComponent.implementsRanges) {
                    thisComponent.implementsRanges.forEach((range: Range, idx: number) => {
                        if (range && range.contains(position)) {
                            const implComp: Component = getComponent(thisComponent.implements[idx]);
                            if (implComp) {
                                results.push({
                                    originSelectionRange: range,
                                    targetUri: implComp.uri,
                                    targetRange: implComp.declarationRange,
                                    targetSelectionRange: implComp.declarationRange
                                });
                            }
                        }
                    });
                }

                // Component functions (related)
                thisComponent.functions.forEach((func: UserFunction) => {
                    // Function return types
                    if (func.returnTypeUri && func.returnTypeRange && func.returnTypeRange.contains(position)) {
                        const returnTypeComp: Component = getComponent(func.returnTypeUri);
                        if (returnTypeComp) {
                            results.push({
                                originSelectionRange: func.returnTypeRange,
                                targetUri: returnTypeComp.uri,
                                targetRange: returnTypeComp.declarationRange,
                                targetSelectionRange: returnTypeComp.declarationRange
                            });
                        }
                    }

                    // Argument types
                    func.signatures.forEach((signature: UserFunctionSignature) => {
                        signature.parameters.filter((arg: Argument) => {
                            return arg.dataTypeComponentUri && arg.dataTypeRange && arg.dataTypeRange.contains(position);
                        }).forEach((arg: Argument) => {
                            const argTypeComp: Component = getComponent(arg.dataTypeComponentUri);
                            if (argTypeComp) {
                                results.push({
                                    originSelectionRange: arg.dataTypeRange,
                                    targetUri: argTypeComp.uri,
                                    targetRange: argTypeComp.declarationRange,
                                    targetSelectionRange: argTypeComp.declarationRange
                                });
                            }
                        });
                    });

                    if (func.bodyRange && func.bodyRange.contains(position)) {
                        // Local variable uses
                        const localVariables = getLocalVariables(func, documentPositionStateContext, thisComponent.isScript);
                        const localVarPrefixPattern = getValidScopesPrefixPattern([Scope.Local], true);
                        if (localVarPrefixPattern.test(docPrefix)) {
                            localVariables.filter((localVar: Variable) => {
                                return position.isAfterOrEqual(localVar.declarationLocation.range.start) && equalsIgnoreCase(localVar.identifier, currentWord);
                            }).forEach((localVar: Variable) => {
                                results.push({
                                    targetUri: localVar.declarationLocation.uri,
                                    targetRange: localVar.declarationLocation.range,
                                    targetSelectionRange: localVar.declarationLocation.range
                                });
                            });
                        }

                        // Argument uses
                        if (results.length === 0) {
                            const argumentPrefixPattern = getValidScopesPrefixPattern([Scope.Arguments], true);
                            if (argumentPrefixPattern.test(docPrefix)) {
                                func.signatures.forEach((signature: UserFunctionSignature) => {
                                    signature.parameters.filter((arg: Argument) => {
                                        return equalsIgnoreCase(arg.name, currentWord);
                                    }).forEach((arg: Argument) => {
                                        results.push({
                                            targetUri: thisComponent.uri,
                                            targetRange: arg.nameRange,
                                            targetSelectionRange: arg.nameRange
                                        });
                                    });
                                });
                            }
                        }
                    }
                });

                // Component properties (declarations)
                thisComponent.properties.filter((prop: Property) => {
                    return prop.dataTypeComponentUri !== undefined && prop.dataTypeRange.contains(position);
                }).forEach((prop: Property) => {
                    const dataTypeComp: Component = getComponent(prop.dataTypeComponentUri);
                    if (dataTypeComp) {
                        results.push({
                            originSelectionRange: prop.dataTypeRange,
                            targetUri: dataTypeComp.uri,
                            targetRange: dataTypeComp.declarationRange,
                            targetSelectionRange: dataTypeComp.declarationRange
                        });
                    }
                });

                // Component variables
                const variablesPrefixPattern = getValidScopesPrefixPattern([Scope.Variables], false);
                if (variablesPrefixPattern.test(docPrefix)) {
                    thisComponent.variables.filter((variable: Variable) => {
                        return equalsIgnoreCase(variable.identifier, currentWord);
                    }).forEach((variable: Variable) => {
                        results.push({
                            targetUri: variable.declarationLocation.uri,
                            targetRange: variable.declarationLocation.range,
                            targetSelectionRange: variable.declarationLocation.range
                        });
                    });
                }
            }
        } else if (docIsCfmFile) {
            const docVariableAssignments: Variable[] = parseVariableAssignments(documentPositionStateContext, false);
            const variableScopePrefixPattern: RegExp = getVariableScopePrefixPattern();
            const variableScopePrefixMatch: RegExpExecArray = variableScopePrefixPattern.exec(docPrefix);
            if (variableScopePrefixMatch) {
                const validScope: string = variableScopePrefixMatch[1];
                let currentScope: Scope;
                if (validScope) {
                    currentScope = Scope.valueOf(validScope);
                }

                docVariableAssignments.filter((variable: Variable) => {
                    if (!equalsIgnoreCase(variable.identifier, currentWord)) {
                        return false;
                    }

                    if (currentScope) {
                        return (variable.scope === currentScope || (variable.scope === Scope.Unknown && unscopedPrecedence.includes(currentScope)));
                    }

                    return (unscopedPrecedence.includes(variable.scope) || variable.scope === Scope.Unknown);
                }).forEach((variable: Variable) => {
                    results.push({
                        targetUri: variable.declarationLocation.uri,
                        targetRange: variable.declarationLocation.range,
                        targetSelectionRange: variable.declarationLocation.range
                    });
                });
            }
        }

        // User function
        const userFunc: UserFunction = await getFunctionFromPrefix(documentPositionStateContext, lowerCurrentWord);
        if (userFunc) {
            results.push({
                targetUri: userFunc.location.uri,
                targetRange: userFunc.nameRange, // TODO: userFunc.location.range
                targetSelectionRange: userFunc.nameRange
            });
        }

        // Application variables
        const applicationVariablesPrefixPattern = getValidScopesPrefixPattern([Scope.Application, Scope.Session, Scope.Request], false);
        const variableScopePrefixMatch: RegExpExecArray = applicationVariablesPrefixPattern.exec(docPrefix);
        if (variableScopePrefixMatch) {
            const currentScope: string = Scope.valueOf(variableScopePrefixMatch[1]);

            const applicationDocVariables: Variable[] = await getApplicationVariables(document.uri);
            applicationDocVariables.filter((variable: Variable) => {
                return variable.scope === currentScope && equalsIgnoreCase(variable.identifier, currentWord);
            }).forEach((variable: Variable) => {
                results.push({
                    targetUri: variable.declarationLocation.uri,
                    targetRange: variable.declarationLocation.range,
                    targetSelectionRange: variable.declarationLocation.range
                });
            });
        }

        // Server variables
        const serverVariablesPrefixPattern = getValidScopesPrefixPattern([Scope.Server], false);
        if (serverVariablesPrefixPattern.test(docPrefix)) {
            const serverDocVariables: Variable[] = getServerVariables(document.uri);
            serverDocVariables.filter((variable: Variable) => {
                return variable.scope === Scope.Server && equalsIgnoreCase(variable.identifier, currentWord);
            }).forEach((variable: Variable) => {
                results.push({
                    targetUri: variable.declarationLocation.uri,
                    targetRange: variable.declarationLocation.range,
                    targetSelectionRange: variable.declarationLocation.range
                });
            });
        }

        // Search for function by name
        if (results.length === 0 && documentPositionStateContext.isContinuingExpression && cfmlDefinitionSettings.get<boolean>("userFunctions.search.enable", false)) {
            const wordSuffix: string = documentText.slice(document.offsetAt(wordRange.end), documentText.length);
            const functionSuffixPattern: RegExp = getFunctionSuffixPattern();
            if (functionSuffixPattern.test(wordSuffix)) {
                const functionSearchResults = searchAllFunctionNames(lowerCurrentWord, SearchMode.EqualTo);
                functionSearchResults.forEach((userFunc: UserFunction) => {
                    results.push({
                        targetUri: userFunc.location.uri,
                        targetRange: userFunc.nameRange, // TODO: userFunc.location.range
                        targetSelectionRange: userFunc.nameRange
                    });
                });
            }
        }

        return results;
    }
}
