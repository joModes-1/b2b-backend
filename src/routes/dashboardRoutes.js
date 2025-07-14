const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { getSellerStats, getAdminStats } = require('../controllers/dashboardController');
const { isAdmin } = require('../middleware/auth');

// Get seller dashboard statistics
router.get('/seller/stats', verifyToken, getSellerStats);

// Get admin dashboard statistics
router.get('/admin/stats', verifyToken, isAdmin, getAdminStats);

module.exports = router; 