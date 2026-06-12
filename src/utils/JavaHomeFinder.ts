import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { boxlangOutputChannel } from "./OutputChannels";

/**
 * Find the Java home directory by scanning for bin/java executable.
 *
 * Adoptium archives extract to different structures depending on OS and format:
 *   - Linux/macOS tar.gz: jdk-21.0.3+9/bin/java (flat structure)
 *   - Windows zip: jdk-21.0.3+9/bin/java.exe (flat structure)
 *   - macOS pkg (rare): Contents/Home/bin/java
 *
 * This function searches multiple strategies to locate the Java home.
 *
 * @param extractedPath The root directory where the archive was extracted
 * @returns The path to the Java home directory, or null if not found
 */
export async function findJavaHome(extractedPath: string): Promise<string | null> {
    const javaBinary = process.platform === "win32" ? "java.exe" : "java";

    boxlangOutputChannel.appendLine(`[findJavaHome] Searching for bin/${javaBinary} in ${extractedPath}`);

    // Strategy 1: Check if bin/java exists directly in extractedPath
    const directBinJava = path.join(extractedPath, "bin", javaBinary);
    if (fs.existsSync(directBinJava)) {
        boxlangOutputChannel.appendLine(`[findJavaHome] ✓ Found Java home directly: ${extractedPath}`);
        return extractedPath;
    }

    // Strategy 2: Check one level deep (e.g., jdk-21.0.3+9/bin/java)
    try {
        const children = await fsp.readdir(extractedPath, { withFileTypes: true });
        boxlangOutputChannel.appendLine(`[findJavaHome] Found ${children.length} children in ${extractedPath}`);

        for (const child of children) {
            if (child.isDirectory()) {
                const candidatePath = path.join(extractedPath, child.name);

                // Check for standard structure: jdk-version/bin/java
                const candidateBinJava = path.join(candidatePath, "bin", javaBinary);
                if (fs.existsSync(candidateBinJava)) {
                    boxlangOutputChannel.appendLine(`[findJavaHome] ✓ Found Java home in subdirectory: ${candidatePath}`);
                    return candidatePath;
                }

                // Check for macOS pkg structure: jdk-version/Contents/Home/bin/java
                const contentsHomePath = path.join(candidatePath, "Contents", "Home");
                const contentsHomeBinJava = path.join(contentsHomePath, "bin", javaBinary);
                if (fs.existsSync(contentsHomeBinJava)) {
                    boxlangOutputChannel.appendLine(`[findJavaHome] ✓ Found Java home in Contents/Home structure: ${contentsHomePath}`);
                    return contentsHomePath;
                }
            }
        }
    } catch (e) {
        boxlangOutputChannel.appendLine(`[findJavaHome] Error reading directory: ${e.message}`);
    }

    // Strategy 3: Check Contents/Home directly in extractedPath (macOS pkg)
    const contentsHomePath = path.join(extractedPath, "Contents", "Home");
    const contentsHomeBinJava = path.join(contentsHomePath, "bin", javaBinary);
    if (fs.existsSync(contentsHomeBinJava)) {
        boxlangOutputChannel.appendLine(`[findJavaHome] ✓ Found Java home in Contents/Home: ${contentsHomePath}`);
        return contentsHomePath;
    }

    boxlangOutputChannel.appendLine(`[findJavaHome] ✗ Could not find bin/${javaBinary} in any expected location`);
    return null;
}

/**
 * Verify that a given path is a valid Java home by checking for bin/java
 *
 * @param javaHomePath The path to verify
 * @returns true if bin/java exists at the path
 */
export function isValidJavaHome(javaHomePath: string): boolean {
    const javaBinary = process.platform === "win32" ? "java.exe" : "java";
    const binJavaPath = path.join(javaHomePath, "bin", javaBinary);
    return fs.existsSync(binJavaPath);
}
