import axios from "axios";
import * as crypto from "crypto";
import extract from "extract-zip";
import * as fs from "fs";
import * as path from "path";
import * as tar from "tar";

// Conditional import for VS Code output channel
let boxlangOutputChannel: any;
try {
    boxlangOutputChannel = require("./OutputChannels").boxlangOutputChannel;
} catch (e) {
    // Fallback for testing without VS Code
    boxlangOutputChannel = {
        appendLine: (msg: string) => console.log(msg),
        append: (msg: string) => process.stdout.write(msg)
    };
}

export interface DownloadProgress {
    downloaded: number;
    total: number;
    percentage: number;
}

export interface DownloadOptions {
    onProgress?: (progress: DownloadProgress) => void;
    timeout?: number;
    maxRetries?: number;
}

/**
 * Unified download manager for BoxLang versions, modules, and dependencies
 * Replaces scattered download logic across install-scripts and utils
 */
export class DownloadManager {
    private static readonly DEFAULT_TIMEOUT = 120000; // 2 minutes
    private static readonly DEFAULT_RETRIES = 3;

    /**
     * Download a file from URL to destination
     * @param url - Source URL
     * @param destPath - Destination file path
     * @param options - Download options
     */
    static async downloadFile(
        url: string,
        destPath: string,
        options: DownloadOptions = {}
    ): Promise<void> {
        const { onProgress, timeout = this.DEFAULT_TIMEOUT, maxRetries = this.DEFAULT_RETRIES } = options;

        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                boxlangOutputChannel.appendLine(`Downloading: ${url} (attempt ${attempt}/${maxRetries})`);

                const response = await axios({
                    method: "GET",
                    url,
                    responseType: "stream",
                    timeout,
                    headers: {
                        "User-Agent": "vscode-boxlang"
                    }
                });

                const totalSize = parseInt(response.headers["content-length"] || "0", 10);
                let downloadedSize = 0;

                // Ensure directory exists
                await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

                const writer = fs.createWriteStream(destPath);

                response.data.on("data", (chunk: Buffer) => {
                    downloadedSize += chunk.length;
                    if (onProgress && totalSize > 0) {
                        onProgress({
                            downloaded: downloadedSize,
                            total: totalSize,
                            percentage: (downloadedSize / totalSize) * 100
                        });
                    }
                });

                response.data.pipe(writer);

                await new Promise<void>((resolve, reject) => {
                    writer.on("finish", resolve);
                    writer.on("error", reject);
                    response.data.on("error", reject);
                });

                boxlangOutputChannel.appendLine(`Downloaded successfully: ${destPath}`);
                return;

            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                boxlangOutputChannel.appendLine(`Download failed (attempt ${attempt}): ${lastError.message}`);

                // Clean up partial download
                try {
                    if (fs.existsSync(destPath)) {
                        await fs.promises.unlink(destPath);
                    }
                } catch {}

                if (attempt < maxRetries) {
                    // Exponential backoff
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`Failed to download after ${maxRetries} attempts: ${lastError?.message}`);
    }

    /**
     * Download and extract a ZIP archive
     * @param url - Source URL
     * @param destDir - Destination directory
     * @param options - Download options
     */
    static async downloadAndExtractZip(
        url: string,
        destDir: string,
        options: DownloadOptions = {}
    ): Promise<void> {
        const tempFile = path.join(destDir, `download_${crypto.randomBytes(8).toString("hex")}.zip`);

        try {
            // Download to temp location
            await this.downloadFile(url, tempFile, options);

            // Extract
            boxlangOutputChannel.appendLine(`Extracting ZIP to: ${destDir}`);
            await fs.promises.mkdir(destDir, { recursive: true });

            await extract(tempFile, { dir: path.resolve(destDir) });

            boxlangOutputChannel.appendLine(`Extraction complete: ${destDir}`);
        } finally {
            // Clean up temp file
            try {
                if (fs.existsSync(tempFile)) {
                    await fs.promises.unlink(tempFile);
                }
            } catch (error) {
                boxlangOutputChannel.appendLine(`Failed to clean up temp file: ${tempFile}`);
            }
        }
    }

