import { basename } from "path";
import { Uri, languages } from "vscode";
import { BoxLang } from "../utils/BoxLang";
import { appendToOpenDocument } from "../utils/documentUtil";

export async function transpileToJava(filePath) {
    const javaSource = await new BoxLang().transpileToJava(filePath.fsPath);

    const doc = await appendToOpenDocument(Uri.file(`BoxLang Generated Java: ${basename(filePath.fsPath)}`).with({ scheme: "untitled" }), javaSource);

    languages.setTextDocumentLanguage(doc, "java");
}