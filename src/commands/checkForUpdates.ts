import * as vscode from "vscode";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { checkAllUpdates, resetAllCooldowns } from "../utils/UpdateManager";

export async function checkForUpdates(): Promise<void> {
    boxlangOutputChannel.appendLine("BoxLang: Checking for updates (user-initiated)...");
    boxlangOutputChannel.show(true);

    await vscode.window.withProgress(
        { title: "BoxLang: Checking for updates...", location: vscode.ProgressLocation.Notification },
        async () => {
            await resetAllCooldowns();
            await checkAllUpdates(true);
        }
    );

    boxlangOutputChannel.appendLine("BoxLang: Update check complete.");
}
