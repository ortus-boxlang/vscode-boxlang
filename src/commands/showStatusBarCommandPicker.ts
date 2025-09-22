
import vscode, { ExtensionContext } from "vscode";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { getBvmrcVersion } from "../utils/Configuration";

function getVersionDisplay(): string {
    const bvmrcVersion = getBvmrcVersion();
    if (bvmrcVersion) {
        return `Current Version: ${bvmrcVersion} (from .bvmrc)`;
    }
    return "Current Version: Default (from settings)";
}

export async function showStatusBarCommandPicker(context: ExtensionContext) {
    const items = [
        {
            label: getVersionDisplay(),
            command: () => {
                // Do nothing, this is just for display
            }
        },
        {
            label: "Open BoxLang Settings",
            command: () => {
                vscode.commands.executeCommand("workbench.action.openSettings", "boxlang");
            }
        },
        {
            label: "Show BoxLang Output",
            command: () => {
                boxlangOutputChannel.show();
            }
        },
        {
            label: "Output Version Info",
            command: () => {
                vscode.commands.executeCommand( "boxlang.outputVersionInfo" );
            }
        },
        {
            label: "Open Documentation",
            command: () => {
                vscode.env.openExternal(vscode.Uri.parse("https://boxlang.ortusbooks.com/"))
            }
        }
    ];

    const picker = vscode.window.createQuickPick();
    picker.items = items;

    picker.onDidAccept(() => {
        const selection = picker.activeItems[0];

        if( selection ){
            (selection as any).command();
        }

        picker.hide()
    });

    picker.show();
}