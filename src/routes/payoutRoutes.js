const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');

// Payout Schema
const payoutSchema = new mongoose.Schema({
  payoutId: {
    type: String,
    unique: true,
    required: true,
    default: function() {
      return 'PAY-' + Date.now() + '-' + require('crypto').randomBytes(4).toString('hex').toUpperCase();
    }
  },
  wholesaler: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  orders: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }],
  grossAmount: {
    type: Number,
    required: true
  },
  totalCommission: {
    type: Number,
    required: true
  },
  totalFees: {
    type: Number,
    default: 0
  },
  netAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['mobile_money', 'bank_transfer'],
    default: 'mobile_money'
  },
  paymentDetails: {
    provider: String,
    accountNumber: String,
    accountName: String,
    transactionId: String,
    reference: String
  },
  attempts: {
    type: Number,
    default: 0
  },
  lastAttemptAt: Date,
  completedAt: Date,
  notes: String,
  auditTrail: [{
    action: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    details: String
  }]
}, {
  timestamps: true
});

const Payout = mongoose.model('Payout', payoutSchema);

// Calculate pending payouts for all wholesalers
router.get('/pending', async (req, res) => {
  try {
    // Find all paid orders with unpaid commission
    const orders = await Order.find({
      isPaid: true,
      'commission.status': 'collected',
      status: { $in: ['delivered', 'completed'] }
    }).populate('items.sellerId', 'name phoneNumber email');

    // Group by seller
    const sellerPayouts = {};
    
    for (const order of orders) {
      // Group items by seller
      const sellerItems = {};
      
      for (const item of order.items) {
        const sellerId = item.sellerId._id.toString();
        if (!sellerItems[sellerId]) {
          sellerItems[sellerId] = {
            seller: item.sellerId,
            items: [],
            subtotal: 0
          };
        }
        sellerItems[sellerId].items.push(item);
        sellerItems[sellerId].subtotal += item.price * item.quantity;
      }
      
      // Calculate payout for each seller in this order
      for (const sellerId in sellerItems) {
        if (!sellerPayouts[sellerId]) {
          sellerPayouts[sellerId] = {
            seller: sellerItems[sellerId].seller,
            orders: [],
            grossAmount: 0,
            totalCommission: 0,
            totalFees: 0,
            netAmount: 0
          };
        }
        
        // Calculate seller's portion of the order
        const sellerPortion = sellerItems[sellerId].subtotal / order.subtotal;
        const sellerCommission = Math.round(order.commission.amount * sellerPortion);
        const sellerFees = Math.round(order.estimatedMobileFees * sellerPortion);
        const sellerNet = sellerItems[sellerId].subtotal - sellerCommission - sellerFees;
        
        sellerPayouts[sellerId].orders.push({
          orderId: order._id,
          orderNumber: order.orderId,
          amount: sellerItems[sellerId].subtotal,
          commission: sellerCommission,
          fees: sellerFees,
          net: sellerNet
        });
        
        sellerPayouts[sellerId].grossAmount += sellerItems[sellerId].subtotal;
        sellerPayouts[sellerId].totalCommission += sellerCommission;
        sellerPayouts[sellerId].totalFees += sellerFees;
        sellerPayouts[sellerId].netAmount += sellerNet;
      }
    }
    
    // Convert to array
    const pendingPayouts = Object.values(sellerPayouts);
    
    res.json({
      success: true,
      totalPending: pendingPayouts.length,
      totalAmount: pendingPayouts.reduce((sum, p) => sum + p.netAmount, 0),
      payouts: pendingPayouts
    });
  } catch (error) {
    console.error('Error calculating pending payouts:', error);
    res.status(500).json({ error: 'Failed to calculate pending payouts' });
  }
});

// Create payout for a specific wholesaler
router.post('/create', async (req, res) => {
  try {
    const { wholesalerId, orderIds } = req.body;
    
    // Verify wholesaler exists and is a seller
    const wholesaler = await User.findById(wholesalerId);
    if (!wholesaler || wholesaler.role !== 'seller') {
      return res.status(404).json({ error: 'Wholesaler not found' });
    }
    
    // Get orders
    const orders = await Order.find({
      _id: { $in: orderIds },
      isPaid: true,
      'commission.status': 'collected'
    });
    
    if (orders.length === 0) {
      return res.status(400).json({ error: 'No eligible orders found' });
    }
    
    // Calculate totals
    let grossAmount = 0;
    let totalCommission = 0;
    let totalFees = 0;
    
    for (const order of orders) {
      // Calculate seller's portion of each order
      const sellerItems = order.items.filter(item => 
        item.sellerId.toString() === wholesalerId
      );
      
      const sellerSubtotal = sellerItems.reduce((sum, item) => 
        sum + (item.price * item.quantity), 0
      );
      
      const sellerPortion = sellerSubtotal / order.subtotal;
      
      grossAmount += sellerSubtotal;
      totalCommission += Math.round(order.commission.amount * sellerPortion);
      totalFees += Math.round(order.estimatedMobileFees * sellerPortion);
    }
    
    const netAmount = grossAmount - totalCommission - totalFees;
    
    // Create payout record
    const payout = new Payout({
      wholesaler: wholesalerId,
      orders: orderIds,
      grossAmount,
      totalCommission,
      totalFees,
      netAmount,
      paymentDetails: {
        provider: wholesaler.preferredPaymentProvider || 'mtn',
        accountNumber: wholesaler.phoneNumber,
        accountName: wholesaler.name
      },
      auditTrail: [{
        action: 'created',
        details: `Payout created for ${orders.length} orders`
      }]
    });
    
    await payout.save();
    
    // Update orders to mark commission as being processed
    await Order.updateMany(
      { _id: { $in: orderIds } },
      { 'commission.status': 'processing' }
    );
    
    res.json({
      success: true,
      message: 'Payout created successfully',
      payout
    });
  } catch (error) {
    console.error('Error creating payout:', error);
    res.status(500).json({ error: 'Failed to create payout' });
  }
});

