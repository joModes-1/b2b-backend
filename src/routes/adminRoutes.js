const express = require('express');
const router = express.Router();
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
router.get('/dashboard', getDashboardData);

// User management
router.get('/users', getUsers);
router.patch('/users/:id/status', updateUserStatus);

// Pending approvals
router.get('/pending', getPendingApprovals);
router.patch('/vendors/:id/status', updateVendorStatus);
router.patch('/products/:id/status', updateProductStatus);

// Product management
router.get('/listings', getListings);
router.patch('/listings/:id/status', updateListingStatus);

// Data export
router.get('/export/csv', exportToCsv);
router.get('/export/pdf', exportToPdf);

module.exports = router; 