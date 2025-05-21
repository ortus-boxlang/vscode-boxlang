import * as vscode from 'vscode';

import { getServerData, onDidChangeServerConfiguration } from '../utils/Server';

const editableProperties = {
    "directory": true,
    "type": false,
    "status": false,
    "port": true,
    "debugMode": true,
    "configFile": true,
    "rewrites": true
};

const _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
export const onDidChangeTreeData: vscode.Event<void> = _onDidChangeTreeData.event;
let servers = {};
onDidChangeServerConfiguration((data) => {
    servers = data;
    _onDidChangeTreeData.fire();
});

export function boxlangServerTreeDataProvider(): vscode.TreeDataProvider<{ key: string }> {
    return {
        onDidChangeTreeData: onDidChangeTreeData as  any,
        getChildren: (element: { key: string }): { key: string }[] => {
            return !element ? Object.keys(servers).map(s => ({ key: s }))
                : [
                    { key: element.key + ".directory" },
                    { key: element.key + ".type" },
                    { key: element.key + ".status" },
                    { key: element.key + ".port" },
                    { key: element.key + ".debugMode" },
                    { key: element.key + ".configFile" },
                    { key: element.key + ".rewrites" }
                ];
        },
        getTreeItem: (element: { key: string }): vscode.TreeItem => {
            const parts = element.key.split(".");
            const server = getServerData(parts[0]);
            const isServerElement = parts.length === 1;
            const label = parts[parts.length - 1];
            const status = server.status;
            const description = isServerElement ? status : "" + servers[parts[0]][parts[1]];

            return {
                id: element.key,
                label: label,
                description: description,
                collapsibleState: parts.length === 1 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                contextValue: getContextValue(server, parts)
            };
        },
        getParent: ({ key }: { key: string }): { key: string } | undefined => {
            const parts = key.split(".");

            return parts.length === 1 ? null : servers[parts[0]];
        }
    };
}

function getContextValue(server, keyParts) {
    if (keyParts.length === 1) {
        return server.status === "stopped" ? "boxlangServerStoppedContext" : "boxlangServerRunningContext"
    }

    return editableProperties[keyParts[1]] ? "editableBoxlangServerPropertyContext" : "constantBoxlangServerPropertyContext";
}