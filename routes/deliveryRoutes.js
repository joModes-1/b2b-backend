const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../src/models/User');
const Order = require('../src/models/Order');
const { verifyToken: auth } = require('../src/middleware/auth');

// Delivery personnel login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find delivery personnel
    const user = await User.findOne({ 
      email: email.toLowerCase(),
      role: 'delivery'
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token (must use 'id' field for auth middleware compatibility)
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Delivery login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get delivery personnel profile
router.get('/profile', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // req.user already contains the full user document from auth middleware
    res.json(req.user);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get delivery statistics
router.get('/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's deliveries
    const todayDeliveries = await Order.countDocuments({
      deliveryPersonId: req.user._id,
      deliveredAt: { $gte: today, $lt: tomorrow }
    });

    // Get pending deliveries
    const pendingDeliveries = await Order.countDocuments({
      deliveryPersonId: req.user._id,
      status: 'in-transit'
    });

    // Get total deliveries
    const totalDeliveries = await Order.countDocuments({
      deliveryPersonId: req.user._id,
      status: 'delivered'
    });

    // Calculate today's earnings (assuming 5% commission on delivered orders)
    const todayOrders = await Order.find({
      deliveryPersonId: req.user._id,
      deliveredAt: { $gte: today, $lt: tomorrow }
    });

    const earnings = todayOrders.reduce((total, order) => {
      return total + (order.deliveryFee || 0);
    }, 0);

    res.json({
      todayDeliveries,
      pendingDeliveries,
      totalDeliveries,
      earnings
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get recent orders for delivery person
router.get('/recent-orders', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const orders = await Order.find({
      deliveryPersonId: req.user._id
    })
    .populate('buyerId', 'name email phoneNumber')
    .populate('sellerId', 'name businessInfo')
    .sort({ createdAt: -1 })
    .limit(10);

    const formattedOrders = orders.map(order => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      buyerName: order.buyerId?.name || 'Unknown',
      deliveryAddress: order.deliveryAddress,
      status: order.status,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt
    }));

    res.json(formattedOrders);
  } catch (error) {
    console.error('Recent orders fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Scan QR code and get order details
router.post('/scan-order', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { qrData, orderId } = req.body;

    if (!qrData || !orderId) {
      return res.status(400).json({ message: 'QR data and order ID are required' });
    }

    // Find the order
    const order = await Order.findOne({
      $or: [
        { _id: orderId },
        { orderNumber: orderId }
      ]
    })
    .populate('buyerId', 'name email phoneNumber')
    .populate('sellerId', 'name businessInfo phoneNumber businessLocation');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Verify QR code format (should contain order and buyer info)
    const expectedQRPattern = new RegExp(`ORDER_${order.orderNumber}_BUYER_${order.buyerId._id}`);
    if (!expectedQRPattern.test(qrData)) {
      return res.status(400).json({ message: 'Invalid QR code for this order' });
    }

    // Check if order is ready for delivery
    if (order.status !== 'confirmed' && order.status !== 'in-transit') {
      return res.status(400).json({ 
        message: `Order cannot be delivered. Current status: ${order.status}` 
      });
    }

    // Update order status to in-transit if it's confirmed
    if (order.status === 'confirmed') {
      order.status = 'in-transit';
      order.deliveryPersonId = req.user._id;
      await order.save();
    }

    // Format order data for delivery app
    const orderData = {
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      buyerName: order.buyerId.name,
      buyerEmail: order.buyerId.email,
      buyerPhone: order.buyerId.phoneNumber,
      deliveryAddress: order.deliveryAddress,
      deliveryCity: order.deliveryCity,
      deliveryPhone: order.deliveryPhone,
      sellerName: order.sellerId.name,
      sellerPhone: order.sellerId.phoneNumber,
      sellerLocation: order.sellerId.businessLocation?.formattedAddress || 'Not specified',
      items: order.items,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      totalAmount: order.totalAmount,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt
    };

    res.json({
      success: true,
      order: orderData
    });
  } catch (error) {
    console.error('QR scan error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get specific order details
router.get('/order/:orderId', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { orderId } = req.params;

    const order = await Order.findOne({
      $or: [
        { _id: orderId },
        { orderNumber: orderId }
      ]
    })
    .populate('buyerId', 'name email phoneNumber')
    .populate('sellerId', 'name businessInfo phoneNumber businessLocation');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Format order data
    const orderData = {
      _id: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      buyerName: order.buyerId.name,
      buyerEmail: order.buyerId.email,
      buyerPhone: order.buyerId.phoneNumber,
      deliveryAddress: order.deliveryAddress,
      deliveryCity: order.deliveryCity,
      deliveryPhone: order.deliveryPhone,
      sellerName: order.sellerId.name,
      sellerPhone: order.sellerId.phoneNumber,
      sellerLocation: order.sellerId.businessLocation?.formattedAddress || 'Not specified',
      items: order.items,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      totalAmount: order.totalAmount,
      paymentStatus: order.paymentStatus,
      deliveredAt: order.deliveredAt,
      createdAt: order.createdAt
    };

    res.json({ order: orderData });
  } catch (error) {
    console.error('Order fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark order as delivered
router.post('/mark-delivered', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { orderId, orderNumber } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: 'Order ID is required' });
    }

    const order = await Order.findOne({
      $or: [
        { _id: orderId },
        { orderNumber: orderNumber }
      ]
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Verify delivery person is assigned to this order
    if (order.deliveryPersonId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not assigned to this order' });
    }

    // Check if order is in correct status
    if (order.status !== 'in-transit') {
      return res.status(400).json({ 
        message: `Order cannot be marked as delivered. Current status: ${order.status}` 
      });
    }

    // Update order status
    order.status = 'delivered';
    order.deliveredAt = new Date();
    await order.save();

    res.json({
      success: true,
      message: 'Order marked as delivered successfully',
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveredAt: order.deliveredAt
      }
    });
  } catch (error) {
    console.error('Mark delivered error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Process payment to seller (release from sub-account to mobile money)
router.post('/process-payment', auth, async (req, res) => {
  try {
    if (req.user.role !== 'delivery') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { orderId, sellerId, amount } = req.body;

    if (!orderId || !sellerId || !amount) {
      return res.status(400).json({ message: 'Order ID, seller ID, and amount are required' });
    }

    // Find the order and seller
    const [order, seller] = await Promise.all([
      Order.findById(orderId),
      User.findById(sellerId)
    ]);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (!seller) {
      return res.status(404).json({ message: 'Seller not found' });
    }

    // Verify order is delivered
    if (order.status !== 'delivered') {
      return res.status(400).json({ message: 'Order must be delivered before processing payment' });
    }

    // Check if payment already processed
    if (order.paymentStatus === 'released') {
      return res.status(400).json({ message: 'Payment already processed for this order' });
    }

    // TODO: Integrate with actual mobile money API (MTN MoMo, Airtel Money, etc.)
    // For now, we'll simulate the payment process
    
    try {
      // Simulate mobile money transfer
      const paymentResult = await simulateMobileMoneyTransfer({
        recipientPhone: seller.phoneNumber,
        amount: amount,
        reference: `ORDER_${order.orderNumber}_PAYMENT`,
        description: `Payment for order ${order.orderNumber}`
      });

      if (paymentResult.success) {
        // Update order payment status
        order.paymentStatus = 'released';
        order.paymentReleasedAt = new Date();
        order.paymentReference = paymentResult.transactionId;
        await order.save();

        res.json({
          success: true,
          message: 'Payment processed successfully',
          transactionId: paymentResult.transactionId
        });
      } else {
        throw new Error(paymentResult.error);
      }
    } catch (paymentError) {
      console.error('Payment processing error:', paymentError);
      res.status(500).json({ 
        success: false,
        message: 'Payment processing failed',
        error: paymentError.message 
      });
    }
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Simulate mobile money transfer (replace with actual API integration)
async function simulateMobileMoneyTransfer({ recipientPhone, amount, reference, description }) {
  return new Promise((resolve) => {
    // Simulate API call delay
    setTimeout(() => {
      // Simulate 95% success rate
      const success = Math.random() > 0.05;
      
      if (success) {
        resolve({
          success: true,
          transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          message: 'Transfer completed successfully'
        });
      } else {
        resolve({
          success: false,
          error: 'Mobile money transfer failed'
        });
      }
    }, 2000); // 2 second delay to simulate API call
  });
}

module.exports = router;
