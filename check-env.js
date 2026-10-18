// Safe diagnostic: reports paths and whether variables exist, never their values.
const info = require('./config/loadEnv')();
console.log(`[check-env] MONGODB_URI in .env: ${info.hasMongoUriInFile ? 'yes' : 'no'}`);
console.log(`[check-env] MONGODB_URI available to the app: ${info.hasMongoUriInProcess ? 'yes' : 'no'}`);
console.log(`[check-env] Parsed variable names: ${info.keys.length ? info.keys.join(', ') : '(none)'}`);
if (!info.fileExists) console.log('[check-env] Put a file named exactly .env beside server.js and package.json.');
if (info.fileExists && !info.hasMongoUriInFile) console.log('[check-env] Add a line beginning exactly MONGODB_URI= to that .env file.');