    /**
     * Download and extract a tar.gz archive
     * @param url - Source URL
     * @param destDir - Destination directory
     * @param options - Download options
     */
    static async downloadAndExtractTarGz(
        url: string,
        destDir: string,
        options: DownloadOptions = {}
    ): Promise<void> {
        const tempFile = path.join(destDir, `download_${crypto.randomBytes(8).toString("hex")}.tar.gz`);

        try {
            // Download to temp location
            await this.downloadFile(url, tempFile, options);

            // Extract
            boxlangOutputChannel.appendLine(`Extracting tar.gz to: ${destDir}`);
            await fs.promises.mkdir(destDir, { recursive: true });

            await tar.x({
                file: tempFile,
                cwd: destDir,
                strip: 1 // Remove top-level directory
            });

            boxlangOutputChannel.appendLine(`Extraction complete: ${destDir}`);
        } finally {
            // Clean up temp file
            try {
                if (fs.existsSync(tempFile)) {
                    await fs.promises.unlink(tempFile);
                }
            } catch (error) {
                boxlangOutputChannel.appendLine(`Failed to clean up temp file: ${tempFile}`);
            }
        }
    }

    /**
     * Smart download and extract - detects archive type from URL
     */
    static async downloadAndExtract(
        url: string,
        destDir: string,
        options: DownloadOptions = {}
    ): Promise<void> {
        const urlLower = url.toLowerCase();

        if (urlLower.endsWith(".zip")) {
            await this.downloadAndExtractZip(url, destDir, options);
        } else if (urlLower.endsWith(".tar.gz") || urlLower.endsWith(".tgz")) {
            await this.downloadAndExtractTarGz(url, destDir, options);
        } else if (urlLower.endsWith(".jar")) {
            // JAR files don't need extraction
            const fileName = path.basename(new URL(url).pathname);
            await this.downloadFile(url, path.join(destDir, fileName), options);
        } else {
            throw new Error(`Unsupported archive type: ${url}`);
        }
    }

    /**
     * List available BoxLang versions from S3 (without AWS SDK)
     * Replaces AWS SDK usage in VersionManager.ts
     */
    static async listS3BoxLangVersions(): Promise<Array<{ version: string; url: string; date: Date }>> {
        const bucketUrl = "https://downloads.ortussolutions.com";
        const prefix = "ortussolutions/boxlang";

        try {
            // Use S3 REST API directly - no authentication needed for public bucket
            const listUrl = `https://s3.amazonaws.com/downloads.ortussolutions.com?list-type=2&prefix=${encodeURIComponent(prefix)}`;

            const response = await axios.get(listUrl, {
                timeout: 10000,
                headers: {
                    "Accept": "application/xml"
                }
            });

            // Parse XML response
            const versions: Array<{ version: string; url: string; date: Date }> = [];
            const keyMatches = response.data.matchAll(/<Key>([^<]+)<\/Key>/g);
            const dateMatches = response.data.matchAll(/<LastModified>([^<]+)<\/LastModified>/g);

            const keys = Array.from(keyMatches).map(m => m[1]);
            const dates = Array.from(dateMatches).map(m => m[1]);

            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];

                // Filter: only .jar files, exclude javadoc
                if (!key.endsWith(".jar") || key.includes("javadoc")) {
                    continue;
                }

                // Extract version from path: ortussolutions/boxlang/1.9.0/boxlang-1.9.0.jar
                const versionMatch = key.match(/boxlang\/([^/]+)\//);
                if (!versionMatch) {
                    continue;
                }

                versions.push({
                    version: versionMatch[1],
                    url: `${bucketUrl}/${key}`,
                    date: new Date(dates[i] || new Date())
                });
            }

            // Sort by date (newest first)
            versions.sort((a, b) => b.date.getTime() - a.date.getTime());

            return versions;

        } catch (error) {
            boxlangOutputChannel.appendLine(`Failed to list S3 versions: ${error}`);
            throw new Error(`Failed to fetch BoxLang versions from S3: ${error}`);
        }
    }

    /**
     * Download BoxLang JAR from S3
     */
    static async downloadBoxLangVersion(
        version: string,
        destPath: string,
        options: DownloadOptions = {}
    ): Promise<void> {
        const url = `https://downloads.ortussolutions.com/ortussolutions/boxlang/${version}/boxlang-${version}.jar`;
        await this.downloadFile(url, destPath, options);
    }

    /**
     * Download MiniServer JAR from S3
     */
    static async downloadMiniServer(
        version: string,
        destPath: string,
        options: DownloadOptions = {}
    ): Promise<void> {
        const url = `https://downloads.ortussolutions.com/ortussolutions/boxlang-runtimes/boxlang-miniserver/${version}/boxlang-miniserver-${version}.jar`;
        await this.downloadFile(url, destPath, options);
    }
}
