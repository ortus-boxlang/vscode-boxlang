
import vscode, { ExtensionContext } from "vscode";
import { boxlangOutputChannel } from "../utils/OutputChannels";
import { getBvmrcVersion } from "../utils/Configuration";
import { getDownloadedBoxLangVersions } from "../utils/versionManager";
import * as path from "path";

async function getConfiguredVersionName(): Promise<string> {
    try {
        // Get the current jar path from settings (without .bvmrc override)
        const jarPath = vscode.workspace.getConfiguration("boxlang").get<string>('jarpath');
        
        if (!jarPath) {
            return "Built-in";
        }

        // Try to find the version name from downloaded versions
        const downloadedVersions = await getDownloadedBoxLangVersions();
        const matchingVersion = downloadedVersions.find(v => v.jarPath === jarPath);
        
        if (matchingVersion) {
            // Remove "boxlang-" prefix if present for cleaner display
            return matchingVersion.name.replace(/^boxlang-/, "");
        }

        // If it's a custom path, try to extract version from filename
        const filename = path.basename(jarPath, '.jar');
        if (filename.includes('boxlang')) {
            return filename.replace(/^boxlang-?/, "") || "Custom";
        }

        return "Custom";
    } catch (error) {
        return "Default";
    }
}

async function getVersionDisplay(): Promise<string> {
    const bvmrcVersion = getBvmrcVersion();
    if (bvmrcVersion) {
        return `Current Version: ${bvmrcVersion} (from .bvmrc)`;
    }
    
    const configuredVersion = await getConfiguredVersionName();
    return `Current Version: ${configuredVersion} (from settings)`;
}

export async function showStatusBarCommandPicker(context: ExtensionContext) {
    const versionDisplay = await getVersionDisplay();
    
    const items = [
        {
            label: versionDisplay,
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