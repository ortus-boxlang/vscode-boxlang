import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Avoid loading launchers: this test only constructs the home tree.
const Module = require('module');
const originalRequire = Module.prototype.require;
const output: string[] = [];
Module.prototype.require = function (id: string) {
    if (/[\\/]views[\\/]ServerHomesView\./.test(this?.filename || '')) {
        if (id === '../utils/BoxLang' || id === '../utils/workspaceSetup') return {};
        if (id === '../utils/OutputChannels') return { boxlangOutputChannel: { appendLine: (line: string) => output.push(String(line)) } };
    }
    return originalRequire.apply(this, arguments);
};
const { ServerHomeRootTreeItem } = require('../../views/ServerHomesView');
Module.prototype.require = originalRequire;

suite('ServerHomesView Test Suite', () => {
    test('module tree ignores files alongside installed module directories', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'boxlang-home-tree-'));
        try {
            fs.mkdirSync(path.join(home, 'config'));
            fs.mkdirSync(path.join(home, 'logs'));
            fs.mkdirSync(path.join(home, 'modules', 'bx-example'), { recursive: true });
            fs.writeFileSync(path.join(home, 'config', 'boxlang.json'), '{}');
            fs.writeFileSync(path.join(home, 'modules', 'box.json'), '{}');
            fs.writeFileSync(path.join(home, 'modules', 'bx-example', 'box.json'), JSON.stringify({ slug: 'bx-example', version: '1.0.0' }));
            output.length = 0;

            const root = new ServerHomeRootTreeItem('test', home);

            assert.deepStrictEqual(root.modulesDirectory.getChildren().map(module => module.name), ['bx-example']);
            assert.deepStrictEqual(output, []);
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
