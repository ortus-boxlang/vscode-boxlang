import { glob } from 'glob';
import Mocha from 'mocha';
import * as path from 'path';

// Load VS Code mock BEFORE any other imports
import './mocks/vscode';

/**
 * Standalone test runner for unit tests that don't require VS Code extension host
 * Run with: npm run test:unit
 */
async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 10000,
        reporter: 'spec'
    });

    const testsRoot = path.resolve(__dirname, '../..');

    try {
        // Find test files - only include our new utility tests
        const testPattern = '**/+(ForgeBoxClient|DownloadManager|ModuleManager|Configuration).test.js';
        const files = await glob(testPattern, {
            cwd: path.join(testsRoot, 'out', 'test', 'suite'),
            absolute: true
        });

        console.log(`\nFound ${files.length} test file(s):\n`);
        files.forEach(f => console.log(`  - ${path.basename(f)}`));
        console.log('');

        // Add files to the test suite
        files.forEach(f => mocha.addFile(f));

        // Run the mocha test
        return new Promise<void>((resolve, reject) => {
            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        });
    } catch (err) {
        console.error('Error running tests:', err);
        throw err;
    }
}

run()
    .then(() => {
        console.log('\n✓ All unit tests passed!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n✗ Test failures:', err);
        process.exit(1);
    });
