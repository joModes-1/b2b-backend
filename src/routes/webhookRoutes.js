const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Order = require('../../models/Order');
const DeliveryPerson = require('../../models/DeliveryPerson');
const User = require('../models/User');

// Fee profile collection for mobile money providers
const feeProfiles = {
  mtn: {
    ranges: [
      { min: 1, max: 5000, fee: 150 },
      { min: 5001, max: 30000, fee: 300 },
      { min: 30001, max: 125000, fee: 500 },
      { min: 125001, max: 250000, fee: 1000 },
      { min: 250001, max: 500000, fee: 2000 },
      { min: 500001, max: 1000000, fee: 5000 }
    ]
  },
  airtel: {
    ranges: [
      { min: 1, max: 4999, fee: 110 },
      { min: 5000, max: 29999, fee: 330 },
      { min: 30000, max: 124999, fee: 550 },
      { min: 125000, max: 249999, fee: 1100 },
      { min: 250000, max: 499999, fee: 2200 },
      { min: 500000, max: 1000000, fee: 5500 }
    ]
  }
};

// Calculate actual mobile money fee
const calculateMobileFee = (amount, provider) => {
  const profile = feeProfiles[provider];
  if (!profile) return 0;
  
  const range = profile.ranges.find(r => amount >= r.min && amount <= r.max);
  return range ? range.fee : 0;
};

// Verify webhook signature (implement based on provider's security method)
const verifyWebhookSignature = (payload, signature, secret) => {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return signature === expectedSignature;
};

// Match payment to order
const matchPaymentToOrder = async (paymentData) => {
  const { amount, reference, transactionId, sender, provider } = paymentData;
  
  // Try exact match by reference
  if (reference) {
    const order = await Order.findOne({
      $or: [
        { orderId: reference },
        { 'paymentInfo.reference': reference }
      ]
    });
    if (order) return { order, matchType: 'exact_reference' };
  }
  
  // Try exact amount match with recent orders
  const recentOrders = await Order.find({
    totalAmount: amount,
    'paymentInfo.type': 'mobile_money',
    'paymentInfo.status': 'pending',
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
  }).limit(5);
  
  if (recentOrders.length === 1) {
    return { order: recentOrders[0], matchType: 'exact_amount' };
  }
  
  // Try match by driver's assigned orders
  if (sender) {
    const driver = await DeliveryPerson.findOne({
      phoneNumber: sender
    });
    
    if (driver) {
      const driverOrder = await Order.findOne({
        assignedDriver: driver._id,
        totalAmount: amount,
        'paymentInfo.status': 'pending'
      });
      
      if (driverOrder) {
        return { order: driverOrder, matchType: 'driver_match' };
      }
    }
  }
  
  // Partial match with tolerance
  const tolerance = 100; // 100 UGX tolerance for fees
  const partialMatches = await Order.find({
    totalAmount: { $gte: amount - tolerance, $lte: amount + tolerance },
    'paymentInfo.type': 'mobile_money',
    'paymentInfo.status': 'pending',
    createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  });
  
  if (partialMatches.length === 1) {
    return { order: partialMatches[0], matchType: 'partial_amount', isPartial: true };
  }
  
  return { order: null, matchType: 'no_match' };
};

