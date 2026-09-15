import * as assert from "assert";

const vscode = require("vscode");
const workspaceSetup = require("../../utils/workspaceSetup");
const { isCheckableFile, runBoxLangCheck } = require("../../tasks/BoxLangTaskProvider");

suite("BoxLang check test suite", () => {
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    const originalExecuteTask = vscode.tasks.executeTask;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    const originalLauncher = workspaceSetup.boxLangLauncher;
    const executedTasks: any[] = [];
    const warnings: string[] = [];
    let enabled = true;
    let supportsCheck = true;
    let runtimeVersion = "";

    setup(() => {
        executedTasks.length = 0;
        warnings.length = 0;
        enabled = true;
        supportsCheck = true;
        runtimeVersion = `test-runtime-${Date.now()}-${Math.random()}`;

        vscode.tasks.executeTask = async (task: any) => {
            executedTasks.push(task);
            return { task, terminate: () => {} };
        };
        vscode.workspace.getConfiguration = () => ({
            get: (key: string, fallback: unknown) => {
                if (key === "check.enable") {
                    return enabled;
                }
                if (key === "boxlangVersion") {
                    return runtimeVersion;
                }
                return fallback;
            }
        });
        vscode.window.showWarningMessage = (message: string) => {
            warnings.push(message);
            return Promise.resolve(undefined);
        };
        vscode.window.showErrorMessage = () => Promise.resolve(undefined);
        workspaceSetup.boxLangLauncher = {
            supportsCheck: async () => supportsCheck,
            shellExecution: async (args: string[]) => ({ args })
        };
    });

    teardown(() => {
        vscode.workspace.getConfiguration = originalGetConfiguration;
        vscode.tasks.executeTask = originalExecuteTask;
        vscode.window.showWarningMessage = originalShowWarningMessage;
        vscode.window.showErrorMessage = originalShowErrorMessage;
        workspaceSetup.boxLangLauncher = originalLauncher;
    });

    test("recognizes only the supported source extensions", () => {
        assert.deepStrictEqual(
            [".cfc", ".cfm", ".bx", ".bxs", ".bxm"].map(extension => isCheckableFile(`/workspace/file${extension}`)),
            [true, true, true, true, true]
        );
        assert.strictEqual(isCheckableFile("/workspace/file.BX"), true);
        assert.strictEqual(isCheckableFile("/workspace/file.cfml"), false);
        assert.strictEqual(isCheckableFile("/workspace/file.cfs"), false);
        assert.strictEqual(isCheckableFile("/workspace/file.txt"), false);
    });

    test("runs a check task for an enabled supported file", async () => {
        const filePath = "/workspace/current file.bx";

        await runBoxLangCheck({ uri: { scheme: "file", fsPath: filePath } });

        assert.strictEqual(executedTasks.length, 1);
        assert.deepStrictEqual(executedTasks[0].definition, {
            type: "boxlang",
            command: "check",
            args: [filePath]
        });
        assert.deepStrictEqual(executedTasks[0].execution.args, ["check", filePath]);
        assert.strictEqual(executedTasks[0].presentationOptions.reveal, vscode.TaskRevealKind.Always);
    });

    test("does not run a check task when disabled", async () => {
        enabled = false;

        await runBoxLangCheck({ uri: { scheme: "file", fsPath: "/workspace/current.bx" } });

        assert.strictEqual(executedTasks.length, 0);
    });

    test("warns once and skips the task when the runtime lacks check support", async () => {
        supportsCheck = false;

        await runBoxLangCheck({ uri: { scheme: "file", fsPath: "/workspace/current.bx" } });
        await runBoxLangCheck({ uri: { scheme: "file", fsPath: "/workspace/another.bx" } });

        assert.strictEqual(executedTasks.length, 0);
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /does not support `boxlang check`/);
    });
});
