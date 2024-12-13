import { parse } from 'comment-json';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';

let serverHomes = [];

const _onDidChangeTreeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
export const onDidChangeTreeData: vscode.Event<void> = _onDidChangeTreeData.event;

export const notifyServerHomeDataChange = () => {
    loadBoxLangHomeData();
    _onDidChangeTreeData.fire();
}

const boxlangHomePattern = /\$\{boxlang-home\}/gi;
const defaultClassFileDirectory = dir => path.join(dir, "classes");
const defaultConfigFilePath = dir => path.join(dir, "config", "boxlang.json");
const defaultModulesDirectory = dir => path.join(dir, "modules");
const defaultLogsDirectory = dir => path.join(dir, "logs");

class BLServerHomeTreeItem extends vscode.TreeItem {
    parent?: WeakRef<BLServerHomeTreeItem>;

    constructor(parent: BLServerHomeTreeItem, label: string, state: vscode.TreeItemCollapsibleState) {
        super(label, state);
        this.parent = !parent ? null : new WeakRef(parent);
    }

    getChildren(): BLServerHomeTreeItem[] {
        return [];
    }

    getRoot(): ServerHomeRootTreeItem | undefined {
        if (!this.parent) {
            return null;
        }

        let p = this.parent.deref();

        while (p != null) {
            if (p instanceof ServerHomeRootTreeItem) {
                return p;
            }

            p = p.parent.deref();
        }

        return null;
    }
}

export class LogFileTreeItem extends BLServerHomeTreeItem {
    file: string;
    filePath: string;

    constructor(parent: BLServerHomeTreeItem, file: string, filePath: string) {
        super(parent, "", vscode.TreeItemCollapsibleState.None);
        this.contextValue = "boxlangServerHome-logFileItem";
        this.label = file;
        this.file = file;
        this.filePath = filePath;
    }
}

class LogsTreeItem extends BLServerHomeTreeItem {
    logFiles: LogFileTreeItem[];

    constructor(parent: BLServerHomeTreeItem) {
        super(parent, "logs", vscode.TreeItemCollapsibleState.Collapsed);

        const logsDir = this.getRoot().getLogsDirectory();

        this.logFiles = fs.readdirSync(logsDir)
            .filter(value => value.includes(".log"))
            .map(file => new LogFileTreeItem(this, file, path.join(logsDir, file)));
    }

    getChildren(): BLServerHomeTreeItem[] {
        return this.logFiles;
    }
}


export class ModuleTreeItem extends BLServerHomeTreeItem {
    name: string;
    version: string;
    homePage: string;
    directory: string;

    constructor(parent: BLServerHomeTreeItem, directory: string) {
        const boxConfig = parse(fs.readFileSync(path.join(directory, "box.json")) + "") as Record<string, any>;
        super(parent, boxConfig.slug, vscode.TreeItemCollapsibleState.None);

        this.version = boxConfig.version;
        this.name = boxConfig.slug;
        this.homePage = boxConfig.homepage;
        this.directory = directory;
        this.description = boxConfig.version;
        this.contextValue = "boxlangServerHome-moduleTreeItem";
    }
}

export class ModulesDirectoryTreeItem extends BLServerHomeTreeItem {
    modules: ModuleTreeItem[];

    constructor(parent: BLServerHomeTreeItem) {
        super(parent, "modules", vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = "boxlangServerHome-modulesDirectoryTreeItem";

        const dirs = this.getRoot().getModulesDirectories();


        this.modules = dirs.map(dir => {
            return fs.readdirSync(dir)
                .map(file => new ModuleTreeItem(this, path.join(dir, file)));
        }).flatMap(dirs => dirs);

    }

    getChildren(): BLServerHomeTreeItem[] {
        return this.modules;
    }
}

export class ConfigTreeItem extends BLServerHomeTreeItem {

    constructor(parent: BLServerHomeTreeItem) {
        super(parent, "config", vscode.TreeItemCollapsibleState.None);
        this.contextValue = "boxlangServerHome-configFile";
    }

    getConfigPath() {
        return defaultConfigFilePath(this.getRoot().directory);
    }
}

export class ServerHomeRootTreeItem extends BLServerHomeTreeItem {
    name: string;
    directory: string;
    configData?: Record<string, any>;
    logs: LogsTreeItem;
    modulesDirectory: ModulesDirectoryTreeItem;
    config: ConfigTreeItem;

    constructor(label: string, directory: string) {
        super(null, label, vscode.TreeItemCollapsibleState.Expanded);
        this.directory = directory;
        this.description = directory;
        this.configData = parse(fs.readFileSync(defaultConfigFilePath(this.directory)) + "") as Record<string, any>;
        this.logs = new LogsTreeItem(this);
        this.modulesDirectory = new ModulesDirectoryTreeItem(this);
        this.config = new ConfigTreeItem(this);
        this.contextValue = "boxlangServerHome-serverHome";
    }

    getClassFileDirectory() {
        if (this.configData.compiler && this.configData.compiler.classGenerationDirectory) {
            return replaceBoxLangHomeInPath(this.directory, this.configData.compiler.classGenerationDirectory);
        }

        return defaultClassFileDirectory(this.directory);
    }

    getLogsDirectory(): string {
        return defaultLogsDirectory(this.directory);
    }

    getModulesDirectories(): string[] {

        if (this.configData.runtime && this.configData.runtime.modulesDirectory) {
            if (typeof this.configData.runtime.modulesDirectory === "string") {
                return [replaceBoxLangHomeInPath(this.directory, this.configData.runtime.modulesDirectory)];
            }

            return this.configData.runtime.modulesDirectory
                .map(dir => replaceBoxLangHomeInPath(this.directory, dir));
        }

        return [defaultModulesDirectory(this.directory)];
    }

    getChildren(): BLServerHomeTreeItem[] {
        return [
            this.config,
            this.logs,
            this.modulesDirectory
        ];
    }
}

export function boxlangServerHomeTreeDataProvider(): vscode.TreeDataProvider<BLServerHomeTreeItem> {
    return {
        onDidChangeTreeData: onDidChangeTreeData,
        getChildren: (element: BLServerHomeTreeItem): BLServerHomeTreeItem[] => {

            if (!element) {
                return serverHomes;
            }

            return element.getChildren();
        },
        getTreeItem(element): BLServerHomeTreeItem {
            return element;
        },
        getParent: (element): BLServerHomeTreeItem => {
            return element.parent.deref();
        }
    };
}

function replaceBoxLangHomeInPath(homeDir: string, filePath: string): string {
    return filePath.replace(boxlangHomePattern, homeDir);
}


function loadBoxLangHomeData() {
    serverHomes = [];

    if (fs.existsSync(path.join(process.env.USERPROFILE, ".boxlang"))) {
        serverHomes.push(new ServerHomeRootTreeItem("Default", path.join(process.env.USERPROFILE, ".boxlang")));
    }

    if (process.env.BOXLANG_HOME && fs.existsSync(process.env.BOXLANG_HOME)) {
        serverHomes.push(new ServerHomeRootTreeItem("BOXLANG_HOME", process.env.BOXLANG_HOME));
    }
}

loadBoxLangHomeData();