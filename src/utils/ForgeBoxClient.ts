import axios, { AxiosInstance } from "axios";

/**
 * ForgeBox API response types
 */
export interface ForgeBoxEntry {
    slug: string;
    title: string;
    summary: string;
    description: string;
    version: string;
    latestVersion: ForgeBoxVersion;
    versions: ForgeBoxVersion[];
    downloads: number;
    isActive: boolean;
    createDate: string;
    modifyDate: string;
}

export interface ForgeBoxVersion {
    version: string;
    downloadURL: string;
    isActive: boolean;
    createDate: string;
    modifyDate?: string;
}

export interface ForgeBoxSearchResult {
    results: ForgeBoxEntry[];
    total: number;
    page: number;
    pages: number;
}

/**
 * Direct ForgeBox API client - replaces CommandBox dependency for module queries
 */
export class ForgeBoxClient {
    private client: AxiosInstance;
    private readonly baseURL = "https://forgebox.io/api/v1";

    constructor() {
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 30000,
            headers: {
                "Accept": "application/json"
            }
        });
    }

    /**
     * Get metadata for a specific module
     * @param moduleName - Module slug (e.g., "bx-lsp", "bx-compat")
     * @returns Module metadata including all versions
     */
    async getModuleMetadata(moduleName: string): Promise<ForgeBoxEntry> {
        try {
            const response = await this.client.get(`/entry/${moduleName}`);
            return response.data.data || response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to fetch module '${moduleName}': ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get download URL for a specific version of a module
     * @param moduleName - Module slug
     * @param version - Specific version or "latest"
     * @returns Download URL
     */
    async getDownloadURL(moduleName: string, version?: string): Promise<string> {
        const metadata = await this.getModuleMetadata(moduleName);

        if (!version || version === "latest") {
            return metadata.latestVersion?.downloadURL || metadata.versions[0]?.downloadURL;
        }

        // Find specific version
        const versionEntry = metadata.versions.find(v => v.version === version);
        if (!versionEntry) {
            throw new Error(`Version ${version} not found for module ${moduleName}`);
        }

        return versionEntry.downloadURL;
    }

    /**
     * List all BoxLang modules from ForgeBox
     * Replaces: runCommandBox({}, "forgebox", "show", "boxlang-modules", "--json")
     */
    async listBoxLangModules(): Promise<ForgeBoxEntry[]> {
        try {
            const response = await this.client.get("/entries", {
                params: {
                    typeSlug: "boxlang-modules",
                    orderBy: "popular",
                    maxRows: 100
                }
            });

            const data = response.data.data || response.data;
            return data.results || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to list BoxLang modules: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Search for modules by keyword
     * @param searchTerm - Search query
     * @param type - Filter by module type
     */
    async searchModules(searchTerm: string, type?: string): Promise<ForgeBoxEntry[]> {
        try {
            const params: any = {
                searchTerm,
                maxRows: 50
            };

            if (type) {
                params.typeSlug = type;
            }

            const response = await this.client.get("/entries", { params });
            const data = response.data.data || response.data;
            return data.results || [];
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to search modules: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Get the latest version string for a module
     */
    async getLatestVersion(moduleName: string): Promise<string> {
        const metadata = await this.getModuleMetadata(moduleName);
        return metadata.latestVersion?.version || metadata.version;
    }

    /**
     * Check if a specific version exists for a module
     */
    async versionExists(moduleName: string, version: string): Promise<boolean> {
        try {
            const metadata = await this.getModuleMetadata(moduleName);
            return metadata.versions.some(v => v.version === version);
        } catch {
            return false;
        }
    }
}
