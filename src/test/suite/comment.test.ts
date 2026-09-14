import * as assert from 'assert';

// The unit runner loads this mock before the test files. Keep the import here so
// this regression test can also be run directly with Mocha.
import '../mocks/vscode';

const vscode = require('vscode') as any;
const Module = require('module');
const originalRequire = Module.prototype.require;

// Keep this regression test focused on comment selection rather than loading
// the extension entry point and its full dependency graph.
Module.prototype.require = function (id: string) {
    if (id === '../main' || id === '../../main') {
        return { BL_LANGUAGE_ID: 'boxlang', CFML_LANGUAGE_ID: 'cfml', extensionContext: {} };
    }
    if (id === '../utils/contextUtil') {
        return {
            isCfcFile: (document: any) => /\.cfc$/i.test(document.uri.fsPath),
            isColdFusionFile: (uri: any) => /\.(cfc|cfml|cfm)$/i.test(uri.fsPath),
            isInCfScript: () => false,
            isScriptFile: (uri: any) => /\.(cfc|bx|bxs)$/i.test(uri.fsPath),
            isTemplateFile: (uri: any) => /\.(cfm|cfml|bxm)$/i.test(uri.fsPath)
        };
    }
    if (id === '../entities/component') {
        return {
            isScriptComponent: (document: any) => /\.cfc$/i.test(document.uri.fsPath)
                && !/<cf(component|interface)\b/i.test(document.getText())
        };
    }
    if (id === './cachedEntities') {
        return { hasComponent: () => false, getComponent: () => undefined };
    }
    return originalRequire.apply(this, arguments);
};

delete require.cache[require.resolve('../../features/comment')];
const { CommentType, toggleComment } = require('../../features/comment');
Module.prototype.require = originalRequire;

suite('Comment toggle test suite', () => {
    let originalLanguages: any;
    let originalCommands: any;
    let configurations: any[];
    let executedCommands: string[];
    let disposedConfigurations: number;

    setup(() => {
        originalLanguages = vscode.languages;
        originalCommands = vscode.commands;
        configurations = [];
        executedCommands = [];
        disposedConfigurations = 0;

        vscode.languages = {
            setLanguageConfiguration(languageId: string, configuration: any) {
                configurations.push({ languageId, configuration });
                return {
                    dispose() {
                        disposedConfigurations++;
                    }
                };
            }
        };
        vscode.commands = {
            executeCommand(command: string) {
                executedCommands.push(command);
                return Promise.resolve();
            }
        };
    });

    teardown(() => {
        vscode.languages = originalLanguages;
        vscode.commands = originalCommands;
    });

    test('uses script comments for an uncached script CFC', async () => {
        const document = {
            uri: { fsPath: '/workspace/OfferQuick.cfc' },
            languageId: 'cfml',
            getText: () => `/** Entity */
component extends="quick.models.BaseEntity" {
}`
        };
        const editor = {
            document,
            selection: { start: { line: 1, character: 0 } }
        };

        await toggleComment(CommentType.Line)(editor as any);

        assert.deepStrictEqual(configurations, [{
            languageId: 'cfml',
            configuration: {
                comments: {
                    lineComment: '//',
                    blockComment: ['/*', '*/']
                }
            }
        }]);
        assert.deepStrictEqual(executedCommands, ['editor.action.commentLine']);
        assert.strictEqual(disposedConfigurations, 1);
    });
});
