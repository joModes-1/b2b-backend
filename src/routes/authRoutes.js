const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');

// Public routes
router.post('/signup', authController.signup);
router.post('/login', authController.login);
router.post('/google-signin', authController.googleSignIn);

// Phone verification routes (Africa's Talking compatible)

router.post('/send-verification-code', authController.sendVerificationCode);
router.post('/verify-code-and-register', authController.verifyCodeAndRegister);
router.post('/auth/verify-code-and-register', authController.verifyCodeAndRegisterApi);




// Logout route
router.post('/logout', authController.logout);

// Email verification routes
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerificationEmail);

// Update phone verification status (requires authentication)
router.post('/update-phone-verification', verifyToken, authController.updatePhoneVerification);

// Find userId by phoneNumber or email (supports both POST and GET for flexibility)
router.post('/find-user-id', authController.findUserIdByPhoneOrEmail);
router.post('/find-user-id-api', authController.findUserIdApi);
router.get('/find-user-id', authController.findUserIdByPhoneOrEmail);

// Route to complete user registration after Firebase user creation and set custom claims
// The 'documents' field name should match the name used in the FormData on the frontend
router.post('/complete-registration', upload.array('documents', 5), authController.completeRegistration);

module.exports = router;