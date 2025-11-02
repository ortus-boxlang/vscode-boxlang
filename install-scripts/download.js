// scripts/download.js
const https = require('https');
const fs = require('fs');
const url = process.argv[2];
const dest = process.argv[3];

https.get(url, (res) => {
  if (res.statusCode !== 200) {
    console.error(`Request Failed. Status Code: ${res.statusCode}`);
    res.resume();
    process.exit(1);
  }
  const file = fs.createWriteStream(dest);
  res.pipe(file);
  file.on('finish', () => file.close());
}).on('error', (err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});