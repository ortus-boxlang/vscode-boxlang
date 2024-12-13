import * as vscode from "vscode";
import { ConfigurationTarget, workspace } from "vscode";
import { ExtensionConfig } from "../utils/Configuration";

const settingTargets = [
    { key: "globalValue", configurationTarget: ConfigurationTarget.Global },
    { key: "workspaceFolderValue ", configurationTarget: ConfigurationTarget.WorkspaceFolder },
    { key: "workspaceValue ", configurationTarget: ConfigurationTarget.Workspace },
]

const settingMap = {
    "cfml.boxlang.jarpath": "boxlang.jarpath",
    "cfml.boxlang.miniserverjarpath": "boxlang.miniserverjarpath",
    "cfml.boxlang.lspjarpath": "boxlang.lspjarpath",
    "cfml.boxlang.webPort": "boxlang.webPort",
    "cfml.boxlang.lsp.enableExperimentalDiagnostics": "boxlang.lsp.enableExperimentalDiagnostics",
    "cfml.boxlang.showLexerTokens": "boxlang.showLexerTokens",
    "cfml.boxlang.lexerPath": "boxlang.lexerPath",
    "cfml.boxlang.parserPath": "boxlang.parserPath",
    "cfml.boxlang.customAntlrToolsCommand": "boxlang.customAntlrToolsCommand",
    "cfml.globalDefinitions.source": "boxlang.cfml.globalDefinitions.source",
    "cfml.cfDocs.source": "boxlang.cfml.cfDocs.source",
    "cfml.cfDocs.localPath": "boxlang.cfml.cfDocs.localPath",
    "cfml.hover.enable": "boxlang.cfml.hover.enable",
    "cfml.hover.html.enable": "boxlang.cfml.hover.html.enable",
    "cfml.hover.css.enable": "boxlang.cfml.hover.css.enable",
    "cfml.signature.enable": "boxlang.cfml.signature.enable",
    "cfml.outline.showImplicitFunctions": "boxlang.cfml.outline.showImplicitFunctions",
    "cfml.suggest.enable": "boxlang.cfml.suggest.enable",
    "cfml.suggest.snippets.enable": "boxlang.cfml.suggest.snippets.enable",
    "cfml.suggest.snippets.exclude": "boxlang.cfml.suggest.snippets.exclude",
    "cfml.suggest.snippets.localPath": "boxlang.cfml.suggest.snippets.localPath",
    "cfml.suggest.scopes.case": "boxlang.cfml.suggest.scopes.case",
    "cfml.suggest.globalFunctions.enable": "boxlang.cfml.suggest.globalFunctions.enable",
    "cfml.suggest.globalFunctions.firstLetterCase": "boxlang.cfml.suggest.globalFunctions.firstLetterCase",
    "cfml.suggest.globalTags.enable": "boxlang.cfml.suggest.globalTags.enable",
    "cfml.suggest.globalTags.attributes.quoteType": "boxlang.cfml.suggest.globalTags.attributes.quoteType",
    "cfml.suggest.globalTags.attributes.defaultValue": "boxlang.cfml.suggest.globalTags.attributes.defaultValue",
    "cfml.suggest.globalTags.includeAttributes.setType": "boxlang.cfml.suggest.globalTags.includeAttributes.setType",
    "cfml.suggest.globalTags.includeAttributes.custom": "boxlang.cfml.suggest.globalTags.includeAttributes.custom",
    "cfml.suggest.htmlTags.enable": "boxlang.cfml.suggest.htmlTags.enable",
    "cfml.suggest.htmlTags.attributes.quoteType": "boxlang.cfml.suggest.htmlTags.attributes.quoteType",
    "cfml.suggest.css.enable": "boxlang.cfml.suggest.css.enable",
    "cfml.suggest.replaceComments": "boxlang.cfml.suggest.replaceComments",
    "cfml.definition.enable": "boxlang.cfml.definition.enable",
    "cfml.definition.userFunctions.search.enable": "boxlang.cfml.definition.userFunctions.search.enable",
    "cfml.indexComponents.enable": "boxlang.cfml.indexComponents.enable",
    "cfml.autoCloseTags.enable": "boxlang.cfml.autoCloseTags.enable",
    "cfml.autoCloseTags.configurationTarget": "boxlang.cfml.autoCloseTags.configurationTarget",
    "cfml.docBlock.gap": "boxlang.cfml.docBlock.gap",
    "cfml.docBlock.extra": "boxlang.cfml.docBlock.extra",
    "cfml.engine.name": "boxlang.cfml.engine.name",
    "cfml.engine.version": "boxlang.cfml.engine.version",
    "cfml.mappings": "boxlang.cfml.mappings"
};

export async function migrateSettings(force: boolean) {
    if (ExtensionConfig.ignoreOldSettings && !force) {
        return;
    }

    const unmatched = getUnmatchedSettings();

    if (!unmatched.length) {
        ExtensionConfig.ignoreOldSettings = true;
        return;
    }

    if (!force) {
        const choice = await vscode.window.showInformationMessage(
            "Some BoxLang settings were detected using an older format. Would you like to migrate them now? You can use the BoxLang: Migrate Settings to do this at any time.",
            "Migrate",
            "Cancel"
        );

        if (choice != "Migrate") {
            ExtensionConfig.ignoreOldSettings = true;
            return;
        }
    }


    updateSettings();

    ExtensionConfig.ignoreOldSettings = true;

    vscode.window.showInformationMessage("BoxLang settiings were successfully migrated.");
}

function getUnmatchedSettings() {
    return Object.keys(settingMap)
        .filter(key => {
            const oldParts = parseSetting(key);
            const newParts = parseSetting(settingMap[key]);
            const oldSetting = workspace.getConfiguration(oldParts.section);
            const oldSettingData = oldSetting.inspect(oldParts.name);
            const newSetting = workspace.getConfiguration(newParts.section);
            const newSettingData = newSetting.inspect(newParts.name);

            for (let target of settingTargets) {
                if (isSettingMismatched(oldSettingData[target.key], newSettingData[target.key])) {
                    return true;
                }
            }

            return false;
        });
}

function updateSettings() {
    getUnmatchedSettings()
        .forEach(key => {
            const oldParts = parseSetting(key);
            const newParts = parseSetting(settingMap[key]);
            const oldSetting = workspace.getConfiguration(oldParts.section);
            const oldSettingData = oldSetting.inspect(oldParts.name);
            const newSetting = workspace.getConfiguration(newParts.section);
            const newSettingData = newSetting.inspect(newParts.name);

            for (let target of settingTargets) {
                if (!isSettingMismatched(oldSettingData[target.key], newSettingData[target.key])) {
                    continue;
                }

                newSetting.update(newParts.name, oldSettingData[target.key], target.configurationTarget);
            }
        });
}

function parseSetting(fullSetting: string): { section: string, name: string } {
    const parts = fullSetting.split(".");

    return {
        section: parts.slice(0, parts.length - 1).join("."),
        name: parts[parts.length - 1]
    };
}

/**
 * A setting is mismatched if the values are not equal AND the old value is not null. This prevents us from overwriting real values with a null value
 * @param oldSetting
 * @param newSetting
 * @returns
 */
function isSettingMismatched(oldSetting, newSetting) {
    return oldSetting != newSetting
        && oldSetting != null;
}

