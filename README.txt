OMNIMART PK — TABBED ADMIN DASHBOARD
====================================

This project updates the admin UI to a single-page tabbed dashboard. Sections are Overview, Products (add/search/list/delete), COD Orders (view/update status), and Create Seller. Switching tabs does not reload the page. Existing Express API routes and MongoDB models are retained.

RUN LOCALLY
1. Install Node.js and MongoDB, or use MongoDB Atlas.
2. Copy .env.example to a file named exactly .env in this project root, beside server.js and package.json. On Windows, make sure the file is not named .env.txt. Set MONGODB_URI to your actual MongoDB Atlas connection string. Never publish .env.
3. In MongoDB Atlas, add your current IP under Network Access and create a database user. Replace the username and password placeholders in the connection string; URL-encode special characters in the password if needed.
4. In a terminal opened in this project folder, run: npm install
5. Before starting, run: node check-env.js. This safe diagnostic prints the .env path, encoding, and whether MONGODB_URI exists; it never prints secret values.
6. Run: npm start
7. Open http://localhost:5000/login.html and sign in with the admin values configured in .env.

DEPLOY
Upload these project files to your deployment service and set PORT, MONGODB_URI, JWT_SECRET, ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD in its environment settings. Redeploy after updating files. Do not upload .env or share credentials in screenshots.

MONGODB_URI EXAMPLE
mongodb+srv://DB_USERNAME:DB_PASSWORD@YOUR_REAL_CLUSTER_HOST/omnimart?retryWrites=true&w=majority
In Atlas, open Database > Connect > Drivers and copy the URI shown there. Replace the username, password, and host with your actual values; do not leave xxxxx/xxx/example values or type angle brackets around the password. If the password contains reserved characters such as @ or :, percent-encode them. Keep the URI private.
Save .env as UTF-8 if possible; the app also reads UTF-16 files saved by Windows Notepad.

DATABASE DIAGNOSTICS
Run: npm run check:env
Run: npm run check:mongodb
The second command checks the URI hostname and, for mongodb+srv://, whether this computer can resolve its Atlas SRV DNS record. It never prints username or password.
At startup, if a mongodb+srv:// URI has an accidental numeric port such as :27017 at the end of its host, the app removes that invalid host port and repeated colons in the host only. It does not edit username/password. Still remove the port from .env so the saved URI stays correct.
If it reports ENOTFOUND, the cluster host is usually a placeholder/typo or the current network DNS cannot find the SRV record. Re-copy the exact Atlas host and try from another network or DNS resolver if the host is correct.
Use npm start (or node server.js) to launch the app. Do not use node start; Node interprets start as a JavaScript filename.

Do not try to turn an Atlas SRV URI into a standard URI by just removing +srv. Atlas standard format requires the actual list of seed hosts and connection options; copy the standard option from Atlas if you need it.

If the app reports ECONNREFUSED 127.0.0.1:27017, it is running old code or did not load the updated project/.env. Confirm the terminal's current folder is this project, confirm .env is beside server.js, then stop the old server and run npm start again. The updated database setup does not fall back to localhost when MONGODB_URI is missing.

IMPORTANT ABOUT ADMIN PASSWORD
The server creates the initial admin only when that email does not already exist in the database. Changing ADMIN_PASSWORD later will not overwrite an existing admin account's password.

API FEATURES USED BY THE DASHBOARD
- POST /api/products and GET /api/products?all=true; DELETE /api/products/:id
- GET /api/orders and PATCH /api/orders/:id/status
- POST /api/auth/sellers
Management requests use the existing Bearer token and role checks.
