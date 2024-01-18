

import { spawn } from "child_process";
import {
    ExitedEvent,
    LoggingDebugSession, OutputEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';

interface BoxLangLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string,
    boxlangJar: string
}

class BoxLangDebugSession extends LoggingDebugSession {
    constructor() {
        super("log.txt");
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: BoxLangLaunchRequestArguments, request?: DebugProtocol.Request): void {
        const boxlang = spawn('java', ["-jar", args.boxlangJar, args.program]);

        boxlang.stdout.on('data', (chunk) => {
            this.sendEvent(new OutputEvent(chunk + '', 'stdout'));
        });

        boxlang.stdout.on('close', () => {
            this.sendEvent(new ExitedEvent(0));
            this.shutdown();
        });

        boxlang.stderr.on('data', chunk => {
            this.sendEvent(new OutputEvent(chunk + '', 'stderr'));
        });
        this.sendEvent(new OutputEvent(`Running: ${args.program}`));

        this.sendResponse(response);



    }
}


BoxLangDebugSession.run(BoxLangDebugSession);