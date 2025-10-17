const express = require('express');
const router = express.Router();
const RefundRequest = require('../models/RefundRequest');
const Order = require('../../models/Order');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for evidence uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../uploads/refunds');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, `refund-${Date.now()}-${Math.random().toString(36).substring(7)}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|mp4|mov|avi/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Create refund/cancellation request
router.post('/request', upload.array('evidence', 5), async (req, res) => {
  try {
    const { 
      orderId, 
      userId, 
      requestType, 
      reason, 
      reasonDetails, 
      items,
      refundMethod
    } = req.body;
    
    // Verify order exists and belongs to user
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (order.user.toString() !== userId) {
      return res.status(403).json({ error: 'Unauthorized: Order does not belong to user' });
    }
    
    // Check if order is eligible for refund/cancellation
    if (requestType === 'cancellation') {
      if (!['pending', 'processing'].includes(order.status)) {
        return res.status(400).json({ 
          error: 'Order cannot be cancelled in current status',
          currentStatus: order.status
        });
      }
    } else if (requestType === 'refund') {
      if (!order.isPaid) {
        return res.status(400).json({ error: 'Order has not been paid yet' });
      }
      
      // Check refund time limit (e.g., 30 days)
      const daysSinceDelivery = order.deliveredAt ? 
        (Date.now() - order.deliveredAt) / (1000 * 60 * 60 * 24) : 0;
      
      if (daysSinceDelivery > 30) {
        return res.status(400).json({ 
          error: 'Refund period has expired (30 days from delivery)' 
        });
      }
    }
    
    // Check for existing request
    const existingRequest = await RefundRequest.findOne({
      order: orderId,
      status: { $in: ['pending', 'under_review', 'approved'] }
    });
    
    if (existingRequest) {
      return res.status(400).json({ 
        error: 'An active refund/cancellation request already exists for this order',
        requestId: existingRequest.requestId
      });
    }
    
    // Calculate request amount
    let requestAmount = 0;
    const requestItems = [];
    
    if (items && items.length > 0) {
      // Partial refund
      for (const item of items) {
        const orderItem = order.items.find(i => 
          i.product.toString() === item.productId
        );
        
        if (!orderItem) {
          return res.status(400).json({ 
            error: `Product ${item.productId} not found in order` 
          });
        }
        
        if (item.quantity > orderItem.quantity) {
          return res.status(400).json({ 
            error: `Invalid quantity for product ${item.productId}` 
          });
        }
        
        const itemAmount = orderItem.price * item.quantity;
        requestAmount += itemAmount;
        
        requestItems.push({
          product: item.productId,
          quantity: item.quantity,
          amount: itemAmount
        });
      }
    } else {
      // Full refund
      requestAmount = order.totalAmount;
      order.items.forEach(item => {
        requestItems.push({
          product: item.product,
          quantity: item.quantity,
          amount: item.price * item.quantity
        });
      });
    }
    
    // Process uploaded evidence
    const evidence = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        evidence.push({
          type: file.mimetype.startsWith('image/') ? 'photo' : 
                file.mimetype.startsWith('video/') ? 'video' : 'document',
          url: `/uploads/refunds/${file.filename}`,
          description: `Evidence file: ${file.originalname}`
        });
      });
    }
    
    // Create refund request
    const refundRequest = new RefundRequest({
      order: orderId,
      requestedBy: userId,
      requestType,
      reason,
      reasonDetails,
      items: requestItems,
      requestAmount,
      refundMethod: refundMethod || 'original_payment',
      evidence
    });
    
    await refundRequest.save();
    
    // Update order status if cancellation
    if (requestType === 'cancellation') {
      order.status = 'cancellation_pending';
      await order.save();
    }
    
    res.json({
      success: true,
      message: `${requestType} request submitted successfully`,
      request: {
        requestId: refundRequest.requestId,
        status: refundRequest.status,
        amount: refundRequest.requestAmount,
        estimatedProcessingDays: refundRequest.estimatedProcessingDays
      }
    });
  } catch (error) {
    console.error('Error creating refund request:', error);
    res.status(500).json({ error: 'Failed to create refund request' });
  }
});

// Get refund requests for user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, limit = 20, offset = 0 } = req.query;
    
    let query = { requestedBy: userId };
    if (status) query.status = status;
    
    const requests = await RefundRequest.find(query)
      .populate('order', 'orderId totalAmount status')
      .sort('-createdAt')
      .limit(Number(limit))
      .skip(Number(offset));
    
    const total = await RefundRequest.countDocuments(query);
    
    res.json({
      success: true,
      requests,
      total,
      hasMore: Number(offset) + Number(limit) < total
    });
  } catch (error) {
    console.error('Error fetching user refund requests:', error);
    res.status(500).json({ error: 'Failed to fetch refund requests' });
  }
});

