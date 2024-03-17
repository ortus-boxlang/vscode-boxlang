import * as vscode from "vscode";
import { BoxLang } from "../utils/BoxLang";


export class BoxLangDebugAdapter implements vscode.DebugAdapterDescriptorFactory {
    async createDebugAdapterDescriptor(session: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable | undefined): Promise<vscode.DebugAdapterDescriptor> {
        const port = await BoxLang.startDebugger();

        return new vscode.DebugAdapterServer(Number.parseInt(port), "localhost");
    }
}