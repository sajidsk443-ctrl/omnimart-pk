const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

module.exports = function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const fileExists = fs.existsSync(envPath);
  let encoding = 'not found';
  let parsed = {};

  if (fileExists) {
    const bytes = fs.readFileSync(envPath);
    let contents;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      encoding = 'UTF-16 LE';
      contents = bytes.subarray(2).toString('utf16le');
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      encoding = 'UTF-16 BE';
      contents = Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
    } else {
      encoding = 'UTF-8';
      contents = bytes.toString('utf8').replace(/^\uFEFF/, '');
      // Some Windows editors save UTF-16 without a byte-order mark.
      if (contents.includes('\u0000')) {
        encoding = 'UTF-16 LE (no BOM)';
        contents = bytes.toString('utf16le').replace(/^\uFEFF/, '');
      }
    }
    parsed = dotenv.parse(contents);
    for (const [key, value] of Object.entries(parsed)) {
      // Keep non-empty host-provided settings, but let .env fill absent/empty ones.
      if (process.env[key] === undefined || String(process.env[key]).trim() === '') process.env[key] = value;
    }
  }

  const info = {
    envPath,
    fileExists,
    encoding,
    hasMongoUriInFile: Object.prototype.hasOwnProperty.call(parsed, 'MONGODB_URI'),
    hasMongoUriInProcess: Boolean(String(process.env.MONGODB_URI || '').trim()),
    keys: Object.keys(parsed)
  };
  console.log(`[env] file ${fileExists ? 'found' : 'NOT FOUND'}: ${envPath}`);
  console.log(`[env] encoding: ${encoding}; MONGODB_URI in file: ${info.hasMongoUriInFile ? 'yes' : 'no'}; effective MONGODB_URI: ${info.hasMongoUriInProcess ? 'present' : 'missing'}`);
  return info;
};