// Get refund request details
router.get('/request/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    
    const request = await RefundRequest.findOne({ 
      $or: [{ _id: requestId }, { requestId }] 
    })
    .populate('order')
    .populate('requestedBy', 'name email phoneNumber')
    .populate('approvedBy', 'name')
    .populate('processedBy', 'name')
    .populate('timeline.performedBy', 'name');
    
    if (!request) {
      return res.status(404).json({ error: 'Refund request not found' });
    }
    
    res.json({
      success: true,
      request
    });
  } catch (error) {
    console.error('Error fetching refund request:', error);
    res.status(500).json({ error: 'Failed to fetch refund request' });
  }
});

// Admin: Get all refund requests
router.get('/admin/all', async (req, res) => {
  try {
    const { 
      adminId, 
      status, 
      priority,
      requestType,
      startDate,
      endDate,
      limit = 20, 
      offset = 0,
      sortBy = '-createdAt'
    } = req.query;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Build query
    let query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (requestType) query.requestType = requestType;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const requests = await RefundRequest.find(query)
      .populate('order', 'orderId totalAmount')
      .populate('requestedBy', 'name email')
      .sort(sortBy)
      .limit(Number(limit))
      .skip(Number(offset));
    
    const total = await RefundRequest.countDocuments(query);
    
    // Get statistics
    const stats = await RefundRequest.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$requestAmount' }
        }
      }
    ]);
    
    res.json({
      success: true,
      requests,
      total,
      stats,
      hasMore: Number(offset) + Number(limit) < total
    });
  } catch (error) {
    console.error('Error fetching admin refund requests:', error);
    res.status(500).json({ error: 'Failed to fetch refund requests' });
  }
});

// Admin/Seller: Review and approve/reject request
router.put('/review/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { 
      reviewerId, 
      action, // approve, reject, partial_approve
      approvalNotes,
      approvedAmount,
      approvedItems
    } = req.body;
    
    // Verify reviewer authority
    const reviewer = await User.findById(reviewerId);
    if (!reviewer || !['admin', 'seller'].includes(reviewer.role)) {
      return res.status(403).json({ error: 'Unauthorized to review requests' });
    }
    
    const request = await RefundRequest.findOne({ 
      $or: [{ _id: requestId }, { requestId }] 
    }).populate('order');
    
    if (!request) {
      return res.status(404).json({ error: 'Refund request not found' });
    }
    
    if (!['pending', 'under_review'].includes(request.status)) {
      return res.status(400).json({ 
        error: 'Request cannot be reviewed in current status',
        currentStatus: request.status
      });
    }
    
    // Update request based on action
    request.status = action === 'approve' ? 'approved' : 
                    action === 'partial_approve' ? 'partial_approved' : 'rejected';
    request.approvedBy = reviewerId;
    request.approvalNotes = approvalNotes;
    request.approvedAt = new Date();
    
    if (action === 'partial_approve') {
      request.approvedAmount = approvedAmount || 0;
      
      // Update approved items
      if (approvedItems) {
        approvedItems.forEach(item => {
          const requestItem = request.items.find(i => 
            i.product.toString() === item.productId
          );
          if (requestItem) {
            requestItem.approved = item.approved;
          }
        });
      }
    } else if (action === 'approve') {
      request.approvedAmount = request.requestAmount;
      request.items.forEach(item => {
        item.approved = true;
      });
    }
    
    // Add timeline entry
    request.addTimelineEntry(
      `Request ${action}d`,
      reviewerId,
      approvalNotes
    );
    
    await request.save();
    
    // Update order status
    const order = request.order;
    if (request.requestType === 'cancellation' && action === 'approve') {
      order.status = 'cancelled';
      await order.save();
    }
    
    res.json({
      success: true,
      message: `Request ${action}d successfully`,
      request: {
        requestId: request.requestId,
        status: request.status,
        approvedAmount: request.approvedAmount
      }
    });
  } catch (error) {
    console.error('Error reviewing refund request:', error);
    res.status(500).json({ error: 'Failed to review request' });
  }
});

