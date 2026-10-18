const mongoose = require('mongoose');

function sanitizeSrvUri(value) {
  const uri = String(value || '').trim();
  const match = uri.match(/^(mongodb\+srv:\/\/)([^/?#]+)(.*)$/i);
  if (!match) return { uri, changed: false };

  // Only edit the host portion after the last @. Never touch username/password.
  const authority = match[2];
  const at = authority.lastIndexOf('@');
  const credentials = at >= 0 ? authority.slice(0, at + 1) : '';
  let host = at >= 0 ? authority.slice(at + 1) : authority;
  const before = host;
  host = host.replace(/:{2,}/g, ':').replace(/:\d+$/, '').replace(/:+$/, '');
  const cleaned = `${match[1]}${credentials}${host}${match[3]}`;
  return { uri: cleaned, changed: cleaned !== uri || host !== before };
}

module.exports = async function connectDB() {
  const rawUri = String(process.env.MONGODB_URI || '').trim();
  const { uri, changed } = sanitizeSrvUri(rawUri);
  if (!uri) {
    throw new Error('MONGODB_URI is missing. Create a .env file beside server.js and set MONGODB_URI to your MongoDB Atlas connection string.');
  }
  if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://. Check the value in the project-root .env file.');
  }
  if (changed) console.warn('[mongodb] Removed an invalid port or repeated colon from the mongodb+srv host. Update .env to keep the URI clean.');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    console.log('MongoDB connected using MONGODB_URI');
  } catch (error) {
    const dnsLookupFailed = ['ENOTFOUND', 'ESERVFAIL', 'ETIMEOUT'].includes(error.code);
    if (/^mongodb\+srv:\/\//i.test(uri) && dnsLookupFailed) {
      throw new Error('MongoDB Atlas SRV DNS lookup failed. Verify the exact cluster hostname copied from Atlas > Connect > Drivers, then run `node check-mongodb.js`. Do not change to mongodb:// by simply removing +srv; Atlas standard URIs require the exact seed hosts and options from Atlas.');
    }
    throw error;
  }
};
