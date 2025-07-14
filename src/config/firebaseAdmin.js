const admin = require('firebase-admin');

try {
  // Load service account from base64 environment variable
  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!base64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 env variable not set');
  const jsonStr = Buffer.from(base64, 'base64').toString('utf-8');
  const serviceAccount = JSON.parse(jsonStr);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error(
    'CRITICAL ERROR: Failed to initialize Firebase Admin SDK.\n' +
    'Make sure your FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable is set with the correct JSON.\n' +
    'The application cannot start without it.\n',
    error
  );
  process.exit(1); // Exit if the admin SDK fails to initialize
}

module.exports = admin;
