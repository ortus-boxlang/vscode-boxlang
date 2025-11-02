import * as vscode from 'vscode';
import { BoxLangResult } from "./BoxLang";
import { ExtensionConfig } from "./Configuration";
import { ensureDirectory } from './fileUtil';
import { trackedSpawn } from "./ProcessTracker";
import { ensureBoxLangVersion } from "./versionManager";
import { getWorkspaceBoxLangHome } from "./workspaceSetup";

type FeatureAuditOptions = {
    command: string;
    sourcePath: string;
    missing: boolean;
    presentation: string;
    reportPath: string;
}

export async function runFeatureAudit( boxlangVersion: string, args: FeatureAuditOptions): Promise<BoxLangResult> {
    const boxlangJarPath = await ensureBoxLangVersion( boxlangVersion );
    const featureAuditArgs = processArgs( args );

    return new Promise(async (resolve, reject) => {
        const javaExecutable = ExtensionConfig.boxlangJavaExecutable;
        const boxLang = trackedSpawn(javaExecutable, ["ortus.boxlang.runtime.BoxRunner"].concat(featureAuditArgs), {
            cwd: await getCWD( args ),
            env: {
                ...process.env,
                JAVA_HOME: ExtensionConfig.boxlangJavaHome,
                BOXLANG_HOME: getWorkspaceBoxLangHome(),
                CLASSPATH: boxlangJarPath
            }
        });
        let stdout = '';
        let stderr = '';

        boxLang.stdout.on("data", data => stdout += data);
        // TODO: throw error
        boxLang.stderr.on("data", data => stderr += data);

        boxLang.on("exit", code => {
            resolve({
                code,
                stdout,
                stderr
            });
        });
    });
}

async function getCWD( opts: FeatureAuditOptions ) : Promise<string | undefined> {
    if( !opts.sourcePath ) {
        return getFirstWorkspaceFolder();
    }

    return await ensureDirectory( opts.sourcePath );
}

function getFirstWorkspaceFolder(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        const workspaceFolder = folders[0].uri.fsPath;
        return workspaceFolder;
    }
}

function processArgs(opt: FeatureAuditOptions): string[] {
    let cmd = [ "featureaudit" ];

    if( opt.sourcePath ) {
        cmd.push( "--source", opt.sourcePath );
    }

    if( opt.missing ) {
        cmd.push( "--missing" );
    }

    if( opt.presentation === "aggregate" ) {
        cmd.push( "--aggregate" );
    } else if( opt.presentation === "summary" ) {
        cmd.push( "--aggregate", "summary" );
    }

    if( opt.reportPath ) {
        cmd.push( "--reportFile", opt.reportPath );
    }

    return cmd;
}