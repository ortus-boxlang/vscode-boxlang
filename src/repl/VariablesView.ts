import * as vscode from "vscode";
import { InspectionTarget, ReplSession, SessionVariable } from "./ReplSession";
import { boxlangOutputChannel } from "../utils/OutputChannels";

export type VariableNode = InspectionTarget & { variable: SessionVariable; path: string[]; parent?: VariableNode };
// The legacy vscode package declares this constructor private; the supported VS Code API makes it public.
const ThemeIcon = vscode.ThemeIcon as unknown as { new(id: string): vscode.ThemeIcon };
const nodeId = (node: VariableNode) => JSON.stringify([node.scope ?? "variables", node.executionId ?? null, ...node.path]);

export class ReplVariablesProvider implements vscode.TreeDataProvider<VariableNode>, vscode.Disposable {
    private changes = new vscode.EventEmitter<VariableNode | undefined>();
    readonly onDidChangeTreeData = this.changes.event;
    private expanded = new Set<string>();
    private children = new Map<string, Promise<VariableNode[]>>();
    private revision = 0;

    constructor(private session: ReplSession) { this.expanded.add(JSON.stringify(["variables", null])); }

    refresh(clearExpansion = false) {
        this.revision++;
        this.children.clear();
        if (clearExpansion) {
            this.expanded.clear();
            this.expanded.add(JSON.stringify(["variables", null]));
        }
        this.changes.fire(undefined);
    }

    setExpanded(node: VariableNode, expanded: boolean) {
        const id = nodeId(node);
        if (expanded) this.expanded.add(id);
        else this.expanded.delete(id);
    }

    getTreeItem(node: VariableNode): vscode.TreeItem {
        const { variable } = node;
        const id = nodeId(node);
        const expandable = variable.expandable && node.path.length < 20;
        const item = new vscode.TreeItem(variable.name, expandable
            ? this.expanded.has(id) ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        item.id = id; // Stable, unambiguous IDs preserve selection and expansion across refreshes.
        item.description = variable.type === "String" ? JSON.stringify(variable.value) : variable.value.replace(/\s+/g, " ");
        item.tooltip = `${variable.name}: ${variable.type}\n${variable.value}\nPreview only (up to 2 KB).`;
        item.contextValue = "boxlangREPLVariable";
        const icon = variable.type === "Scope" ? "symbol-namespace" : variable.type === "Error" ? "warning"
            : variable.type === "Query" ? "table"
            : variable.type === "Array" ? "symbol-array"
            : variable.type === "String" ? "symbol-string"
            : variable.type === "Boolean" ? "symbol-boolean"
            : /^(Integer|Long|Double|Float|BigDecimal|BigInteger)$/.test(variable.type) ? "symbol-number"
            : variable.expandable ? "symbol-object" : "symbol-variable";
        item.iconPath = new ThemeIcon(icon);
        return item;
    }

    getParent(node: VariableNode) { return node.parent; }

    getChildren(parent?: VariableNode): Promise<VariableNode[]> {
        if (this.session.status === "Stopped" || this.session.status === "Failed" || this.session.status === "Starting") return Promise.resolve([]);
        if (!parent) {
            const roots: VariableNode[] = (["variables", "server", "request"] as const).map(scope => ({
                variable: { name: scope, type: "Scope", value: "", expandable: true }, path: [], scope
            }));
            if (this.session.lastResult) roots.push({
                variable: { ...this.session.lastResult.variable, name: `Last result (Out ${this.session.lastResult.executionId})` },
                path: [], executionId: this.session.lastResult.executionId
            });
            return Promise.resolve(roots);
        }
        const segments = parent.path;
        const id = nodeId(parent);
        const cached = this.children.get(id);
        if (cached) return cached;
        const revision = this.revision;
        const loading = this.session.inspect(segments, undefined, { scope: parent.scope, executionId: parent.executionId }).then(response => {
            if (revision !== this.revision) return [];
            if (!response.ok) throw new Error(response.error);
            return (response.variables ?? [])
                .map(variable => ({ variable, path: [...segments, variable.name], parent, scope: parent.scope, executionId: parent.executionId }))
                .sort((a, b) => a.variable.name.localeCompare(b.variable.name, undefined, { numeric: true }));
        }).catch(error => {
            if (revision === this.revision) {
                this.children.delete(id);
                boxlangOutputChannel.appendLine(`[REPL variables] ${error.message}`);
                return [{ variable: { name: "Inspection error", type: "Error", value: error.message, expandable: false }, path: [...segments, "<error>"], parent, scope: parent.scope, executionId: parent.executionId }];
            }
            return [];
        });
        this.children.set(id, loading);
        return loading;
    }

    dispose() {
        this.revision++;
        this.children.clear();
        this.expanded.clear();
        this.changes.dispose();
    }
}

export function registerVariablesView(context: vscode.ExtensionContext, session: ReplSession) {
    const provider = new ReplVariablesProvider(session);
    const view = vscode.window.createTreeView("boxlang-repl-variables", { treeDataProvider: provider, showCollapseAll: true });
    let previousStatus = session.status;
    const status = () => {
        view.description = session.status;
        view.message = session.status === "Stopped" || session.status === "Failed"
            ? "Run BoxLang code to inspect this session's variables."
            : "Scopes and last result · up to 100 children per level · 2 KB previews";
    };
    status();
    context.subscriptions.push(provider, view,
        view.onDidExpandElement(({ element }) => provider.setExpanded(element, true)),
        view.onDidCollapseElement(({ element }) => provider.setExpanded(element, false)),
        session.onDidChange(event => {
            if ("status" in event) {
                status();
                if (event.status === "Stopped" || event.status === "Failed") provider.refresh(true);
                else if (event.status === "Ready" && previousStatus === "Starting") provider.refresh();
                previousStatus = event.status;
            } else if (event.state === "Completed" || event.state === "Failed") provider.refresh();
        }),
        vscode.commands.registerCommand("boxlang.refreshREPLVariables", () => provider.refresh()),
        vscode.commands.registerCommand("boxlang.copyREPLValue", (node?: VariableNode) => {
            return node ? vscode.env.clipboard.writeText(node.variable.value) : undefined;
        }),
        vscode.commands.registerCommand("boxlang.copyREPLPath", (node?: VariableNode) => {
            return node ? vscode.env.clipboard.writeText(JSON.stringify({ scope: node.scope, executionId: node.executionId, path: node.path })) : undefined;
        })
    );
}