// Process approved refund
router.post('/process/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { 
      processorId,
      transactionId,
      reference,
      provider,
      accountNumber
    } = req.body;
    
    // Verify processor is admin
    const processor = await User.findById(processorId);
    if (!processor || processor.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const request = await RefundRequest.findOne({ 
      $or: [{ _id: requestId }, { requestId }] 
    }).populate('order');
    
    if (!request) {
      return res.status(404).json({ error: 'Refund request not found' });
    }
    
    if (!['approved', 'partial_approved'].includes(request.status)) {
      return res.status(400).json({ 
        error: 'Request must be approved before processing',
        currentStatus: request.status
      });
    }
    
    // Process refund (in production, integrate with payment gateway)
    request.status = 'completed';
    request.processedBy = processorId;
    request.processedAt = new Date();
    request.refundDetails = {
      transactionId,
      reference,
      provider,
      accountNumber,
      completedAt: new Date()
    };
    
    // Calculate processing days
    request.calculateProcessingDays();
    
    // Add timeline entry
    request.addTimelineEntry(
      'Refund processed',
      processorId,
      `Refund of ${request.approvedAmount} completed via ${provider}`
    );
    
    await request.save();
    
    // Update order if full refund
    if (request.requestType === 'refund' && request.approvedAmount === request.order.totalAmount) {
      request.order.status = 'refunded';
      await request.order.save();
    }
    
    res.json({
      success: true,
      message: 'Refund processed successfully',
      request: {
        requestId: request.requestId,
        status: request.status,
        refundAmount: request.approvedAmount,
        transactionId
      }
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

// Cancel refund request
router.put('/cancel/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { userId, reason } = req.body;
    
    const request = await RefundRequest.findOne({ 
      $or: [{ _id: requestId }, { requestId }],
      requestedBy: userId
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Refund request not found or unauthorized' });
    }
    
    if (!['pending', 'under_review'].includes(request.status)) {
      return res.status(400).json({ 
        error: 'Request cannot be cancelled in current status',
        currentStatus: request.status
      });
    }
    
    request.status = 'cancelled';
    request.addTimelineEntry(
      'Request cancelled by user',
      userId,
      reason
    );
    
    await request.save();
    
    // Revert order status if it was cancellation pending
    if (request.requestType === 'cancellation') {
      const order = await Order.findById(request.order);
      if (order && order.status === 'cancellation_pending') {
        order.status = 'pending';
        await order.save();
      }
    }
    
    res.json({
      success: true,
      message: 'Request cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling refund request:', error);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

// Escalate request
router.put('/escalate/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { userId, escalationReason } = req.body;
    
    const request = await RefundRequest.findOne({ 
      $or: [{ _id: requestId }, { requestId }] 
    });
    
    if (!request) {
      return res.status(404).json({ error: 'Refund request not found' });
    }
    
    request.escalated = true;
    request.escalationReason = escalationReason;
    request.priority = 'urgent';
    
    request.addTimelineEntry(
      'Request escalated',
      userId,
      escalationReason
    );
    
    await request.save();
    
    // TODO: Send notification to admin team
    
    res.json({
      success: true,
      message: 'Request escalated successfully'
    });
  } catch (error) {
    console.error('Error escalating request:', error);
    res.status(500).json({ error: 'Failed to escalate request' });
  }
});

// Submit satisfaction feedback
router.post('/feedback/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { userId, rating, feedback } = req.body;
    
    const request = await RefundRequest.findOne({ 
      $or: [{ _id: requestId }, { requestId }],
      requestedBy: userId,
      status: 'completed'
    });
    
    if (!request) {
      return res.status(404).json({ 
        error: 'Completed refund request not found or unauthorized' 
      });
    }
    
    request.customerSatisfaction = {
      rating,
      feedback,
      submittedAt: new Date()
    };
    
    await request.save();
    
    res.json({
      success: true,
      message: 'Feedback submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Get refund statistics
router.get('/stats', async (req, res) => {
  try {
    const { adminId, period = '30d' } = req.query;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Calculate date filter
    let dateFilter = {};
    const now = new Date();
    switch (period) {
      case '7d':
        dateFilter = { $gte: new Date(now.setDate(now.getDate() - 7)) };
        break;
      case '30d':
        dateFilter = { $gte: new Date(now.setDate(now.getDate() - 30)) };
        break;
      case '90d':
        dateFilter = { $gte: new Date(now.setDate(now.getDate() - 90)) };
        break;
    }
    
    const stats = await RefundRequest.aggregate([
      { $match: { createdAt: dateFilter } },
      {
        $facet: {
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalAmount: { $sum: '$requestAmount' },
                approvedAmount: { $sum: '$approvedAmount' }
              }
            }
          ],
          byReason: [
            {
              $group: {
                _id: '$reason',
                count: { $sum: 1 },
                totalAmount: { $sum: '$requestAmount' }
              }
            },
            { $sort: { count: -1 } },
            { $limit: 5 }
          ],
          byType: [
            {
              $group: {
                _id: '$requestType',
                count: { $sum: 1 },
                totalAmount: { $sum: '$requestAmount' }
              }
            }
          ],
          processingTime: [
            {
              $match: { 
                status: 'completed',
                actualProcessingDays: { $exists: true }
              }
            },
            {
              $group: {
                _id: null,
                avgDays: { $avg: '$actualProcessingDays' },
                minDays: { $min: '$actualProcessingDays' },
                maxDays: { $max: '$actualProcessingDays' }
              }
            }
          ],
          satisfaction: [
            {
              $match: {
                'customerSatisfaction.rating': { $exists: true }
              }
            },
            {
              $group: {
                _id: null,
                avgRating: { $avg: '$customerSatisfaction.rating' },
                totalFeedback: { $sum: 1 }
              }
            }
          ]
        }
      }
    ]);
    
    res.json({
      success: true,
      period,
      stats: stats[0]
    });
  } catch (error) {
    console.error('Error fetching refund statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;
