import * as path from 'path';
import * as fs from 'fs';
const Mocha = require('mocha');
const { glob } = require('glob');

async function runTests() {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true
	});

	const testsRoot = path.resolve(__dirname, 'suite');
	const sourceTestsRoot = path.resolve(__dirname, '../../src/test/suite');

	try {
		const sourceFiles = await glob('**/*.test.ts', { cwd: sourceTestsRoot });
		const files = sourceFiles
			.map((f: string) => f.replace(/\.ts$/, '.js'))
			.filter((f: string) => fs.existsSync(path.resolve(testsRoot, f)));

		// Add files to the test suite
		files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

		// Run the mocha test
		return new Promise<void>((resolve, reject) => {
			mocha.run((failures: number) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		});
	} catch (err) {
		throw err;
	}
}

runTests()
	.then(() => {
		console.log('All tests passed!');
		process.exit(0);
	})
	.catch(err => {
		console.error('Tests failed:', err);
		process.exit(1);
	});