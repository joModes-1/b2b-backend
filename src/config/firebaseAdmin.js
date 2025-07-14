const admin = require('firebase-admin');

try {
  // Load service account from environment variable
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error(
    'CRITICAL ERROR: Failed to initialize Firebase Admin SDK.\n' +
    'Make sure your FIREBASE_SERVICE_ACCOUNT environment variable is set with the correct JSON.\n' +
    'The application cannot start without it.\n',
    error
  );
  process.exit(1); // Exit if the admin SDK fails to initialize
}

module.exports = admin;
