const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  createInvoice,
  getVendorInvoices,
  getBuyerInvoices,
  getInvoice,
  updateInvoice,
  sendInvoice,
  initiatePayment,
  verifyPayment
} = require('../controllers/invoiceController');

// Create new invoice
router.post('/', verifyToken, createInvoice);

// Get all invoices for vendor
router.get('/vendor', verifyToken, getVendorInvoices);

// Get all invoices for buyer
router.get('/buyer', verifyToken, getBuyerInvoices);

// Get single invoice
router.get('/:id', verifyToken, getInvoice);

// Update invoice
router.patch('/:id', verifyToken, updateInvoice);

// Send invoice
router.post('/:id/send', verifyToken, sendInvoice);

// Payment routes
router.post('/:id/pay', verifyToken, initiatePayment);
router.post('/:id/verify-payment', verifyToken, verifyPayment);

module.exports = router; 