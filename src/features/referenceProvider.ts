import { CancellationToken, Location, Position, Range, ReferenceContext, ReferenceProvider, TextDocument, workspace, WorkspaceConfiguration } from "vscode";
import { Component } from "../entities/component";
import { UserFunction } from "../entities/userFunction";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../utils/documentUtil";
import { getAllComponentsByUri } from "./cachedEntities";

export default class CFMLReferenceProvider implements ReferenceProvider {

    /**
     * Provide references to the symbol at the given position in the given document.
     * @param document The document for which the command was invoked.
     * @param position The position for which the command was invoked.
     * @param context Additional information about the references request.
     * @param _token A cancellation token.
     */
    public async provideReferences(document: TextDocument, position: Position, context: ReferenceContext, _token: CancellationToken): Promise<Location[]> {
        const cfmlDefinitionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.definition", document.uri);
        if (!cfmlDefinitionSettings.get<boolean>("enable", true)) {
            return [];
        }

        const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.suggest", document.uri);
        const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

        const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(document, position, false, replaceComments);

        if (documentPositionStateContext.positionInComment) {
            return [];
        }

        const results: Location[] = [];

        let wordRange: Range = document.getWordRangeAtPosition(position);
        const currentWord: string = documentPositionStateContext.currentWord;
        
        if (!wordRange) {
            wordRange = new Range(position, position);
        }

        if (!currentWord) {
            return [];
        }

        const docIsCfcFile: boolean = documentPositionStateContext.isCfcFile;
        
        // Check if we're on a function/method name
        if (docIsCfcFile) {
            const thisComponent: Component = documentPositionStateContext.component;
            
            // Check if position is on a function definition in this component
            let targetFunction: UserFunction = null;
            if (thisComponent) {
                thisComponent.functions.forEach((func: UserFunction) => {
                    if (func.nameRange && func.nameRange.contains(position)) {
                        targetFunction = func;
                    }
                });
            }

            // If we found a function definition or just a function name, search for all references
            if (targetFunction || currentWord) {
                const functionName = targetFunction ? targetFunction.name : currentWord;

                // Include the declaration if requested
                if (context.includeDeclaration && targetFunction && targetFunction.nameRange) {
                    results.push(new Location(document.uri, targetFunction.nameRange));
                }

                // Search through all components for function calls
                await this.findFunctionReferences(functionName, results);
            }
        } else {
            // For non-CFC files, still search for function references
            await this.findFunctionReferences(currentWord, results);
        }

        return results;
    }

    /**
     * Find all references to a function across all documents
     * @param functionName The name of the function to search for
     * @param results The array to add found locations to
     */
    private async findFunctionReferences(functionName: string, results: Location[]): Promise<void> {
        // Track which documents we've already searched to avoid duplicates
        const searchedUris = new Set<string>();
        
        // Get all components from cache
        const allComponents = getAllComponentsByUri();
        
        // Search through all cached components for function calls
        for (const componentUri in allComponents) {
            const component: Component = allComponents[componentUri];
            const uriString = component.uri.toString();
            
            if (searchedUris.has(uriString)) {
                continue;
            }
            
            try {
                // Open the document to search for function calls
                const doc = await workspace.openTextDocument(component.uri);
                this.searchDocumentForReferences(doc, functionName, results);
                searchedUris.add(uriString);
            } catch (error) {
                // Skip files that can't be opened
                continue;
            }
        }
        
        // Also search through all open text documents that might not be in cache
        workspace.textDocuments.forEach(doc => {
            const uriString = doc.uri.toString();
            
            // Skip if already searched or not a CFML/BoxLang file
            if (searchedUris.has(uriString) || (doc.languageId !== "cfml" && doc.languageId !== "boxlang")) {
                return;
            }
            
            this.searchDocumentForReferences(doc, functionName, results);
            searchedUris.add(uriString);
        });
    }

    /**
     * Search a document for references to a function
     * @param doc The document to search
     * @param functionName The function name to search for
     * @param results The array to add found locations to
     */
    private searchDocumentForReferences(doc: TextDocument, functionName: string, results: Location[]): void {
        const text = doc.getText();
        
        // Create regex patterns to find function calls
        // Pattern 1: object.functionName( or this.functionName(
        const methodCallPattern = new RegExp(`\\b(\\w+)\\.${this.escapeRegex(functionName)}\\s*\\(`, 'gi');
        // Pattern 2: functionName( (direct function call)
        const functionCallPattern = new RegExp(`\\b${this.escapeRegex(functionName)}\\s*\\(`, 'gi');
        
        let match: RegExpExecArray;
        
        // Find method calls (object.method())
        while ((match = methodCallPattern.exec(text)) !== null) {
            const startPos = doc.positionAt(match.index + match[1].length + 1); // +1 for the dot
            const endPos = doc.positionAt(match.index + match[1].length + 1 + functionName.length);
            const range = new Range(startPos, endPos);
            
            // Avoid duplicates
            const isDuplicate = results.some(loc => 
                loc.uri.toString() === doc.uri.toString() && 
                loc.range.isEqual(range)
            );
            
            if (!isDuplicate) {
                results.push(new Location(doc.uri, range));
            }
        }
        
        // Reset lastIndex for the second pattern
        functionCallPattern.lastIndex = 0;
        
        // Find direct function calls
        while ((match = functionCallPattern.exec(text)) !== null) {
            const startPos = doc.positionAt(match.index);
            const endPos = doc.positionAt(match.index + functionName.length);
            const range = new Range(startPos, endPos);
            
            // Avoid duplicates by checking if we already added this location
            const isDuplicate = results.some(loc => 
                loc.uri.toString() === doc.uri.toString() && 
                loc.range.isEqual(range)
            );
            
            if (!isDuplicate) {
                results.push(new Location(doc.uri, range));
            }
        }
    }

    /**
     * Escape special regex characters in a string
     * @param str The string to escape
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
