const admin = require('../config/firebaseAdmin');
const User = require('../models/User');

// Verify Firebase ID token
const verifyToken = async (req, res, next) => {
  console.log(`verifyToken invoked for: ${req.method} ${req.originalUrl}`);
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);

    // Token is valid, now fetch the full user profile from the database
    const userProfile = await User.findOne({ firebaseUid: decodedToken.uid });

    if (!userProfile) {
      // This case can happen if a user exists in Firebase but not in the local DB
      // (e.g., if DB record was deleted manually or registration failed partway).
      console.warn(`User with UID ${decodedToken.uid} found in Firebase but not in local database.`);
      return res.status(403).json({ message: 'User profile not found in our system.', code: 'USER_NOT_FOUND' });
    }

    // Attach the full, rich user profile from the database to the request object
    req.user = userProfile;

    console.log(`Token verified and user profile loaded for: ${userProfile.email} (Role: ${userProfile.role})`);
    next();
  } catch (error) {
    console.warn(`Token verification failed with code: ${error.code || 'UNKNOWN_ERROR'}`);
    console.error('Error verifying token details:', error);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: 'Firebase ID token has expired. Please refresh and try again.', code: 'TOKEN_EXPIRED' });
    }
    res.status(401).json({ message: 'Invalid or malformed token.', code: 'INVALID_TOKEN' });
  }
};

// Check if user has required role
const checkRole = (requiredRoles) => {
  return (req, res, next) => {
    try {
      // After the updated verifyToken, req.user is the full user profile from the DB.
      const userRole = req.user.role;

      if (!req.user || !userRole) {
        console.log('No user or role found in request object');
        return res.status(403).json({ message: 'Access denied. User role not specified.' });
      }

      // Check if the user's role is included in the list of required roles.
      const hasRequiredRole = requiredRoles.includes(userRole);

      if (!hasRequiredRole) {
        console.log('Insufficient permissions');
        return res.status(403).json({
          message: 'Access denied. Insufficient permissions.'
        });
      }

      console.log('Role check passed');
      next();
    } catch (error) {
      console.error('Role check error:', error);
      res.status(500).json({ message: 'Error checking user role', error: error.message });
    }
  };
};

const isAdmin = checkRole(['admin']);

module.exports = { verifyToken, checkRole, isAdmin };