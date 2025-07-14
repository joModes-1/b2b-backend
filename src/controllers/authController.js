const User = require('../models/User');
const { setUserRole } = require('../utils/userManagement');
const admin = require('../config/firebaseAdmin');
const jwt = require('jsonwebtoken');
const { generateVerificationToken, sendVerificationEmail } = require('../services/emailService');

// --- STUB HANDLERS FOR MISSING ROUTES ---
exports.login = (req, res) => res.status(501).json({ message: 'Login not implemented' });

// --- SECURE PHONE VERIFICATION FLOW ---
const crypto = require('crypto');
const africastalking = require('../services/smsService'); // or your AT client
// In-memory stores for dev
const phoneCodeStore = new Map();
const rateLimitStore = new Map();

// Send code (no user creation)
exports.sendVerificationCode = async (req, res) => {
  let { phoneNumber } = req.body;
  if (!phoneNumber) return res.status(400).json({ success: false, error: 'Phone number required' });
  // Normalize phone number to international format
  if (phoneNumber.startsWith('0')) phoneNumber = '+254' + phoneNumber.slice(1);
  if (!phoneNumber.startsWith('+')) return res.status(400).json({ success: false, error: 'Phone number must be in international format (e.g., +2547xxxxxxx)' });
  // Rate limit: 1 code per minute per phone
  const now = Date.now();
  const lastSent = rateLimitStore.get(phoneNumber);
  if (lastSent && now - lastSent < 60000) {
    return res.status(429).json({ success: false, error: 'Please wait before requesting another code.' });
  }
  // Generate the code ONCE and use it for both storage and SMS
  const code = crypto.randomInt(100000, 999999).toString();
  phoneCodeStore.set(phoneNumber, { code, expires: now + 5 * 60 * 1000 });
  rateLimitStore.set(phoneNumber, now);
  console.log(`[sendVerificationCode] Phone: ${phoneNumber}, Code: ${code}`);
  // Send the same code in the SMS
  const message = `Your verification code is: ${code}. It will expire in 10 minutes.`;
  await africastalking.sendSMS(phoneNumber, message);
  res.json({ success: true, message: 'Verification code sent.' });
};

// Verify code and register
exports.verifyCodeAndRegister = async (req, res) => {
  let { phoneNumber, code, name, email, password, role } = req.body;
  const missingFields = [];
  if (!phoneNumber) missingFields.push('phoneNumber');
  if (!code) missingFields.push('code');
  if (!name) missingFields.push('name');
  if (!email) missingFields.push('email');
  if (!password) missingFields.push('password');
  if (!role) missingFields.push('role');
  if (missingFields.length > 0) {
    return res.status(400).json({ 
      success: false,
      error: `Missing required fields: ${missingFields.join(', ')}`,
      received: req.body
    });
  }
  // Normalize phone number to international format
  if (phoneNumber.startsWith('0')) phoneNumber = '+254' + phoneNumber.slice(1);
  if (!phoneNumber.startsWith('+')) return res.status(400).json({ success: false, error: 'Phone number must be in international format (e.g., +2547xxxxxxx)' });
  const entry = phoneCodeStore.get(phoneNumber);
  const now = Date.now();
  console.log(`[verifyCodeAndRegister] Phone: ${phoneNumber}, Code: ${code}, Entry:`, entry);
  if (!entry) {
    return res.status(400).json({ success: false, error: 'No verification code found for this phone number. Please request a new code.' });
  }
  if (entry.code !== code) {
    return res.status(400).json({ success: false, error: 'Incorrect verification code. Please check and try again.' });
  }
  if (entry.expires < now) {
    return res.status(400).json({ success: false, error: 'Verification code has expired. Please request a new code.' });
  }
  phoneCodeStore.delete(phoneNumber); // One-time use
  let firebaseUser;
  try {
    firebaseUser = await admin.auth().createUser({
      phoneNumber,
      email,
      password,
      displayName: name,
    });
    await admin.auth().setCustomUserClaims(firebaseUser.uid, { role });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to create Firebase user: ' + err.message });
  }
  try {
    const user = new User({
      name,
      email,
      phoneNumber,
      role: role === 'buyer' ? 'buyer' : role,
      firebaseUid: firebaseUser.uid,
    });
    await user.save();
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to create user: ' + err.message });
  }
};

