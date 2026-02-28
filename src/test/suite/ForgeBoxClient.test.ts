import * as assert from 'assert';
import axios from 'axios';
import * as sinon from 'sinon';
import { ForgeBoxClient } from '../../utils/ForgeBoxClient';

suite('ForgeBoxClient Test Suite', () => {
    let axiosGetStub: sinon.SinonStub;
    let client: ForgeBoxClient;
    let mockAxiosInstance: any;

    setup(() => {
        // Create a mock axios instance with stubbed methods
        mockAxiosInstance = {
            get: sinon.stub()
        };

        // Stub axios.create to return our mock instance
        sinon.stub(axios, 'create').returns(mockAxiosInstance);

        // Now create the client, which will use our mocked axios instance
        client = new ForgeBoxClient();

        // Store reference to the get stub for easier access in tests
        axiosGetStub = mockAxiosInstance.get;
    });

    teardown(() => {
        sinon.restore();
    });

    suite('getModuleMetadata', () => {
        test('should fetch module metadata successfully', async () => {
            const mockResponse = {
                data: {
                    data: {
                        slug: 'bx-lsp',
                        title: 'BoxLang LSP',
                        summary: 'Language Server Protocol for BoxLang',
                        version: '1.5.0',
                        latestVersion: {
                            version: '1.5.0',
                            downloadURL: 'https://forgebox.io/downloads/bx-lsp/1.5.0',
                            isActive: true,
                            createDate: '2024-01-01'
                        },
                        versions: [
                            {
                                version: '1.5.0',
                                downloadURL: 'https://forgebox.io/downloads/bx-lsp/1.5.0',
                                isActive: true,
                                createDate: '2024-01-01'
                            },
                            {
                                version: '1.4.0',
                                downloadURL: 'https://forgebox.io/downloads/bx-lsp/1.4.0',
                                isActive: true,
                                createDate: '2023-12-01'
                            }
                        ]
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const result = await client.getModuleMetadata('bx-lsp');

            assert.strictEqual(result.slug, 'bx-lsp');
            assert.strictEqual(result.title, 'BoxLang LSP');
            assert.strictEqual(result.latestVersion.version, '1.5.0');
            assert.strictEqual(result.versions.length, 2);
            assert.ok(axiosGetStub.calledWith('/entry/bx-lsp'));
        });

        test('should throw error when module not found', async () => {
            axiosGetStub.rejects({
                isAxiosError: true,
                message: 'Not Found'
            });

            await assert.rejects(
                async () => await client.getModuleMetadata('nonexistent'),
                /Failed to fetch module 'nonexistent'/
            );
        });
    });

    suite('getDownloadURL', () => {
        test('should return latest version URL when version not specified', async () => {
            const mockResponse = {
                data: {
                    data: {
                        latestVersion: {
                            version: '1.5.0',
                            downloadURL: 'https://forgebox.io/downloads/bx-lsp/1.5.0'
                        },
                        versions: []
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const url = await client.getDownloadURL('bx-lsp');

            assert.strictEqual(url, 'https://forgebox.io/downloads/bx-lsp/1.5.0');
        });

        test('should return specific version URL when version specified', async () => {
            const mockResponse = {
                data: {
                    data: {
                        latestVersion: {
                            version: '1.5.0',
                            downloadURL: 'https://forgebox.io/downloads/bx-lsp/1.5.0'
                        },
                        versions: [
                            {
                                version: '1.5.0',
                                downloadURL: 'https://forgebox.io/downloads/bx-lsp/1.5.0'
                            },
                            {
                                version: '1.4.0',
                                downloadURL: 'https://forgebox.io/downloads/bx-lsp/1.4.0'
                            }
                        ]
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const url = await client.getDownloadURL('bx-lsp', '1.4.0');

            assert.strictEqual(url, 'https://forgebox.io/downloads/bx-lsp/1.4.0');
        });

        test('should throw error when specific version not found', async () => {
            const mockResponse = {
                data: {
                    data: {
                        versions: [
                            { version: '1.5.0', downloadURL: 'https://example.com/1.5.0' }
                        ]
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            await assert.rejects(
                async () => await client.getDownloadURL('bx-lsp', '2.0.0'),
                /Version 2.0.0 not found/
            );
        });
    });

    suite('listBoxLangModules', () => {
        test('should list all BoxLang modules', async () => {
            const mockResponse = {
                data: {
                    data: {
                        results: [
                            {
                                slug: 'bx-lsp',
                                title: 'BoxLang LSP',
                                summary: 'Language Server Protocol'
                            },
                            {
                                slug: 'bx-compat',
                                title: 'BoxLang Compat',
                                summary: 'Compatibility layer'
                            }
                        ]
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const modules = await client.listBoxLangModules();

            assert.strictEqual(modules.length, 2);
            assert.strictEqual(modules[0].slug, 'bx-lsp');
            assert.strictEqual(modules[1].slug, 'bx-compat');
            assert.ok(axiosGetStub.calledWith('/entries'));
        });

        test('should handle empty results', async () => {
            const mockResponse = {
                data: {
                    data: {
                        results: []
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const modules = await client.listBoxLangModules();

            assert.strictEqual(modules.length, 0);
        });
    });

    suite('searchModules', () => {
        test('should search modules by keyword', async () => {
            const mockResponse = {
                data: {
                    data: {
                        results: [
                            { slug: 'bx-lsp', title: 'LSP Module' }
                        ]
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const modules = await client.searchModules('lsp');

            assert.strictEqual(modules.length, 1);
            assert.strictEqual(modules[0].slug, 'bx-lsp');
        });
    });

    suite('getLatestVersion', () => {
        test('should return latest version string', async () => {
            const mockResponse = {
                data: {
                    data: {
                        latestVersion: {
                            version: '1.5.0'
                        }
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const version = await client.getLatestVersion('bx-lsp');

            assert.strictEqual(version, '1.5.0');
        });
    });

    suite('versionExists', () => {
        test('should return true when version exists', async () => {
            const mockResponse = {
                data: {
                    data: {
                        versions: [
                            { version: '1.5.0' },
                            { version: '1.4.0' }
                        ]
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const exists = await client.versionExists('bx-lsp', '1.4.0');

            assert.strictEqual(exists, true);
        });

        test('should return false when version does not exist', async () => {
            const mockResponse = {
                data: {
                    data: {
                        versions: [
                            { version: '1.5.0' }
                        ]
                    }
                }
            };

            axiosGetStub.resolves(mockResponse);

            const exists = await client.versionExists('bx-lsp', '2.0.0');

            assert.strictEqual(exists, false);
        });

        test('should return false on error', async () => {
            axiosGetStub.rejects(new Error('Network error'));

            const exists = await client.versionExists('bx-lsp', '1.0.0');

            assert.strictEqual(exists, false);
        });
    });
});
