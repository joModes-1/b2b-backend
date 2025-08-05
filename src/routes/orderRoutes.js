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
  confirmPayment,
  initiatePayment,
  verifyPayment
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

// Initiate payment
router.post('/:id/initiate-payment', verifyToken, initiatePayment);

// Verify payment
router.post('/:id/verify-payment', verifyToken, verifyPayment);

// Confirm a payment was successful (legacy route)
router.post('/verify-payment/:id', verifyToken, confirmPayment);

module.exports = router; 