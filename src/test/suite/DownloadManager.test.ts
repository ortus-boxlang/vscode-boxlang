import * as assert from 'assert';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { PassThrough } from 'stream';
import { DownloadManager } from '../../utils/DownloadManager';

suite('DownloadManager Test Suite', () => {
    // @ts-ignore - stub variable used for axios mocking in tests
    let axiosStub: sinon.SinonStub | undefined;
    const testTempDir = path.join(__dirname, 'temp-test');

    setup(() => {
        // Create temp directory for tests
        if (!fs.existsSync(testTempDir)) {
            fs.mkdirSync(testTempDir, { recursive: true });
        }
    });

    teardown(() => {
        sinon.restore();
        axiosStub = undefined; // Clear stub reference
        // Clean up temp directory
        if (fs.existsSync(testTempDir)) {
            fs.rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    suite('listS3BoxLangVersions', () => {
        test('should parse S3 XML response and return versions', async () => {
            const mockXMLResponse = `<?xml version="1.0" encoding="UTF-8"?>
                <ListBucketResult>
                    <Contents>
                        <Key>ortussolutions/boxlang/1.9.0/boxlang-1.9.0.jar</Key>
                        <LastModified>2024-01-15T10:00:00.000Z</LastModified>
                        <ETag>&quot;runtime-hash&quot;</ETag>
                    </Contents>
                    <Contents>
                        <Key>ortussolutions/boxlang/1.8.0/boxlang-1.8.0.jar</Key>
                        <LastModified>2024-01-01T10:00:00.000Z</LastModified>
                    </Contents>
                    <Contents>
                        <Key>ortussolutions/boxlang/1.9.0/boxlang-1.9.0-javadoc.jar</Key>
                        <LastModified>2024-01-15T10:00:00.000Z</LastModified>
                    </Contents>
                </ListBucketResult>`;

            axiosStub = sinon.stub(axios, 'get').resolves({ data: mockXMLResponse });

            const versions = await DownloadManager.listS3BoxLangVersions();

            assert.strictEqual(versions.length, 2); // javadoc should be filtered out
            assert.strictEqual(versions[0].version, '1.9.0');
            assert.strictEqual(versions[1].version, '1.8.0');
            assert.ok(versions[0].url.includes('boxlang-1.9.0.jar'));
            assert.ok(versions[0].date instanceof Date);
            assert.strictEqual(versions[0].etag, '&quot;runtime-hash&quot;');
        });

        test('should filter out non-JAR files', async () => {
            const mockXMLResponse = `<?xml version="1.0" encoding="UTF-8"?>
                <ListBucketResult>
                    <Contents>
                        <Key>ortussolutions/boxlang/1.9.0/boxlang-1.9.0.jar</Key>
                        <LastModified>2024-01-15T10:00:00.000Z</LastModified>
                    </Contents>
                    <Contents>
                        <Key>ortussolutions/boxlang/1.9.0/README.md</Key>
                        <LastModified>2024-01-15T10:00:00.000Z</LastModified>
                    </Contents>
                </ListBucketResult>`;

            axiosStub = sinon.stub(axios, 'get').resolves({ data: mockXMLResponse });

            const versions = await DownloadManager.listS3BoxLangVersions();

            assert.strictEqual(versions.length, 1);
            assert.strictEqual(versions[0].version, '1.9.0');
        });

        test('should handle S3 errors gracefully', async () => {
            axiosStub = sinon.stub(axios, 'get').rejects(new Error('Network error'));

            await assert.rejects(
                async () => await DownloadManager.listS3BoxLangVersions(),
                /Failed to fetch BoxLang versions from S3/
            );
        });

        test('should sort versions by date (newest first)', async () => {
            const mockXMLResponse = `<?xml version="1.0" encoding="UTF-8"?>
                <ListBucketResult>
                    <Contents>
                        <Key>ortussolutions/boxlang/1.8.0/boxlang-1.8.0.jar</Key>
                        <LastModified>2024-01-01T10:00:00.000Z</LastModified>
                    </Contents>
                    <Contents>
                        <Key>ortussolutions/boxlang/1.9.0/boxlang-1.9.0.jar</Key>
                        <LastModified>2024-01-15T10:00:00.000Z</LastModified>
                    </Contents>
                </ListBucketResult>`;

            axiosStub = sinon.stub(axios, 'get').resolves({ data: mockXMLResponse });

            const versions = await DownloadManager.listS3BoxLangVersions();

            assert.strictEqual(versions[0].version, '1.9.0'); // Newest first
            assert.strictEqual(versions[1].version, '1.8.0');
        });
    });

    for (const method of ['listS3BoxLangVersions', 'listS3MiniServerVersions'] as const) {
        test(`${method} retries once with a longer timeout and logs the URL and attempts`, async () => {
            const output = sinon.spy(require('../../utils/OutputChannels').boxlangOutputChannel, 'appendLine');
            const fetch = sinon.stub(axios, 'get');
            fetch.onFirstCall().rejects(new Error('timeout'));
            fetch.onSecondCall().resolves({ data: '<ListBucketResult></ListBucketResult>' });

            await DownloadManager[method]();

            assert.strictEqual(fetch.callCount, 2);
            const url = fetch.firstCall.args[0];
            assert.strictEqual(fetch.secondCall.args[0], url);
            assert.strictEqual(fetch.firstCall.args[1].timeout, 30000);
            const logs = output.getCalls().map(call => String(call.args[0]));
            assert.ok(logs.some(line => line.includes(url) && line.includes('Failed') && line.includes('attempt=1/2')));
            assert.ok(logs.some(line => line.includes(url) && line.includes('attempt=2/2')));
        });

        test(`${method} stops after two failed attempts and reports the URL`, async () => {
            const fetch = sinon.stub(axios, 'get').rejects(new Error('timeout'));

            await assert.rejects(DownloadManager[method](), error =>
                String(error).includes('after 2 attempts') && String(error).includes(fetch.firstCall.args[0]));
            assert.strictEqual(fetch.callCount, 2);
        });
    }

    test('S3 pagination retries only the failed page', async () => {
        const fetch = sinon.stub(axios, 'get');
        fetch.onCall(0).resolves({ data: '<ListBucketResult><NextContinuationToken>page2</NextContinuationToken></ListBucketResult>' });
        fetch.onCall(1).rejects(new Error('timeout'));
        fetch.onCall(2).resolves({ data: '<ListBucketResult><Contents><Key>ortussolutions/boxlang/1.18.0/boxlang-1.18.0.jar</Key></Contents></ListBucketResult>' });

        const versions = await DownloadManager.listS3BoxLangVersions();

        assert.strictEqual(versions[0].version, '1.18.0');
        assert.strictEqual(fetch.callCount, 3);
        assert.ok(fetch.getCall(1).args[0].includes('continuation-token=page2'));
        assert.strictEqual(fetch.getCall(2).args[0], fetch.getCall(1).args[0]);
    });

    suite('downloadFile', () => {
        test('should report download progress', async () => {
            const progressUpdates: any[] = [];
            const mockStream = new PassThrough();

            axiosStub = sinon.stub(axios, 'request').resolves({
                data: mockStream,
                headers: { 'content-length': '100' }
            });

            setTimeout(() => {
                mockStream.write(Buffer.alloc(50));
                mockStream.write(Buffer.alloc(50));
                mockStream.end();
            }, 10);

            await DownloadManager.downloadFile(
                'https://example.com/test.jar',
                path.join(testTempDir, 'test.jar'),
                {
                    onProgress: (progress) => {
                        progressUpdates.push(progress);
                    }
                }
            );

            // Progress should have been called
            assert.ok(progressUpdates.length > 0);
        });

        test('should retry on failure', async () => {
            let attemptCount = 0;
            axiosStub = sinon.stub(axios, 'request').callsFake(() => {
                attemptCount++;
                if (attemptCount < 2) {
                    return Promise.reject(new Error('Network error'));
                }
                // Succeed on second attempt
                const mockStream = new PassThrough();
                setTimeout(() => {
                    mockStream.end(Buffer.alloc(100));
                }, 10);
                return Promise.resolve({
                    data: mockStream,
                    headers: { 'content-length': '100' }
                });
            });

            await DownloadManager.downloadFile(
                'https://example.com/test.jar',
                path.join(testTempDir, 'test.jar'),
                { maxRetries: 3 }
            );

            assert.strictEqual(attemptCount, 2);
        });

        test('should fail after max retries', async () => {
            axiosStub = sinon.stub(axios, 'request').rejects(new Error('Network error'));

            await assert.rejects(
                async () => await DownloadManager.downloadFile(
                    'https://example.com/test.jar',
                    path.join(testTempDir, 'test.jar'),
                    { maxRetries: 2 }
                ),
                /Failed to download after 2 attempts/
            );
        });
    });

    suite('downloadAndExtract', () => {
        test('should detect ZIP archive from URL', async () => {
            const url = 'https://example.com/module.zip';
            const downloadStub = sinon.stub(DownloadManager, 'downloadAndExtractZip').resolves();

            await DownloadManager.downloadAndExtract(url, testTempDir);

            assert.ok(downloadStub.calledOnce);
            assert.ok(downloadStub.calledWith(url, testTempDir));
        });

        test('detects archives when the download URL has query parameters', async () => {
            const url = 'https://storage.example/module.zip?signature=test';
            const downloadStub = sinon.stub(DownloadManager, 'downloadAndExtractZip').resolves();

            await DownloadManager.downloadAndExtract(url, testTempDir);

            assert.ok(downloadStub.calledOnce);
            assert.ok(downloadStub.calledWith(url, testTempDir));
        });

        test('should detect tar.gz archive from URL', async () => {
            const url = 'https://example.com/module.tar.gz';
            const downloadStub = sinon.stub(DownloadManager, 'downloadAndExtractTarGz').resolves();

            await DownloadManager.downloadAndExtract(url, testTempDir);

            assert.ok(downloadStub.calledOnce);
            assert.ok(downloadStub.calledWith(url, testTempDir));
        });

        test('should handle JAR files without extraction', async () => {
            const url = 'https://example.com/boxlang.jar';
            const downloadStub = sinon.stub(DownloadManager, 'downloadFile').resolves();

            await DownloadManager.downloadAndExtract(url, testTempDir);

            assert.ok(downloadStub.calledOnce);
            const destPath = downloadStub.firstCall.args[1];
            assert.ok(destPath.endsWith('boxlang.jar'));
        });

        test('should throw error for unsupported archive type', async () => {
            const url = 'https://example.com/module.rar';

            await assert.rejects(
                async () => await DownloadManager.downloadAndExtract(url, testTempDir),
                /Unsupported archive type/
            );
        });
    });

    suite('listS3MiniServerVersions', () => {
        test('returns S3 ETags with MiniServer versions', async () => {
            const mockXMLResponse = `<?xml version="1.0" encoding="UTF-8"?>
                <ListBucketResult>
                    <Contents>
                        <Key>ortussolutions/boxlang-runtimes/boxlang-miniserver/1.17.6/boxlang-miniserver-1.17.6.jar</Key>
                        <LastModified>2026-09-25T23:39:31.000Z</LastModified>
                        <ETag>&quot;mini-hash-2&quot;</ETag>
                    </Contents>
                </ListBucketResult>`;
            axiosStub = sinon.stub(axios, 'get').resolves({ data: mockXMLResponse });

            const versions = await DownloadManager.listS3MiniServerVersions();

            assert.strictEqual(versions[0].version, '1.17.6');
            assert.strictEqual(versions[0].etag, '&quot;mini-hash-2&quot;');
        });
    });

    suite('downloadBoxLangVersion', () => {
        test('should construct correct S3 URL for version', async () => {
            const downloadStub = sinon.stub(DownloadManager, 'downloadFile').resolves();

            await DownloadManager.downloadBoxLangVersion('1.9.0', '/path/to/dest.jar');

            assert.ok(downloadStub.calledOnce);
            const url = downloadStub.firstCall.args[0];
            assert.ok(url.includes('ortussolutions/boxlang/1.9.0/boxlang-1.9.0.jar'));
        });
    });

    suite('downloadMiniServer', () => {
        test('should construct correct S3 URL for MiniServer', async () => {
            const downloadStub = sinon.stub(DownloadManager, 'downloadFile').resolves();

            await DownloadManager.downloadMiniServer('1.9.0', '/path/to/dest.jar');

            assert.ok(downloadStub.calledOnce);
            const url = downloadStub.firstCall.args[0];
            assert.ok(url.includes('boxlang-runtimes/boxlang-miniserver/1.9.0'));
        });
    });
});