// MTN Mobile Money webhook
router.post('/mtn-momo', async (req, res) => {
  try {
    const { signature } = req.headers;
    const payload = req.body;
    
    // Verify webhook authenticity (implement actual verification)
    // const isValid = verifyWebhookSignature(payload, signature, process.env.MTN_WEBHOOK_SECRET);
    // if (!isValid) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }
    
    const paymentData = {
      amount: payload.amount,
      reference: payload.externalId || payload.financialTransactionId,
      transactionId: payload.financialTransactionId,
      sender: payload.payerMobileNumber,
      recipient: payload.payeeMobileNumber,
      provider: 'mtn',
      timestamp: payload.timestamp || new Date().toISOString(),
      status: payload.status
    };
    
    // Only process successful payments
    if (payload.status !== 'SUCCESSFUL') {
      return res.json({ message: 'Payment not successful, skipping processing' });
    }
    
    // Match payment to order
    const { order, matchType, isPartial } = await matchPaymentToOrder(paymentData);
    
    if (order) {
      // Calculate actual fees
      const actualFee = calculateMobileFee(paymentData.amount, 'mtn');
      
      // Update order
      order.paymentInfo.status = isPartial ? 'partial' : 'completed';
      order.paymentInfo.transactionId = paymentData.transactionId;
      order.paymentInfo.provider = 'mtn';
      order.isPaid = !isPartial;
      order.paidAt = new Date();
      
      if (isPartial) {
        order.notes = `Partial payment received. Amount: ${paymentData.amount}, Expected: ${order.totalAmount}`;
      }
      
      // Update commission status if fully paid
      if (!isPartial) {
        order.commission.status = 'collected';
        order.estimatedMobileFees = actualFee;
        order.netAmount = order.totalAmount - order.commission.amount - actualFee;
      }
      
      await order.save();
      
      // TODO: Send notification to buyer and seller
      
      res.json({
        success: true,
        matchType,
        orderId: order.orderId,
        isPartial
      });
    } else {
      // Store unmatched payment for manual review
      // TODO: Create UnmatchedPayment model and store
      
      res.json({
        success: false,
        message: 'Payment not matched to any order',
        paymentData
      });
    }
  } catch (error) {
    console.error('MTN webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Airtel Money webhook
router.post('/airtel-money', async (req, res) => {
  try {
    const payload = req.body;
    
    const paymentData = {
      amount: payload.transaction.amount,
      reference: payload.transaction.reference || payload.transaction.id,
      transactionId: payload.transaction.id,
      sender: payload.transaction.source.phone,
      recipient: payload.transaction.destination.phone,
      provider: 'airtel',
      timestamp: payload.transaction.timestamp,
      status: payload.transaction.status
    };
    
    // Only process successful payments
    if (payload.transaction.status !== 'SUCCESS') {
      return res.json({ message: 'Payment not successful, skipping processing' });
    }
    
    // Match payment to order
    const { order, matchType, isPartial } = await matchPaymentToOrder(paymentData);
    
    if (order) {
      // Calculate actual fees
      const actualFee = calculateMobileFee(paymentData.amount, 'airtel');
      
      // Update order
      order.paymentInfo.status = isPartial ? 'partial' : 'completed';
      order.paymentInfo.transactionId = paymentData.transactionId;
      order.paymentInfo.provider = 'airtel';
      order.isPaid = !isPartial;
      order.paidAt = new Date();
      
      if (isPartial) {
        order.notes = `Partial payment received. Amount: ${paymentData.amount}, Expected: ${order.totalAmount}`;
      }
      
      // Update commission status if fully paid
      if (!isPartial) {
        order.commission.status = 'collected';
        order.estimatedMobileFees = actualFee;
        order.netAmount = order.totalAmount - order.commission.amount - actualFee;
      }
      
      await order.save();
      
      res.json({
        success: true,
        matchType,
        orderId: order.orderId,
        isPartial
      });
    } else {
      res.json({
        success: false,
        message: 'Payment not matched to any order',
        paymentData
      });
    }
  } catch (error) {
    console.error('Airtel webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Manual payment matching endpoint for unmatched payments
router.post('/match-payment', async (req, res) => {
  try {
    const { orderId, transactionId, amount, provider } = req.body;
    
    const order = await Order.findOne({ orderId });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Verify amount is close enough
    const tolerance = 100;
    if (Math.abs(order.totalAmount - amount) > tolerance) {
      return res.status(400).json({ 
        error: 'Amount mismatch too large',
        expected: order.totalAmount,
        received: amount,
        difference: Math.abs(order.totalAmount - amount)
      });
    }
    
    // Update order with payment info
    const actualFee = calculateMobileFee(amount, provider);
    
    order.paymentInfo.status = 'completed';
    order.paymentInfo.transactionId = transactionId;
    order.paymentInfo.provider = provider;
    order.isPaid = true;
    order.paidAt = new Date();
    order.commission.status = 'collected';
    order.estimatedMobileFees = actualFee;
    order.netAmount = order.totalAmount - order.commission.amount - actualFee;
    
    await order.save();
    
    res.json({
      success: true,
      message: 'Payment matched successfully',
      order
    });
  } catch (error) {
    console.error('Manual payment matching error:', error);
    res.status(500).json({ error: 'Failed to match payment' });
  }
});

// Get unmatched payments for review
router.get('/unmatched-payments', async (req, res) => {
  try {
    // TODO: Implement UnmatchedPayment model and query
    res.json({
      message: 'Unmatched payments endpoint - to be implemented',
      payments: []
    });
  } catch (error) {
    console.error('Error fetching unmatched payments:', error);
    res.status(500).json({ error: 'Failed to fetch unmatched payments' });
  }
});

module.exports = router;