// Create user and send phone verification code
exports.createUserAndSendVerification = async (req, res) => {
  try {
    const { name, email, phoneNumber, password, role } = req.body;
    console.log('[createUserAndSendVerification] Incoming:', req.body);
    if (!phoneNumber || !email || !password || !role) {
      console.warn('[createUserAndSendVerification] Missing required fields');
      return res.status(400).json({ success: false, error: 'Missing required fields: name, email, phoneNumber, password, role' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [ { email }, { phoneNumber } ] });
    if (existingUser) {
      if (!existingUser.phoneVerified && !existingUser.emailVerified) {
        // Clean up incomplete registration
        await User.deleteOne({ _id: existingUser._id });
        console.warn('[createUserAndSendVerification] Deleted incomplete user:', existingUser._id);
      } else {
        console.warn('[createUserAndSendVerification] User already exists:', existingUser._id);
        return res.status(409).json({ success: false, error: 'User already exists with this email or phone number.' });
      }
    }

    // Create user in MongoDB
    const safeRole = role === 'buyer' ? 'buyer' : role;
    const newUser = new User({ name, email, phoneNumber, password, role: safeRole, phoneVerified: false });
    await newUser.save();
    console.log('[createUserAndSendVerification] Created user:', newUser._id);

    // Optionally, create user in Firebase here if needed (pseudo-code)
    // const firebaseUser = await admin.auth().createUser({ uid: newUser._id.toString(), email, phoneNumber, password });
    // console.log('[createUserAndSendVerification] Created Firebase user:', firebaseUser.uid);

    // Send verification code
    const verificationCode = await sendVerificationCode(phoneNumber);
    newUser.phoneVerificationCode = verificationCode;
    newUser.phoneVerificationExpires = Date.now() + 10 * 60 * 1000;
    await newUser.save();
    console.log('[createUserAndSendVerification] Sent verification code:', verificationCode);

    return res.status(201).json({ success: true, userId: newUser._id, message: 'User created and verification code sent.' });
  } catch (error) {
    console.error('[createUserAndSendVerification] Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Send phone verification code
exports.sendPhoneVerification = async (req, res) => {
  try {
    const { phoneNumber, userId } = req.body;
    
    if (!phoneNumber) {
      console.error('No phone number received in request!');
      return res.status(400).json({ message: 'Phone number is required' });
    }
    console.log('Phone verification request for:', phoneNumber);

    const verificationCode = await sendVerificationCode(phoneNumber);
    
    // Save verification code to user in database
    if (userId) {
      await User.findByIdAndUpdate(userId, {
        phoneVerificationCode: verificationCode,
        phoneVerificationExpires: Date.now() + 10 * 60 * 1000, // 10 minutes
        phoneNumber: phoneNumber
      });
    }
    
    res.status(200).json({ 
      success: true,
      message: 'Verification code sent',
      userId: userId
    });
  } catch (error) {
    console.error('Error sending verification code:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to send verification code', 
      error: error.message 
    });
  }
};

// Verify phone number
exports.verifyPhoneNumber = async (req, res) => {
  console.log('[verifyPhoneNumber] Incoming req.body:', req.body);
  console.log('[verifyPhoneNumber] userId:', req.body.userId, 'code:', req.body.code);
  try {
    const { userId, code } = req.body;
    
    if (!userId || !code) {
      return res.status(400).json({ 
        success: false,
        message: 'User ID and verification code are required' 
      });
    }

    const user = await User.findOne({
      _id: userId,
      phoneVerificationCode: code,
      phoneVerificationExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or expired verification code' 
      });
    }
    
    // Mark phone as verified and clear verification code
    user.phoneVerified = true;
    user.phoneVerificationCode = undefined;
    user.phoneVerificationExpires = undefined;
    await user.save();
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.status(200).json({ 
      success: true,
      verified: true,
      message: 'Phone number verified successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error verifying phone number:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to verify phone number', 
      error: error.message 
    });
  }
};

// Find userId by phoneNumber or email
exports.findUserIdByPhoneOrEmail = async (req, res) => {
  try {
    const { phoneNumber, email } = req.body;
    console.log('[findUserIdByPhoneOrEmail] Incoming body:', req.body);
    if (!phoneNumber && !email) {
      console.warn('[findUserIdByPhoneOrEmail] Missing phoneNumber and email in request body');
      return res.status(400).json({ success: false, error: 'Missing data: phone number or email is required.' });
    }
    let query = {};
    if (phoneNumber) {
      query.phoneNumber = phoneNumber;
    } else if (email) {
      query.email = email;
    }
    console.log('[findUserIdByPhoneOrEmail] Querying with:', query);
    const user = await User.findOne(query);
    if (!user) {
      console.warn('[findUserIdByPhoneOrEmail] No user found for:', query);
      return res.status(404).json({ success: false, error: `No user found for provided ${phoneNumber ? 'phone number' : 'email'}.` });
    }
    console.log('[findUserIdByPhoneOrEmail] Found userId:', user._id);
    return res.status(200).json({ success: true, userId: user._id });
  } catch (error) {
    console.error('[findUserIdByPhoneOrEmail] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error: ' + error.message });
  }
};

// API variant for /find-user-id-api
exports.findUserIdApi = async (req, res) => {
  console.log('[findUserIdApi] Body:', req.body);
  if (!req.body || (!req.body.phoneNumber && !req.body.email)) {
    return res.status(404).json({ success: false, message: 'Route not found' });
  }
  return exports.findUserIdByPhoneOrEmail(req, res);
};

// API variant for /auth/verify-code-and-register
exports.verifyCodeAndRegisterApi = async (req, res) => {
  console.log('[verifyCodeAndRegisterApi] Body:', req.body);
  if (!req.body || (!req.body.phoneNumber && !req.body.code)) {
    return res.status(404).json({ success: false, message: 'Route not found' });
  }
  return exports.verifyCodeAndRegister(req, res);
};

// Complete registration handler
exports.completeRegistration = async (req, res) => {
  try {
    const { uid, name, email, phoneNumber, role, companyName, address } = req.body;
    const files = req.files || [];

    // Check for existing user by email or phone
    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber }]
    });
    if (existingUser) {
      if (!existingUser.phoneVerified) {
        // Resend code
        const verificationCode = generateVerificationToken();
        existingUser.phoneVerificationCode = verificationCode;
        existingUser.phoneVerificationExpires = Date.now() + 10 * 60 * 1000;
        existingUser.status = 'pending';
        await existingUser.save();
        await sendVerificationCode(existingUser.phoneNumber, verificationCode);
        return res.status(200).json({
          success: true,
          alreadyExists: true,
          userId: existingUser._id,
          message: "You already have an account, please verify your phone. We've sent you a new code."
        });
      } else {
        return res.status(400).json({
          success: false,
          error: "Account already exists. Please log in."
        });
      }
    }

    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false,
        message: 'Phone number is required' 
      });
    }

    // Verify the JWT token
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Authentication token required' });
    }

    // Verify Firebase token
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== uid) {
      return res.status(403).json({ message: 'Token mismatch' });
    }

    // Check if user already exists
    let user = await User.findOne({ $or: [{ firebaseUid: uid }, { email }] });
    
    if (!user) {
      // Generate verification token
      const verificationToken = generateVerificationToken();
      const verificationExpires = new Date();
      verificationExpires.setHours(verificationExpires.getHours() + 24); // 24 hours expiration

      // Create new user if doesn't exist
      user = new User({
        firebaseUid: uid,
        email,
        phoneNumber,
        name,
        role: role || 'user',
        companyName: companyName || '',
        address: address || '',
        emailVerified: false,
        phoneVerified: false, // Will be set to true after verification
        emailVerificationToken: verificationToken,
        emailVerificationExpires: verificationExpires,
        documents: files
      });
      
      await user.save();
      
      // Set custom claims in Firebase
      await setUserRole(uid, [user.role]);
      
      // Send verification email
      await sendVerificationEmail(email, verificationToken);
    } else {
      // Update existing user
      user.name = name || user.name;
      user.role = role || user.role;
      user.companyName = companyName || user.companyName;
      user.contactNumber = contactNumber || user.contactNumber;
      user.address = address || user.address;
      
      if (files.length > 0) {
        user.documents = files;
      }
      
      await user.save();
    }

    // Update user profile
    user.name = name;
    user.email = email;
    user.role = role;
    user.companyName = companyName;
    user.contactNumber = contactNumber;
    user.address = address;

    // Handle uploaded documents
    if (files.length > 0) {
      user.documents = files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype
      }));
    }

    await user.save();
    
    // Update Firebase custom claims
    await setUserRole(uid, [role]);

    res.status(200).json({
      message: 'Registration completed successfully',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
};

// Google Sign-In handler
exports.googleSignIn = async (req, res) => {
  console.log('Google Sign-In request received on backend.');
  try {
    const { role } = req.body;
    const idToken = req.headers.authorization?.split(' ')[1];
    console.log('Role received:', role);
    console.log('ID Token received (first 10 chars):', idToken ? idToken.substring(0, 10) : 'No token');

    if (!idToken) {
      return res.status(401).json({ message: 'Authentication token is required.' });
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log('Token verified successfully for UID:', decodedToken.uid);
    const { uid, email, name, picture } = decodedToken;

    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      console.log('User not found in DB, creating a new user...');
      const userRole = role === 'seller' ? 'seller' : 'user';
      console.log('Assigning role:', userRole);

      user = new User({
        firebaseUid: uid,
        email,
        name,
        role: userRole,
        profilePicture: picture,
        verified: true, // Google-verified users can be considered verified
      });

      await user.save();
      console.log('New user saved to DB successfully.');

      // Set custom claims in Firebase
      await setUserRole(uid, [userRole]);
      console.log('Custom claims set in Firebase.');
    } else {
      console.log('User found in DB:', user.email);
    }

    // Generate a session token for our app
    const appToken = jwt.sign(
      { id: user._id, firebaseUid: user.firebaseUid, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({ 
      message: 'Authentication successful.',
      token: appToken,
      user: user.toJSON() 
    });

  } catch (error) {
    console.error('Google Sign-In Error:', error);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ message: 'Token expired, please sign in again.' });
    }
    res.status(500).json({ message: 'An error occurred during Google Sign-In.', error: error.message });
  }
};

