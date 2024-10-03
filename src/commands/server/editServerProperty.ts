
import * as vscode from "vscode";
import { getServerData, updateServerProperty } from "../../utils/Server";

const clearable = [
    "configFile"
];

export async function editServerProperty({ key }) {
    let [serverName, property] = key.split(".");

    if (!property) {
        property = "name";
    }

    const serverData = getServerData(serverName);

    const newValue = await vscode.window.showInputBox({
        title: `Edit property "${property}" of ${serverName}`,
        value: serverData[property]
    });

    if (
        (newValue == null || newValue == "")
        && !clearable.includes(property)
    ) {
        return;
    }

    updateServerProperty(serverName, property, newValue);
}