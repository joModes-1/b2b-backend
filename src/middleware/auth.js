const admin = require('../config/firebaseAdmin');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Verify token (backend JWT token or Firebase ID token)
const verifyToken = async (req, res, next) => {
  console.log(`verifyToken invoked for: ${req.method} ${req.originalUrl}`);
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  let userProfile = null;
  let verificationMethod = null;

  // First, try to verify as backend JWT token (most common case after login)
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Token verified as backend JWT for user ID:', decoded.id);
    
    // Fetch user profile from database using the ID from JWT
    userProfile = await User.findById(decoded.id);
    
    if (userProfile) {
      verificationMethod = 'JWT';
    } else {
      console.warn(`User with ID ${decoded.id} not found in database.`);
    }
  } catch (jwtError) {
    // JWT verification failed, this is normal if it's a Firebase token
    console.log('Not a backend JWT token:', jwtError.message);
  }

  // If JWT verification didn't work, try Firebase ID token
  if (!userProfile) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      console.log('Token verified as Firebase ID token for UID:', decodedToken.uid);
      
      // Fetch user profile from database using Firebase UID
      userProfile = await User.findOne({ firebaseUid: decodedToken.uid });
      
      if (userProfile) {
        verificationMethod = 'Firebase';
      } else {
        console.warn(`User with UID ${decodedToken.uid} found in Firebase but not in local database.`);
      }
    } catch (firebaseError) {
      // Firebase verification also failed
      console.log('Not a Firebase token either:', firebaseError.message);
    }
  }

  // Check if we successfully verified and found a user
  if (!userProfile) {
    console.error('Token verification failed - no valid user found');
    return res.status(401).json({ 
      message: 'Invalid or expired authentication token.', 
      code: 'INVALID_TOKEN' 
    });
  }

  // Attach the full user profile from the database to the request object
  req.user = userProfile;
  console.log(`Token verified (${verificationMethod}) for: ${userProfile.email} (Role: ${userProfile.role})`);
  
  next();
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