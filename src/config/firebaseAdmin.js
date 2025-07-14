const admin = require('firebase-admin');

try {
  const serviceAccount = require('./serviceAccountKey.json');

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error(
    'CRITICAL ERROR: Failed to initialize Firebase Admin SDK. \n' +
    'Make sure your `serviceAccountKey.json` is placed in the `backend/src/config/` directory. \n' +
    'The application cannot start without it. \n',
    error
  );
  process.exit(1); // Exit if the admin SDK fails to initialize
}

module.exports = admin;
