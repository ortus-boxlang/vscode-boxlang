import { readFile } from "fs/promises";
import { getExtensionContext } from "../context";

export async function getBoxLangParticipantPrompt(){
    return await readFile(
        getExtensionContext().asAbsolutePath( "resources/BoxLangParticipantPrompt.md" ),
        {
            encoding: "utf-8"
        }
    );
}

export async function readBoxLangOrtusBooksJSON(){
    return await readFile(
        getExtensionContext().asAbsolutePath( "resources/boxlang.ortusbooks.com.json" ),
        {
            encoding: "utf-8"
        }
    );
}