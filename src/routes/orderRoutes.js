const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  createOrder,
  getBuyerOrders,
  getVendorOrders,
  getOrder,
  updateOrderStatus,
  cancelOrder,
  confirmPayment
} = require('../controllers/orderController');

// Create new order
router.post('/', verifyToken, createOrder);

// Get all orders for buyer
router.get('/buyer', verifyToken, getBuyerOrders);

// Get all orders for seller
router.get('/seller', verifyToken, getVendorOrders);

// Get single order
router.get('/:id', verifyToken, getOrder);

// Update order status (vendor only)
router.patch('/:id/status', verifyToken, updateOrderStatus);

// Cancel order
router.post('/:id/cancel', verifyToken, cancelOrder);

// Verify a payment was successful
router.post('/verify-payment/:id', verifyToken, confirmPayment);

module.exports = router; 