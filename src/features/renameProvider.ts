import {
    CancellationToken,
    Position,
    ProviderResult,
    Range,
    RenameProvider,
    TextDocument,
    WorkspaceEdit,
    workspace,
    WorkspaceConfiguration
} from "vscode";
import { UserFunction, getFunctionFromPrefix } from "../entities/userFunction";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../utils/documentUtil";

/**
 * Provides rename functionality for BoxLang/CFML symbols
 */
export default class CFMLRenameProvider implements RenameProvider {
    /**
     * Prepares the rename operation by validating the symbol at the given position
     * @param document The document in which the command was invoked
     * @param position The position at which the command was invoked
     * @param _token A cancellation token
     */
    public prepareRename(
        document: TextDocument,
        position: Position,
        _token: CancellationToken
    ): ProviderResult<Range | { range: Range; placeholder: string }> {
        const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.suggest", document.uri);
        const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

        const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(
            document,
            position,
            false,
            replaceComments
        );

        if (documentPositionStateContext.positionInComment) {
            return null;
        }

        let wordRange: Range = document.getWordRangeAtPosition(position);
        const currentWord: string = documentPositionStateContext.currentWord;

        if (!wordRange || !currentWord) {
            return null;
        }

        return {
            range: wordRange,
            placeholder: currentWord
        };
    }

    /**
     * Provides the edits to rename the symbol at the given position
     * @param document The document in which the command was invoked
     * @param position The position at which the command was invoked
     * @param newName The new name of the symbol
     * @param _token A cancellation token
     */
    public async provideRenameEdits(
        document: TextDocument,
        position: Position,
        newName: string,
        _token: CancellationToken
    ): Promise<WorkspaceEdit> {
        const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("boxlang.cfml.suggest", document.uri);
        const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);

        const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(
            document,
            position,
            false,
            replaceComments
        );

        if (documentPositionStateContext.positionInComment) {
            return null;
        }

        const currentWord: string = documentPositionStateContext.currentWord;
        const lowerCurrentWord: string = currentWord.toLowerCase();

        if (!currentWord) {
            return null;
        }

        const workspaceEdit = new WorkspaceEdit();

        // Try to find the function definition
        const userFunc: UserFunction = await getFunctionFromPrefix(documentPositionStateContext, lowerCurrentWord);

        if (userFunc) {
            // Found a function definition, now find all references
            await this.renameFunction(userFunc, currentWord, newName, workspaceEdit);
        } else {
            // Fallback: just rename the current word in the current document
            const wordRange: Range = document.getWordRangeAtPosition(position);
            if (wordRange) {
                workspaceEdit.replace(document.uri, wordRange, newName);
            }
        }

        return workspaceEdit;
    }

    /**
     * Renames a function and all its references
     * @param userFunc The function to rename
     * @param oldName The current name of the function
     * @param newName The new name for the function
     * @param workspaceEdit The workspace edit to add changes to
     */
    private async renameFunction(
        userFunc: UserFunction,
        oldName: string,
        newName: string,
        workspaceEdit: WorkspaceEdit
    ): Promise<void> {
        // 1. Rename the function definition
        workspaceEdit.replace(userFunc.location.uri, userFunc.nameRange, newName);

        // 2. Search for all references in all workspace documents
        const allDocuments = await workspace.findFiles("**/*.{cfc,cfm,cfml,bx,bxs,bxm}");

        for (const docUri of allDocuments) {
            try {
                const doc = await workspace.openTextDocument(docUri);
                const text = doc.getText();

                // Find all occurrences of the function name in this document
                // Use a regex to find function calls: functionName(
                const functionCallPattern = new RegExp(
                    `\\b${this.escapeRegExp(oldName)}\\s*\\(`,
                    "gi"
                );

                let match: RegExpExecArray;
                while ((match = functionCallPattern.exec(text)) !== null) {
                    const matchStart = match.index;
                    const matchEnd = matchStart + oldName.length;
                    const startPos = doc.positionAt(matchStart);
                    const endPos = doc.positionAt(matchEnd);
                    const range = new Range(startPos, endPos);

                    // Only add if it's not already the definition we renamed
                    if (!range.isEqual(userFunc.nameRange) || docUri.toString() !== userFunc.location.uri.toString()) {
                        workspaceEdit.replace(docUri, range, newName);
                    }
                }

                // Also find method invocations: object.functionName(
                const methodCallPattern = new RegExp(
                    `\\.(\\s*)${this.escapeRegExp(oldName)}\\s*\\(`,
                    "gi"
                );

                while ((match = methodCallPattern.exec(text)) !== null) {
                    const matchStart = match.index + match[0].indexOf(oldName);
                    const matchEnd = matchStart + oldName.length;
                    const startPos = doc.positionAt(matchStart);
                    const endPos = doc.positionAt(matchEnd);
                    const range = new Range(startPos, endPos);

                    workspaceEdit.replace(docUri, range, newName);
                }
            } catch (error) {
                // Skip files that can't be opened
                console.error(`Error processing ${docUri.toString()}: ${error}`);
            }
        }
    }

    /**
     * Escapes special regex characters in a string
     * @param str The string to escape
     */
    private escapeRegExp(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
