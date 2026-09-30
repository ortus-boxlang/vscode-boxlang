import { createHash, randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import semver from "semver";

export type LSPBuild = {
    versionSpec: string;
    relativePath: string;
    binaryHash?: string;
    updatedDate?: string;
};

type BuildMetadata = { binaryHash?: string; updatedDate?: string; forceRefresh?: boolean };
export type LSPUpdateChannel = "stable" | "prerelease";
export type LSPUpdate = LSPBuild & { generation: string; timing: "now" | "restart"; approved: boolean };

export function getLSPUpdateChannel(extensionVersion: string): LSPUpdateChannel {
    return (semver.parse(extensionVersion)?.minor ?? 0) % 2 === 1 ? "prerelease" : "stable";
}

export async function readLSPUpdate(storagePath: string, channel: LSPUpdateChannel): Promise<LSPUpdate | undefined> {
    let update: LSPUpdate;
    try {
        update = JSON.parse(await fs.readFile(path.join(storagePath, "updates", `lsp-${channel}.json`), "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
    }
    if (!update || typeof update.versionSpec !== "string" || !update.versionSpec.startsWith("bx-lsp@")
        || !semver.valid(update.versionSpec.slice(7)) || typeof update.relativePath !== "string"
        || typeof update.generation !== "string" || typeof update.approved !== "boolean" || !["now", "restart"].includes(update.timing)) {
        throw new Error("Invalid shared LSP update manifest");
    }
    const modulePath = path.resolve(storagePath, update.relativePath);
    const buildParent = path.resolve(storagePath, "lspBuilds", update.versionSpec) + path.sep;
    const legacyPath = path.resolve(storagePath, "lspVersions", update.versionSpec);
    if (path.isAbsolute(update.relativePath) || (!modulePath.startsWith(buildParent) && modulePath !== legacyPath)) {
        throw new Error("Shared LSP installation is outside its version cache");
    }
    return await validInstallation(modulePath) ? update : undefined;
}

export async function publishLSPUpdate(
    storagePath: string,
    channel: LSPUpdateChannel,
    build: LSPBuild,
    timing: "now" | "restart",
    approved = false
): Promise<LSPUpdate> {
    if (!await validInstallation(path.join(storagePath, build.relativePath))) {
        throw new Error("Cannot publish an incomplete LSP installation");
    }
    const directory = path.join(storagePath, "updates");
    await fs.mkdir(directory, { recursive: true });
    const update: LSPUpdate = {
        versionSpec: build.versionSpec,
        relativePath: build.relativePath,
        ...(build.binaryHash ? { binaryHash: build.binaryHash } : {}),
        ...(build.updatedDate ? { updatedDate: build.updatedDate } : {}),
        timing,
        approved,
        generation: randomUUID()
    };
    const manifest = path.join(directory, `lsp-${channel}.json`);
    const temporary = `${manifest}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, JSON.stringify(update));
        await fs.rename(temporary, manifest);
    } finally {
        await fs.rm(temporary, { force: true });
    }
    return update;
}

async function validInstallation(directory: string): Promise<boolean> {
    try {
        const boxJson = JSON.parse(await fs.readFile(path.join(directory, "bx-lsp", "box.json"), "utf8"));
        return boxJson !== null && typeof boxJson === "object" && !Array.isArray(boxJson);
    } catch {
        return false;
    }
}

/** Exclusive across extension hosts, unlike an in-memory flag or globalState. */
export async function withLSPUpdateLock<T>(
    storagePath: string,
    key: string,
    operation: () => Promise<T>,
    wait = false
): Promise<T | undefined> {
    if (!/^[a-z0-9-]+$/.test(key)) throw new Error("Invalid LSP lock key");
    const directory = path.join(storagePath, "updates");
    await fs.mkdir(directory, { recursive: true });
    const lockPath = path.join(directory, `${key}.lock`);
    const deadline = Date.now() + 5 * 60 * 1000;
    const removeEmptyLock = async () => {
        try { await fs.rmdir(lockPath); }
        catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
    };

    while (true) {
        try {
            await fs.mkdir(lockPath);
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            let reclaimed = false;
            try {
                const owners = await fs.readdir(lockPath);
                if (!owners.length && Date.now() - (await fs.stat(lockPath)).mtimeMs > 30000) {
                    await removeEmptyLock();
                    continue;
                }
                for (const owner of owners) {
                    const pid = Number(/^(\d+)-/.exec(owner)?.[1]);
                    let abandoned = false;
                    if (Number.isInteger(pid) && pid > 0) {
                        // ponytail: PID-only recovery; include process start identity if PID reuse delays recovery.
                        try { process.kill(pid, 0); }
                        catch (probeError) { abandoned = probeError.code === "ESRCH"; }
                    }
                    if (abandoned) {
                        // Remove only this owner's unique token. A concurrent successor's token
                        // prevents rmdir, so stale recovery cannot delete its live lock.
                        await fs.rm(path.join(lockPath, owner), { force: true });
                        reclaimed = true;
                    }
                }
                if (reclaimed) { await removeEmptyLock(); continue; }
            } catch (readError) {
                if (readError.code === "ENOENT") continue;
                throw readError;
            }
            if (!wait) return undefined;
            if (Date.now() >= deadline) throw new Error("Timed out waiting for the shared LSP installation");
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
        }

        const token = `${process.pid}-${randomUUID()}.json`;
        const ownerPath = path.join(lockPath, token);
        let acquired = false;
        try {
            await fs.writeFile(ownerPath, "", { flag: "wx", mode: 0o600 });
            const owners = await fs.readdir(lockPath);
            // If an empty abandoned directory was reclaimed during acquisition, don't
            // enter alongside its successor. Neither process can enter with two tokens.
            if (owners.length !== 1 || owners[0] !== token) continue;
            acquired = true;
            return await operation();
        } catch (error) {
            if (acquired || error.code !== "ENOENT") throw error;
        } finally {
            await fs.rm(ownerPath, { force: true });
            await removeEmptyLock();
        }
    }
}

/** Also used by startup and version pickers, which must see the same completed cache. */
export async function findInstalledLSPBuild(storagePath: string, versionSpec: string): Promise<LSPBuild | undefined> {
    if (!versionSpec.startsWith("bx-lsp@") || !semver.valid(versionSpec.slice(7))) {
        throw new Error(`Invalid LSP version: ${versionSpec}`);
    }
    const parentDir = path.join(storagePath, "lspBuilds", versionSpec);
    let entries: import("fs").Dirent[] = [];
    try { entries = await fs.readdir(parentDir, { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    let newest: { build: LSPBuild; installedAt: number } | undefined;
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const relativePath = path.join("lspBuilds", versionSpec, entry.name);
        const directory = path.join(storagePath, relativePath);
        try {
            const installed = JSON.parse(await fs.readFile(path.join(directory, "version.json"), "utf8"));
            if (installed.versionSpec !== versionSpec || installed.relativePath !== relativePath || !await validInstallation(directory)) continue;
            const installedAt = (await fs.stat(path.join(directory, "version.json"))).mtimeMs;
            if (!newest || installedAt > newest.installedAt) {
                newest = { build: { versionSpec, relativePath, binaryHash: installed.binaryHash, updatedDate: installed.updatedDate }, installedAt };
            }
        } catch { /* Ignore incomplete or damaged installs. */ }
    }
    if (newest) return newest.build;
    const relativePath = path.join("lspVersions", versionSpec);
    if (!await validInstallation(path.join(storagePath, relativePath))) return undefined;
    let installed: BuildMetadata = {};
    try { installed = JSON.parse(await fs.readFile(path.join(storagePath, relativePath, "version.json"), "utf8")); } catch { /* Legacy cache. */ }
    return { versionSpec, relativePath, binaryHash: installed.binaryHash, updatedDate: installed.updatedDate };
}

export async function listInstalledLSPBuilds(storagePath: string): Promise<LSPBuild[]> {
    const specs = new Set<string>();
    for (const directory of ["lspVersions", "lspBuilds"]) {
        let entries: import("fs").Dirent[] = [];
        try { entries = await fs.readdir(path.join(storagePath, directory), { withFileTypes: true }); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith("bx-lsp@") && semver.valid(entry.name.slice(7))) specs.add(entry.name);
        }
    }
    const builds = await Promise.all(Array.from(specs, spec => findInstalledLSPBuild(storagePath, spec)));
    return builds.filter((build): build is LSPBuild => build !== undefined);
}

/** Install off to the side; running windows keep their immutable build directories. */
// ponytail: retain old builds; prune only once no window can be using them if disk growth matters.
export async function installLSPBuild(
    storagePath: string,
    versionSpec: string,
    metadata: BuildMetadata,
    download: (directory: string) => Promise<unknown>
): Promise<LSPBuild> {
    if (!versionSpec.startsWith("bx-lsp@") || !semver.valid(versionSpec.slice(7))) {
        throw new Error(`Invalid LSP version: ${versionSpec}`);
    }
    const identity = metadata.binaryHash || metadata.updatedDate || (metadata.forceRefresh ? randomUUID() : "release");
    const buildId = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    const specId = createHash("sha256").update(versionSpec).digest("hex");
    return (await withLSPUpdateLock(storagePath, `lsp-install-${specId}`, async () => {
        const installed = !metadata.forceRefresh ? await findInstalledLSPBuild(storagePath, versionSpec) : undefined;
        if (installed && (!metadata.binaryHash || installed.binaryHash === metadata.binaryHash)
            && (!metadata.updatedDate || installed.updatedDate === metadata.updatedDate)) return installed;

        const parentDir = path.join(storagePath, "lspBuilds", versionSpec);
        let relativePath = path.join("lspBuilds", versionSpec, buildId);
        if (await validInstallation(path.join(storagePath, relativePath))) {
            return { versionSpec, relativePath, binaryHash: metadata.binaryHash, updatedDate: metadata.updatedDate };
        }
        // Don't overwrite a damaged build that might still be used by another window.
        try { await fs.access(path.join(storagePath, relativePath)); relativePath += `-${randomUUID()}`; } catch { /* Not installed. */ }
        await fs.mkdir(parentDir, { recursive: true });
        const stagingDir = await fs.mkdtemp(path.join(parentDir, ".install-"));
        try {
            await download(stagingDir);
            if (!await validInstallation(stagingDir)) throw new Error(`LSP installation is missing a valid bx-lsp/box.json: ${versionSpec}`);
            const build = { versionSpec, relativePath, binaryHash: metadata.binaryHash, updatedDate: metadata.updatedDate };
            await fs.writeFile(path.join(stagingDir, "version.json"), JSON.stringify({ ...build, installedAt: new Date().toISOString() }));
            await fs.rename(stagingDir, path.join(storagePath, relativePath));
            return build;
        } finally {
            await fs.rm(stagingDir, { recursive: true, force: true });
        }
    }, true))!;
}
