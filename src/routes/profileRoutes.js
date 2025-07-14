const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const profileController = require('../controllers/profileController');
const upload = require('../middleware/upload');

// Debug route registration
console.log('Setting up profile routes...');

// Get the currently authenticated user's profile
router.get('/me', verifyToken, profileController.getMe);

// Get user profile
router.get('/', verifyToken, profileController.getProfile);

// Update user profile
router.put('/', verifyToken, profileController.updateProfile);

// Upload profile picture
router.post('/picture', verifyToken, upload.single('profilePicture'), profileController.uploadProfilePicture);

// Delete profile picture
router.delete('/picture', verifyToken, profileController.deleteProfilePicture);

// Debug route registration
console.log('Profile routes set up successfully');

module.exports = router; 