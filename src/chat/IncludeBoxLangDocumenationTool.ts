import * as vscode from "vscode";
import { readBoxLangOrtusBooksJSON } from '../utils/resourceProvider';

type IncludeBoxLangDocumentationToolParams = {
    text: string
}

export class IncludeBoxLangDocumentationTool implements vscode.LanguageModelTool<IncludeBoxLangDocumentationToolParams> {
    async invoke(options: vscode.LanguageModelToolInvocationOptions<{ text: string; }>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
        return getRelaventDocumentation(options.input.text);
    }
    prepareInvocation?(options: vscode.LanguageModelToolInvocationPrepareOptions<{ text: string; }>, token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
        return;
    }

}

async function getRelaventDocumentationPrompt(query: string) {
    const data = await readBoxLangOrtusBooksJSON();
    return [
        vscode.LanguageModelChatMessage.User(`
            The following JSON data is a collection of webpages that provide documentation for the BoxLang programming language.
            When the users asks for information about writing boxlang code or one of its libraries look at the provided JSON
            data and pick the most relevant pages to review.

            You MUST follow all of the following rules

            * Assign a relevance score between 0 and 1 for each page
            * If the relevance score is less than 0.4 do not include it in your response
            * Do not guess or imagine a URL. Use only real URLs found in the provided data
            * Output ONLY the urls formatted JSON as in the example below. Do not include markdown formatting.

            Example Ouptut
            \`\`\`
            [
                { "url": "https://exmaple.com/article-28", "relevance": 0.8 },
                { "url": "https://exmaple.com/article-2", "relevance": 0.75 },
                { "url": "https://exmaple.com/article-17", "relevance": 0.4 }
            ]
            \`\`\`


            START DOCUMENTATION DATA
        `),
        vscode.LanguageModelChatMessage.User(data + ""),
        vscode.LanguageModelChatMessage.User("END DOCUMENTATION DATA"),
        vscode.LanguageModelChatMessage.User(query)
    ]
}


async function getRelaventDocumentation(message: string) {
    const token = new vscode.CancellationTokenSource().token;
    try {
        const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4.1' });
        // const tools = vscode.lm.tools.filter( tool => tool.tags.includes( 'boxlang' ) );
        const request = await model.sendRequest(await getRelaventDocumentationPrompt(message), {}, token);
        let fullResponse = "";

        for await (const fragment of request.stream) {
            // stream.markdown( fragment );
            if (fragment instanceof vscode.LanguageModelTextPart) {
                fullResponse += fragment.value;

                continue;
            }
        }

        const pages = JSON.parse(fullResponse);

        var relevant = pages.filter(p => p.relevance >= 0.6);

        if (!relevant.length) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart("No relevant pages were found")
            ]);
        }

        const urls = relevant.map(page => {
            return new vscode.LanguageModelTextPart(page.url);
        });

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart("These pages of documentation are most relevant for the user's question. Fetch each page and include it in the context."),
            new vscode.LanguageModelTextPart(JSON.stringify(relevant))
        ])

    } catch (err) {
        // Making the chat request might fail because
        // - model does not exist
        // - user consent not given
        // - quota limits were exceeded
        if (err instanceof vscode.LanguageModelError) {
            if ("cause" in err) {
                console.log(err.message, err.code, err.cause);
                if (err.cause instanceof Error && err.cause.message.includes('off_topic')) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(vscode.l10n.t("I'm sorry, I can only explain computer science concepts."))
                    ])
                }
            }

        } else {
            // add other error handling logic
            throw err;
        }
    }
}