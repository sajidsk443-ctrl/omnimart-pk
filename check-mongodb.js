// Checks URI shape/placeholders and Atlas DNS SRV resolution without printing credentials.
const dns = require('dns').promises;
require('./config/loadEnv')();

async function main() {
  const uri = String(process.env.MONGODB_URI || '').trim();
  if (!uri) {
    console.error('[check-mongodb] MONGODB_URI is missing.');
    process.exitCode = 1;
    return;
  }

  let parsed;
  try { parsed = new URL(uri); }
  catch {
    console.error('[check-mongodb] MONGODB_URI is not a valid MongoDB URL. Check the copied Atlas connection string.');
    process.exitCode = 1;
    return;
  }

  const protocol = parsed.protocol;
  const hostname = parsed.hostname;
  console.log(`[check-mongodb] format: ${protocol}`);
  console.log(`[check-mongodb] host: ${hostname || '(missing)'}`);
  if (protocol === 'mongodb+srv:' && parsed.port) console.log('[check-mongodb] invalid SRV port detected; app startup will remove this host port automatically.');
  if (!['mongodb+srv:', 'mongodb:'].includes(protocol) || !hostname) {
    console.error('[check-mongodb] Expected mongodb+srv:// or mongodb:// with a hostname.');
    process.exitCode = 1;
    return;
  }
  if (/xxxxx|\.xxx\.|example\.net|cluster-name|your[-_]?cluster|placeholder/i.test(hostname)) {
    console.error('[check-mongodb] The hostname appears to contain an example placeholder. Copy the exact cluster hostname from Atlas.');
    process.exitCode = 1;
    return;
  }

  if (protocol === 'mongodb:') {
    console.log('[check-mongodb] Standard URI format detected. DNS SRV was not queried. Confirm every seed host, TLS, and options came from Atlas.');
    return;
  }

  const srvName = `_mongodb._tcp.${hostname}`;
  try {
    const records = await dns.resolveSrv(srvName);
    if (!records.length) throw new Error('No SRV records were returned.');
    console.log(`[check-mongodb] SRV DNS lookup succeeded (${records.length} server record(s)).`);
    console.log('[check-mongodb] DNS is resolving; if npm start still fails, check Atlas Network Access, database-user credentials, and the URI password encoding.');
  } catch (error) {
    console.error(`[check-mongodb] SRV DNS lookup failed (${error.code || error.message}).`);
    console.error('[check-mongodb] Re-copy the connection string from Atlas > Database > Connect > Drivers and verify its cluster hostname. If it is exact, check this PC/network DNS and try the lookup on another network.');
    console.error('[check-mongodb] Do not auto-convert to mongodb:// by removing +srv; Atlas standard format needs the exact hosts and options from Atlas.');
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`[check-mongodb] Diagnostic failed: ${error.code || error.message}`);
  process.exitCode = 1;
});
