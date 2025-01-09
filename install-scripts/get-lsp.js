const axios = require("axios");
const fs = require("fs");
const path = require("path");
const extract = require("extract-zip");

const forgeboxEndpoint = "https://forgebox.io/api/v1/entry/bx-lsp";

async function getDownloadLink(moduleAPIEndpoint) {
    const res = await axios.get(moduleAPIEndpoint, {});

    return res.data.data.latestVersion.downloadURL;
}

async function downloadFile(installDir, url) {
    if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir);
    }

    const installPath = path.join(installDir, "bx-lsp.zip");
    console.log(url);
    const readStream = await axios.get(url, {
        responseType: "stream"
    });

    return new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(installPath);
        readStream.data.pipe(stream);

        stream.on("error", (err) => {
            reject(err);
        });

        stream.on("close", () => {
            resolve(installPath)
        });
    });
}

(async () => {
    try {
        fs.rmSync(path.join("resources/lsp"), { recursive: true });
    }
    catch (e) {
        // ignore if this errors
    }

    const link = await getDownloadLink(forgeboxEndpoint);

    await downloadFile(path.join("resources/lsp"), link);

    // unzip
    await extract(path.join("resources/lsp", "bx-lsp.zip"), {
        dir: path.resolve(path.join("resources/lsp/bx-lsp"))
    });

    // delete zip
    fs.unlinkSync(path.join("resources/lsp", "bx-lsp.zip"));

    console.log(link);
})();