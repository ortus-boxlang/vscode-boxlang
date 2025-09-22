import { ExtensionContext } from "vscode";
import { getWorkspaceBvmrcVersion } from "./bvmrcParser";
import { setBvmrcVersion } from "./Configuration";
import { ensureBoxLangVersion } from "./versionManager";
import { updateVersionDisplay } from "../features/statusBar";
import { boxlangOutputChannel } from "./OutputChannels";

/**
 * Sets up .bvmrc support by checking for .bvmrc files in the workspace
 * and configuring the extension to use the specified BoxLang version
 * @param context The extension context
 */
export async function setupBvmrcSupport(context: ExtensionContext): Promise<void> {
    try {
        const bvmrcVersion = await getWorkspaceBvmrcVersion();
        
        if (bvmrcVersion) {
            boxlangOutputChannel.appendLine(`Detected .bvmrc with BoxLang version: ${bvmrcVersion}`);
            
            try {
                let jarPath: string;
                
                if (bvmrcVersion === "latest") {
                    // For "latest", we'll use the configured jar path or included jar
                    boxlangOutputChannel.appendLine("Using latest BoxLang version from configuration");
                    setBvmrcVersion(bvmrcVersion, null);
                } else {
                    // Try to ensure the specified version is available
                    jarPath = await ensureBoxLangVersion(bvmrcVersion);
                    boxlangOutputChannel.appendLine(`Using BoxLang version ${bvmrcVersion} from: ${jarPath}`);
                    setBvmrcVersion(bvmrcVersion, jarPath);
                }
                
                // Update the status bar to show the version
                updateVersionDisplay();
                
            } catch (error) {
                boxlangOutputChannel.appendLine(`Warning: Could not setup BoxLang version ${bvmrcVersion} from .bvmrc: ${error.toString()}`);
                boxlangOutputChannel.appendLine("Falling back to configured version");
                setBvmrcVersion(null, null);
            }
        } else {
            // No .bvmrc found, clear any previous version
            setBvmrcVersion(null, null);
        }
    } catch (error) {
        boxlangOutputChannel.appendLine(`Error setting up .bvmrc support: ${error.toString()}`);
        setBvmrcVersion(null, null);
    }
}