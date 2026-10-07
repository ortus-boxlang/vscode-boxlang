import * as assert from 'assert';
const { ReplVariablesProvider } = require('../../repl/VariablesView');
const vscode = require('vscode');

suite('REPL native variables tree', () => {
    test('icons are real ThemeIcon instances, not URI-like plain objects', async () => {
        const provider = new ReplVariablesProvider({ status: 'Ready' });
        try {
            const roots = await provider.getChildren();
            for (const node of roots) {
                const icon = provider.getTreeItem(node).iconPath;
                assert.ok(icon instanceof vscode.ThemeIcon, 'VS Code interprets plain icon objects as light/dark file paths');
                assert.strictEqual(icon.id, 'symbol-namespace');
            }
            const scalar = provider.getTreeItem({ variable: { name: 'answer', type: 'Integer', value: '42', expandable: false }, path: ['answer'] });
            assert.ok(scalar.iconPath instanceof vscode.ThemeIcon);
            assert.strictEqual(scalar.iconPath.id, 'symbol-number');
        } finally { provider.dispose(); }
    });

    test('shows scopes even without local variables and exposes the last expression result', async () => {
        const calls: any[] = [];
        const session = {
            status: 'Ready',
            lastResult: { executionId: 7, variable: { name: 'result', type: 'UnmodifiableStruct', value: '{10 entries}', expandable: true } },
            inspect: async (segments, _token, target) => { calls.push({ segments, target }); return { ok: true, variables: [] }; }
        };
        const provider = new ReplVariablesProvider(session);
        try {
            const roots = await provider.getChildren();
            assert.deepStrictEqual(roots.map(node => node.variable.name), ['variables', 'server', 'request', 'Last result (Out 7)']);
            assert.strictEqual(calls.length, 0, 'root groups must not depend on populated variables');
            await provider.getChildren(roots[1]);
            assert.strictEqual(calls[0].target.scope, 'server');
            await provider.getChildren(roots[3]);
            assert.strictEqual(calls[1].target.executionId, 7);
            assert.notStrictEqual(provider.getTreeItem(roots[0]).id, provider.getTreeItem(roots[1]).id);
        } finally { provider.dispose(); }
    });

    test('loads lazily, keeps stable IDs and expansion, and refreshes previews', async () => {
        const inspected: string[][] = [];
        let value = '41';
        const session = {
            status: 'Ready',
            inspect: async (segments: string[]) => {
                inspected.push(segments);
                return { ok: true, variables: segments.length
                    ? [{ name: 'value', type: 'Integer', value, expandable: false }]
                    : [{ name: 'data.with.dots', type: 'Struct', value: '{1 entries}', expandable: true }] };
            }
        };
        const provider = new ReplVariablesProvider(session);
        try {
            const [scope] = await provider.getChildren();
            const [root] = await provider.getChildren(scope);
            assert.deepStrictEqual(inspected, [[]], 'loading must not inspect every descendant');
            await provider.getChildren(scope);
            assert.strictEqual(inspected.length, 1, 'coalesce repeated requests for the same snapshot');
            provider.setExpanded(root, true);
            const original = provider.getTreeItem(root);
            const [child] = await provider.getChildren(root);
            assert.strictEqual(provider.getParent(child), root);
            assert.strictEqual(provider.getTreeItem(child).description, '41');
            value = '42';
            provider.refresh();
            const [refreshedScope] = await provider.getChildren();
            const [refreshed] = await provider.getChildren(refreshedScope);
            assert.strictEqual(provider.getTreeItem(refreshed).id, original.id);
            assert.strictEqual(provider.getTreeItem(refreshed).collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
            const [updated] = await provider.getChildren(refreshed);
            assert.strictEqual(provider.getTreeItem(updated).description, '42');
            assert.deepStrictEqual(updated.path, ['data.with.dots', 'value']);
            provider.setExpanded(refreshed, false);
            assert.strictEqual(provider.getTreeItem(refreshed).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
            provider.refresh(true);
            assert.strictEqual(provider.getTreeItem(root).collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        } finally { provider.dispose(); }
    });

    test('ignores obsolete inspection results and does not start a stopped session', async () => {
        let resolve: (response: object) => void;
        let calls = 0;
        const session = { status: 'Ready', inspect: () => { calls++; return new Promise(done => { resolve = done; }); } };
        const provider = new ReplVariablesProvider(session);
        try {
            const [scope] = await provider.getChildren();
            const old = provider.getChildren(scope);
            provider.refresh();
            resolve({ ok: true, variables: [{ name: 'old', type: 'String', value: 'stale', expandable: false }] });
            assert.deepStrictEqual(await old, []);
            session.status = 'Stopped';
            assert.deepStrictEqual(await provider.getChildren(), []);
            assert.strictEqual(calls, 1);
        } finally { provider.dispose(); }
    });

    test('panel inspection preserves the UI request ID rather than the runtime protocol ID', async () => {
        const Module = require('module');
        const originalRequire = Module.prototype.require;
        const modulePath = require.resolve('../../repl');
        const cached = require.cache[modulePath];
        const messages: any[] = [];
        const commands = new Map();
        let receive: (message: any) => Promise<void>;
        let inspected: any;
        const disposable = { dispose() {} };
        const session = {
            status: 'Ready', environment: '', executions: [], onDidChange: () => disposable,
            inspect: async (segments, _token, target) => { inspected = { segments, target }; return { id: 99, ok: true, variables: [] }; }
        };
        const mock = {
            ...vscode,
            ViewColumn: { Beside: 2 },
            commands: { registerCommand: (id, callback) => { commands.set(id, callback); return disposable; } },
            window: {
                ...vscode.window,
                createWebviewPanel: () => ({
                    webview: {
                        cspSource: 'test', asWebviewUri: uri => uri.fsPath,
                        postMessage: message => { messages.push(message); return Promise.resolve(true); },
                        onDidReceiveMessage: listener => { receive = listener; return disposable; }
                    },
                    onDidDispose: () => disposable
                })
            }
        };
        Module.prototype.require = function(id: string) {
            if (/[\\/]repl[\\/]index\./.test(this.filename || '')) {
                if (id === 'vscode') return mock;
                if (id === './ReplSession') return { replSession: session };
                if (id === './VariablesView') return { registerVariablesView() {} };
            }
            return originalRequire.apply(this, arguments);
        };
        try {
            delete require.cache[modulePath];
            require('../../repl').registerReplSession({ extensionPath: '/mock/extension', subscriptions: [] });
            commands.get('boxlang.openREPLSession')();
            await receive({ kind: 'inspectResult', id: 'ui-1', executionId: 7, path: ['nested'] });
            assert.strictEqual(messages[0].kind, 'resultChildren');
            assert.strictEqual(messages[0].id, 'ui-1');
            assert.strictEqual(inspected.target.executionId, 7);
            assert.deepStrictEqual(inspected.segments, ['nested']);
        } finally {
            Module.prototype.require = originalRequire;
            if (cached) require.cache[modulePath] = cached;
            else delete require.cache[modulePath];
        }
    });

    test('inspection failures are visible instead of leaving an unexplained empty tree', async () => {
        const provider = new ReplVariablesProvider({ status: 'Ready', inspect: async () => { throw new Error('Transport failed'); } });
        try {
            const [scope] = await provider.getChildren();
            const [error] = await provider.getChildren(scope);
            assert.strictEqual(error.variable.name, 'Inspection error');
            assert.ok(provider.getTreeItem(error).description.includes('Transport failed'));
        } finally { provider.dispose(); }
    });
});
