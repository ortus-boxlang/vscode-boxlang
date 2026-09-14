import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { findJavaHome, isValidJavaHome } from '../../utils/JavaHomeFinder';

suite('JavaHomeFinder Test Suite', () => {
    const testTempDir = path.join(__dirname, 'java-home-test');

    setup(() => {
        // Create temp directory for tests
        if (!fs.existsSync(testTempDir)) {
            fs.mkdirSync(testTempDir, { recursive: true });
        }
    });

    teardown(() => {
        // Clean up temp directory
        if (fs.existsSync(testTempDir)) {
            fs.rmSync(testTempDir, { recursive: true, force: true });
        }
    });

    /**
     * Helper to create a mock Java home structure
     */
    function createJavaHomeStructure(basePath: string, platform: 'linux' | 'win32' | 'darwin' = 'linux'): void {
        const javaBinary = platform === 'win32' ? 'java.exe' : 'java';
        const binDir = path.join(basePath, 'bin');

        if (!fs.existsSync(binDir)) {
            fs.mkdirSync(binDir, { recursive: true });
        }

        const javaPath = path.join(binDir, javaBinary);
        fs.writeFileSync(javaPath, '#!/bin/sh\necho "mock java"');
        fs.chmodSync(javaPath, 0o755);
    }

    suite('findJavaHome', () => {
        test('should find Java home when bin/java exists directly in extractedPath', async () => {
            const extractedPath = path.join(testTempDir, 'extract-1');
            fs.mkdirSync(extractedPath, { recursive: true });

            createJavaHomeStructure(extractedPath);

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, extractedPath);
        });

        test('should find Java home in nested jdk-version subdirectory', async () => {
            const extractedPath = path.join(testTempDir, 'extract-2');
            const jdkDir = path.join(extractedPath, 'jdk-21.0.3+9');
            fs.mkdirSync(jdkDir, { recursive: true });

            createJavaHomeStructure(jdkDir);

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, jdkDir);
        });

        test('should find Java home in Contents/Home structure (macOS pkg)', async () => {
            const extractedPath = path.join(testTempDir, 'extract-3');
            const jdkDir = path.join(extractedPath, 'jdk-21.0.3+9');
            const contentsHomeDir = path.join(jdkDir, 'Contents', 'Home');
            fs.mkdirSync(contentsHomeDir, { recursive: true });

            createJavaHomeStructure(contentsHomeDir);

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, contentsHomeDir);
        });

        test('should find Java home when Contents/Home is directly in extractedPath', async () => {
            const extractedPath = path.join(testTempDir, 'extract-4');
            const contentsHomeDir = path.join(extractedPath, 'Contents', 'Home');
            fs.mkdirSync(contentsHomeDir, { recursive: true });

            createJavaHomeStructure(contentsHomeDir);

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, contentsHomeDir);
        });

        test('should prefer direct bin/java over nested structure when both exist', async () => {
            const extractedPath = path.join(testTempDir, 'extract-5');
            const jdkDir = path.join(extractedPath, 'jdk-21.0.3+9');

            // Create both structures
            createJavaHomeStructure(extractedPath);
            createJavaHomeStructure(jdkDir);

            const result = await findJavaHome(extractedPath);

            // Should return the direct path (Strategy 1 takes precedence)
            assert.strictEqual(result, extractedPath);
        });

        test('should return null when no Java home is found', async () => {
            const extractedPath = path.join(testTempDir, 'extract-6');
            fs.mkdirSync(extractedPath, { recursive: true });

            // Create some random files that aren't Java
            fs.writeFileSync(path.join(extractedPath, 'random.txt'), 'not java');

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, null);
        });

        test('should return null when extractedPath does not exist', async () => {
            const extractedPath = path.join(testTempDir, 'nonexistent');

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, null);
        });

        test('should skip files (non-directories) when scanning subdirectories', async () => {
            const extractedPath = path.join(testTempDir, 'extract-7');
            fs.mkdirSync(extractedPath, { recursive: true });

            // Create some files (not directories)
            fs.writeFileSync(path.join(extractedPath, 'file1.txt'), 'text');
            fs.writeFileSync(path.join(extractedPath, 'file2.txt'), 'text');

            // Create a valid JDK structure
            const jdkDir = path.join(extractedPath, 'jdk-21.0.3+9');
            fs.mkdirSync(jdkDir, { recursive: true });
            createJavaHomeStructure(jdkDir);

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, jdkDir);
        });

        test('should handle Windows platform (java.exe)', async () => {
            // This test will only pass on Windows, but we can test the logic
            const extractedPath = path.join(testTempDir, 'extract-8');
            const jdkDir = path.join(extractedPath, 'jdk-21.0.3+9');
            fs.mkdirSync(jdkDir, { recursive: true });

            // Create java.exe for Windows testing
            const binDir = path.join(jdkDir, 'bin');
            fs.mkdirSync(binDir, { recursive: true });
            fs.writeFileSync(path.join(binDir, 'java.exe'), 'mock java exe');

            // On non-Windows, this should still work if we also create 'java'
            if (process.platform !== 'win32') {
                fs.writeFileSync(path.join(binDir, 'java'), '#!/bin/sh\necho "mock java"');
                fs.chmodSync(path.join(binDir, 'java'), 0o755);
            }

            const result = await findJavaHome(extractedPath);

            // On Windows, should find java.exe; on other platforms, should find java
            assert.notStrictEqual(result, null);
            assert.strictEqual(result, jdkDir);
        });

        test('should handle multiple subdirectories and return first valid match', async () => {
            const extractedPath = path.join(testTempDir, 'extract-9');

            // Create multiple subdirectories
            const dir1 = path.join(extractedPath, 'dir1');
            const dir2 = path.join(extractedPath, 'dir2');
            const jdkDir = path.join(extractedPath, 'jdk-21.0.3+9');

            fs.mkdirSync(dir1, { recursive: true });
            fs.mkdirSync(dir2, { recursive: true });
            fs.mkdirSync(jdkDir, { recursive: true });

            // Only create Java in the jdk directory
            createJavaHomeStructure(jdkDir);

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, jdkDir);
        });

        test('should handle empty extractedPath directory', async () => {
            const extractedPath = path.join(testTempDir, 'extract-10');
            fs.mkdirSync(extractedPath, { recursive: true });

            const result = await findJavaHome(extractedPath);

            assert.strictEqual(result, null);
        });
    });

    suite('isValidJavaHome', () => {
        test('should return true when bin/java exists at the path', () => {
            const javaHomePath = path.join(testTempDir, 'valid-home');
            fs.mkdirSync(javaHomePath, { recursive: true });

            createJavaHomeStructure(javaHomePath);

            const result = isValidJavaHome(javaHomePath);

            assert.strictEqual(result, true);
        });

        test('should return false when bin/java does not exist', () => {
            const javaHomePath = path.join(testTempDir, 'invalid-home');
            fs.mkdirSync(javaHomePath, { recursive: true });

            const result = isValidJavaHome(javaHomePath);

            assert.strictEqual(result, false);
        });

        test('should return false when path does not exist', () => {
            const javaHomePath = path.join(testTempDir, 'nonexistent');

            const result = isValidJavaHome(javaHomePath);

            assert.strictEqual(result, false);
        });

        test('should return false when bin directory exists but java does not', () => {
            const javaHomePath = path.join(testTempDir, 'no-java');
            const binDir = path.join(javaHomePath, 'bin');
            fs.mkdirSync(binDir, { recursive: true });

            // Create some other file in bin
            fs.writeFileSync(path.join(binDir, 'javac'), 'not java');

            const result = isValidJavaHome(javaHomePath);

            assert.strictEqual(result, false);
        });
    });
});
