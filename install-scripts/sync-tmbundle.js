const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const tar = require('tar');

function ensureDirectory(filePath) {
    const dirPath = path.dirname(filePath);
    fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(sourcePath, targetPath) {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Missing TextMate bundle file: ${sourcePath}`);
    }

    ensureDirectory(targetPath);
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`Synced ${sourcePath} -> ${targetPath}`);
}

function downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destination);

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Failed to download TextMate bundle: ${response.statusCode} ${response.statusMessage}`));
                return;
            }

            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (error) => {
            fs.unlink(destination, () => {});
            reject(error);
        });
    });
}

async function fetchBundle() {
    const bundleUrl = 'https://codeload.github.com/ortus-boxlang/boxlang.tmbundle/tar.gz/development';
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxlang-tmbundle-'));
    const archivePath = path.join(tempDir, 'bundle.tgz');

    await downloadFile(bundleUrl, archivePath);
    await tar.x({ file: archivePath, cwd: tempDir });

    return {
        tempDir,
        bundleRoot: path.join(tempDir, 'boxlang.tmbundle-development')
    };
}

async function syncBundle() {
    const { tempDir, bundleRoot } = await fetchBundle();
    const syntaxTargets = [
        {
            source: path.join(bundleRoot, 'Syntaxes', 'boxlang.tmLanguage.json'),
            target: path.join(__dirname, '..', 'syntaxes', 'boxlang.tmLanguage.json')
        },
        {
            source: path.join(bundleRoot, 'Syntaxes', 'boxlang-template.tmLanguage.json'),
            target: path.join(__dirname, '..', 'syntaxes', 'boxlang-template.tmLanguage.json')
        }
    ];

    const themeTargets = [
        {
            source: path.join(bundleRoot, 'Themes', 'BoxLang Dark.tmTheme'),
            target: path.join(__dirname, '..', 'themes', 'BoxLang Dark.tmTheme')
        },
        {
            source: path.join(bundleRoot, 'Themes', 'BoxLang High Contrast.tmTheme'),
            target: path.join(__dirname, '..', 'themes', 'BoxLang High Contrast.tmTheme')
        },
        {
            source: path.join(bundleRoot, 'Themes', 'BoxLang Light.tmTheme'),
            target: path.join(__dirname, '..', 'themes', 'BoxLang Light.tmTheme')
        }
    ];

    [...syntaxTargets, ...themeTargets].forEach(({ source, target }) => copyFile(source, target));

    fs.rmSync(tempDir, { recursive: true, force: true });
}

syncBundle().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
