const https = require('https');
const fs = require('fs');
const path = require('path');
const { downloadLSP } = require('./get-lsp');

/**
 * Downloads a JAR file from a given URL and saves it to the specified location.
 * @param {string} url - The URL of the JAR file.
 * @param {string} savePath - The file path where the JAR should be saved.
 */
function downloadJar(url, savePath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(savePath);

        console.log( "downloading " + url );

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                response.resume(); // Consume response data to free up memory
                return reject(new Error(`Failed to download file: ${response.statusCode} ${response.statusMessage}`));
            }

            response.pipe(file);

            file.on('finish', () => {
                console.log( `Downloaded JAR to ${savePath}` );
                file.close(() => resolve(`Downloaded JAR to ${savePath}`));
            });
        }).on('error', (err) => {
            console.log( "unable to download " + url );
            fs.unlink(savePath, () => {}); // Delete the file if an error occurs
            reject(new Error(`Error downloading file: ${err.message}`));
        });
    });
}

function run(){
    const versions = JSON.parse( fs.readFileSync(path.join(__dirname, '../', 'bxVersions.json'), 'utf8') + "" );

    const boxlangVersion = versions.boxlang;
    const miniserverVersion = versions.miniserver;
    const lspVersion = versions[ 'bx-lsp' ];

    // download boxlang
    const boxlangJarURL = `https://s3.amazonaws.com/downloads.ortussolutions.com/ortussolutions/boxlang/${boxlangVersion}/boxlang-${boxlangVersion}.jar`
    const saveLocation = path.join(__dirname, "..", "resources", "lib", "boxlang.jar" );
    downloadJar(boxlangJarURL, saveLocation);

    // download the miniserver
    const miniserverJarURL = `ttps://s3.amazonaws.com/downloads.ortussolutions.com/ortussolutions/boxlang-runtimes/boxlang-miniserver/${miniserverVersion}/boxlang-miniserver-${miniserverVersion}.jar`
    const miniserverSaeLocation = path.join(__dirname, "..", "resources", "lib", "boxlang-miniserver.jar" );
    downloadJar(miniserverJarURL, miniserverSaeLocation);

    // download the lsp
    downloadLSP( lspVersion );

}

run();

// Example usage
// const jarUrl = 'https://example.com/path/to/your.jar';
// const saveLocation = path.join(__dirname, 'your.jar');
// downloadJar(jarUrl, saveLocation);