// Email verification
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    // Find user with matching token and check expiration
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid or expired verification token' 
      });
    }

    // Mark email as verified and clear verification token
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();

    // Update Firebase auth custom claims if needed
    try {
      await admin.auth().setCustomUserClaims(user.firebaseUid, { 
        ...(await admin.auth().getUser(user.firebaseUid)).customClaims || {},
        email_verified: true
      });
    } catch (firebaseError) {
      console.error('Error updating Firebase custom claims:', firebaseError);
      // Continue even if Firebase update fails
    }

    res.status(200).json({ 
      success: true, 
      message: 'Email verified successfully' 
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error verifying email', 
      error: error.message 
    });
  }
};

// Resend verification email
exports.resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;
    
    // Find user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'No account found with this email' 
      });
    }
    
    if (user.emailVerified) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email is already verified' 
      });
    }
    
    // Generate new verification token
    const verificationToken = generateVerificationToken();
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);
    
    // Update user with new token
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = verificationExpires;
    await user.save();
    
    // Send verification email
    await sendVerificationEmail(email, verificationToken);
    
    res.status(200).json({ 
      success: true, 
      message: 'Verification email sent successfully' 
    });
  } catch (error) {
    console.error('Resend verification email error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error resending verification email', 
      error: error.message 
    });
  }
};

// Update phone verification status
exports.updatePhoneVerification = async (req, res) => {
  try {
    const { phoneNumber, isVerified } = req.body;
    const userId = req.user.id; // Get user ID from the authenticated request
    
    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false,
        message: 'Phone number is required' 
      });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }
    
    // Update phone verification status
    user.phoneNumber = phoneNumber;
    user.isPhoneVerified = isVerified;
    user.phoneVerificationCode = undefined;
    user.phoneVerificationExpires = undefined;
    
    await user.save();
    
    res.status(200).json({ 
      success: true,
      message: 'Phone verification status updated',
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        isPhoneVerified: user.isPhoneVerified
      }
    });
    
  } catch (error) {
    console.error('Error updating phone verification:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to update phone verification status',
      error: error.message 
    });
  }
};

// Logout
exports.logout = async (req, res) => {
  try {
    // In a real app, you would invalidate the token here
    res.status(200).json({ 
      success: true, 
      message: 'Successfully logged out' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Error logging out', 
      error: error.message 
    });
  }
};

// Ensure signup is defined after all functions
exports.signup = exports.completeRegistration;