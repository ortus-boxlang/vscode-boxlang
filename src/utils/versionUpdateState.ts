export const PENDING_RUNTIME_REFRESH_KEY = "boxlang.updates.pendingRuntimeRefresh";
export const PENDING_LSP_REFRESH_KEY = "boxlang.updates.pendingLSPRefresh";
export const PENDING_DEBUGGER_REFRESH_KEY = "boxlang.updates.pendingDebuggerRefresh";

export interface PendingModuleRefresh {
    versionSpec: string;
    forceRefresh?: boolean;
    updatedDate?: string;
    binaryHash?: string;
    etag?: string;
    lastModified?: string;
}
