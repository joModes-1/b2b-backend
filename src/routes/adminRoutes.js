const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/adminAuth');
const {
  getDashboardData,
  getUsers,
  getListings,
  getPendingApprovals,
  updateVendorStatus,
  updateProductStatus,
  updateUserStatus,
  updateListingStatus,
  exportToCsv,
  exportToPdf
} = require('../controllers/adminController');

// Dashboard
router.get('/dashboard', isAdmin, getDashboardData);

// User management
router.get('/users', isAdmin, getUsers);
router.patch('/users/:id/status', isAdmin, updateUserStatus);

// Pending approvals
router.get('/pending', isAdmin, getPendingApprovals);
router.patch('/vendors/:id/status', isAdmin, updateVendorStatus);
router.patch('/products/:id/status', isAdmin, updateProductStatus);

// Product management
router.get('/listings', isAdmin, getListings);
router.patch('/listings/:id/status', isAdmin, updateListingStatus);

// Data export
router.get('/export/csv', isAdmin, exportToCsv);
router.get('/export/pdf', isAdmin, exportToPdf);

module.exports = router; 