// Process payout (simulate mobile money transfer in MVP)
router.post('/process/:payoutId', async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { adminId } = req.body;
    
    const payout = await Payout.findOne({ payoutId }).populate('wholesaler');
    if (!payout) {
      return res.status(404).json({ error: 'Payout not found' });
    }
    
    if (payout.status !== 'pending') {
      return res.status(400).json({ error: `Payout is already ${payout.status}` });
    }
    
    payout.status = 'processing';
    payout.attempts += 1;
    payout.lastAttemptAt = new Date();
    payout.auditTrail.push({
      action: 'processing',
      performedBy: adminId,
      details: 'Initiating mobile money transfer'
    });
    
    await payout.save();
    
    // Simulate mobile money API call (in production, integrate actual API)
    setTimeout(async () => {
      try {
        // Simulate success (90% success rate for testing)
        const isSuccess = Math.random() > 0.1;
        
        if (isSuccess) {
          payout.status = 'completed';
          payout.completedAt = new Date();
          payout.paymentDetails.transactionId = 'TXN-' + Date.now();
          payout.paymentDetails.reference = 'REF-' + Date.now();
          payout.auditTrail.push({
            action: 'completed',
            details: 'Mobile money transfer successful'
          });
          
          // Update orders to mark commission as paid
          await Order.updateMany(
            { _id: { $in: payout.orders } },
            { 'commission.status': 'paid' }
          );
        } else {
          // Simulate failure
          payout.status = 'failed';
          payout.auditTrail.push({
            action: 'failed',
            details: 'Mobile money transfer failed - insufficient balance'
          });
          
          // Revert orders commission status
          await Order.updateMany(
            { _id: { $in: payout.orders } },
            { 'commission.status': 'collected' }
          );
        }
        
        await payout.save();
        
        // TODO: Send notification to wholesaler
        
      } catch (error) {
        console.error('Error in payout processing:', error);
      }
    }, 3000); // 3 second delay to simulate API call
    
    res.json({
      success: true,
      message: 'Payout processing initiated',
      payout
    });
  } catch (error) {
    console.error('Error processing payout:', error);
    res.status(500).json({ error: 'Failed to process payout' });
  }
});

// Retry failed payout with exponential backoff
router.post('/retry/:payoutId', async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { adminId } = req.body;
    
    const payout = await Payout.findOne({ payoutId });
    if (!payout) {
      return res.status(404).json({ error: 'Payout not found' });
    }
    
    if (payout.status !== 'failed') {
      return res.status(400).json({ error: 'Can only retry failed payouts' });
    }
    
    // Exponential backoff: 2^attempts minutes
    const minutesSinceLastAttempt = (Date.now() - payout.lastAttemptAt) / (1000 * 60);
    const requiredWaitTime = Math.pow(2, payout.attempts);
    
    if (minutesSinceLastAttempt < requiredWaitTime) {
      return res.status(429).json({ 
        error: 'Too soon to retry',
        waitMinutes: Math.ceil(requiredWaitTime - minutesSinceLastAttempt)
      });
    }
    
    // Reset to pending for reprocessing
    payout.status = 'pending';
    payout.auditTrail.push({
      action: 'retry',
      performedBy: adminId,
      details: `Retry attempt ${payout.attempts + 1}`
    });
    
    await payout.save();
    
    res.json({
      success: true,
      message: 'Payout queued for retry',
      payout
    });
  } catch (error) {
    console.error('Error retrying payout:', error);
    res.status(500).json({ error: 'Failed to retry payout' });
  }
});

// Get payout history
router.get('/history', async (req, res) => {
  try {
    const { wholesalerId, status, startDate, endDate, limit = 50, offset = 0 } = req.query;
    
    let query = {};
    
    if (wholesalerId) query.wholesaler = wholesalerId;
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const payouts = await Payout.find(query)
      .populate('wholesaler', 'name email phoneNumber')
      .sort('-createdAt')
      .limit(Number(limit))
      .skip(Number(offset));
    
    const total = await Payout.countDocuments(query);
    
    res.json({
      success: true,
      total,
      payouts
    });
  } catch (error) {
    console.error('Error fetching payout history:', error);
    res.status(500).json({ error: 'Failed to fetch payout history' });
  }
});

// Get payout details
router.get('/:payoutId', async (req, res) => {
  try {
    const { payoutId } = req.params;
    
    const payout = await Payout.findOne({ payoutId })
      .populate('wholesaler', 'name email phoneNumber businessLocation')
      .populate('orders')
      .populate('auditTrail.performedBy', 'name');
    
    if (!payout) {
      return res.status(404).json({ error: 'Payout not found' });
    }
    
    res.json({
      success: true,
      payout
    });
  } catch (error) {
    console.error('Error fetching payout details:', error);
    res.status(500).json({ error: 'Failed to fetch payout details' });
  }
});

module.exports = router;
