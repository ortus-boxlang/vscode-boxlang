import { DebugAdapterTracker, DebugAdapterTrackerFactory, DebugSession, ProviderResult } from "vscode";

let runningWebServer = false;

export function hasRunningWebServer() {
    return runningWebServer;
}

export class BoxLangDebugAdapterTrackerFactory implements DebugAdapterTrackerFactory {
    createDebugAdapterTracker(session: DebugSession): ProviderResult<DebugAdapterTracker> {
        const tracker = new BoxLangDebugAdapterTracker();

        tracker.session = session;

        return tracker;
    }
}

class BoxLangDebugAdapterTracker implements DebugAdapterTracker {
    session: DebugSession;

    onWillStartSession(): void {
        if (this.session.configuration.debugType === "local_web") {
            runningWebServer = true;
        }
    }

    onWillStopSession(): void {
        if (this.session.configuration.debugType === "local_web") {
            runningWebServer = false;
        }
    }
}
