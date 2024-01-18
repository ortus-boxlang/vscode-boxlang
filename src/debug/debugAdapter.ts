

import { spawn } from "child_process";
import {
    ExitedEvent,
    LoggingDebugSession, OutputEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
const fs = require("fs");
const logFile = "C:\\Users\\jacob\\Dev\\vscode-boxlang\\log.txt";

const log = d => fs.appendFileSync(logFile, "\n" + d);

interface BoxLangLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    program: string
}

// try {

class BoxLangDebugSession extends LoggingDebugSession {
    constructor() {
        super(logFile);
    }

    protected launchRequest(response: DebugProtocol.LaunchResponse, args: BoxLangLaunchRequestArguments, request?: DebugProtocol.Request): void {
        log("launch request");
        log(JSON.stringify(args));
        log(JSON.stringify(request));

        const boxlang = spawn('java', ["-jar", "C:\\Users\\jacob\\Dev\\boxlang\\build\\libs\\boxlang-1.0.0-all.jar", args.program]);

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
// }
// catch (e) {
//     fs.appendFileSync("C:\\Users\\jacob\\Dev\\boxlang-battleship\\test.txt", e.message);
//     fs.appendFileSync("C:\\Users\\jacob\\Dev\\boxlang-battleship\\test.txt", e.toString());
// }