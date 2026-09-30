import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const { installLSPBuild, listInstalledLSPBuilds, publishLSPUpdate, readLSPUpdate, withLSPUpdateLock } = require('../../utils/SharedLSPUpdates');

suite('Shared LSP updates', () => {
    let storagePath: string;

    setup(async () => {
        storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'boxlang-shared-lsp-'));
    });

    teardown(async () => {
        await fs.rm(storagePath, { recursive: true, force: true });
    });

    test('checks skip a live owner and can recover a lock left by a crashed owner', async () => {
        const result = await withLSPUpdateLock(storagePath, 'test-check', async () => {
            assert.strictEqual(await withLSPUpdateLock(storagePath, 'test-check', async () => 'duplicate'), undefined);
            return 'owner';
        });
        assert.strictEqual(result, 'owner');
        const abandoned = path.join(storagePath, 'updates', 'test-check.lock');
        await fs.mkdir(abandoned);
        await fs.writeFile(path.join(abandoned, '2147000000-dead.json'), '');
        assert.strictEqual(await withLSPUpdateLock(storagePath, 'test-check', async () => 'recovered'), 'recovered');
    });

    test('only validated, completed builds become visible to update consumers', async () => {
        const spec = 'bx-lsp@1.15.0-snapshot';
        await assert.rejects(installLSPBuild(storagePath, spec, {}, async () => {
            throw new Error('Download interrupted');
        }), /Download interrupted/);
        assert.strictEqual(await readLSPUpdate(storagePath, 'prerelease'), undefined);

        const build = await installLSPBuild(storagePath, spec, { binaryHash: 'ready' }, async directory => {
            assert.strictEqual(await readLSPUpdate(storagePath, 'prerelease'), undefined);
            await fs.mkdir(path.join(directory, 'bx-lsp'), { recursive: true });
            await fs.writeFile(path.join(directory, 'bx-lsp', 'box.json'), '{}');
        });
        const update = await publishLSPUpdate(storagePath, 'prerelease', build, 'now');
        assert.deepStrictEqual(await readLSPUpdate(storagePath, 'prerelease'), update);
        assert.strictEqual(await readLSPUpdate(storagePath, 'stable'), undefined);
        await fs.writeFile(path.join(storagePath, 'updates', 'lsp-prerelease.json'),
            JSON.stringify({ ...update, relativePath: '../outside-cache' }));
        await assert.rejects(readLSPUpdate(storagePath, 'prerelease'), /outside its version cache/);
    });

    test('a completed build is reused without another download and a new build preserves the old installation', async () => {
        let downloads = 0;
        const download = async (directory: string) => {
            downloads++;
            await fs.mkdir(path.join(directory, 'bx-lsp'), { recursive: true });
            await fs.writeFile(path.join(directory, 'bx-lsp', 'box.json'), '{}');
        };
        const spec = 'bx-lsp@1.15.0-snapshot';
        const [first, reused] = await Promise.all([
            installLSPBuild(storagePath, spec, { binaryHash: 'first' }, download),
            installLSPBuild(storagePath, spec, { binaryHash: 'first' }, download)
        ]);
        assert.deepStrictEqual(reused, first);
        assert.deepStrictEqual(await installLSPBuild(storagePath, spec, {}, download), first,
            'startup and manual selections reuse a completed build without needing network metadata');
        assert.strictEqual(downloads, 1);

        const next = await installLSPBuild(storagePath, spec, { binaryHash: 'next', forceRefresh: true }, download);
        assert.notStrictEqual(next.relativePath, first.relativePath);
        await fs.access(path.join(storagePath, first.relativePath, 'bx-lsp', 'box.json'));
        await fs.access(path.join(storagePath, next.relativePath, 'bx-lsp', 'box.json'));
        assert.strictEqual(downloads, 2);
        assert.deepStrictEqual(await listInstalledLSPBuilds(storagePath), [next], 'the version picker sees the newest completed build');
    });
});
