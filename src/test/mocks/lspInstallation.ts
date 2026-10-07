import * as fs from 'fs/promises';
import * as path from 'path';

/** Files required by cache validation; JVM startup is mocked in these tests. */
export async function createLSPInstallation(directory: string, boxJson = '{}'): Promise<void> {
    const modulePath = path.join(directory, 'bx-lsp');
    await fs.mkdir(path.join(modulePath, 'libs'), { recursive: true });
    await fs.writeFile(path.join(modulePath, 'box.json'), boxJson);
    await fs.writeFile(path.join(modulePath, 'ModuleConfig.bx'), 'class {}');
    await fs.writeFile(path.join(modulePath, 'libs', 'bx-lsp-test.jar'), 'mock LSP binary');
}
