import * as vscode from "vscode";
import { boxLangLauncher } from "../utils/workspaceSetup";


export class BoxLangDebugAdapter implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable | undefined): Promise<vscode.DebugAdapterDescriptor> {
        const port = await boxLangLauncher.startDebugger();

        return new vscode.DebugAdapterServer(Number.parseInt(port), "localhost");
    }
}