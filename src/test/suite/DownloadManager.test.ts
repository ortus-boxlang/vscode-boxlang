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
