const express = require('express');
const router = express.Router();
const Order = require('../../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');
const fs = require('fs');
const path = require('path');

// Get transaction history for a user
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      role, // buyer or seller
      status,
      startDate,
      endDate,
      paymentStatus,
      limit = 20,
      offset = 0,
      sortBy = '-createdAt'
    } = req.query;
    
    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Build query based on user role
    let query = {};
    if (user.role === 'buyer') {
      query.user = userId;
    } else if (user.role === 'seller') {
      query['items.sellerId'] = userId;
    } else {
      return res.status(403).json({ error: 'Invalid user role for transaction history' });
    }
    
    // Add filters
    if (status) query.status = status;
    if (paymentStatus) query['paymentInfo.status'] = paymentStatus;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    // Fetch orders
    const orders = await Order.find(query)
      .populate('user', 'name email phoneNumber')
      .populate('items.product', 'name category')
      .populate('items.sellerId', 'name businessLocation')
      .populate('assignedDriver', 'name phoneNumber')
      .sort(sortBy)
      .limit(Number(limit))
      .skip(Number(offset));
    
    // Get total count for pagination
    const totalCount = await Order.countDocuments(query);
    
    // Calculate summary statistics
    const stats = await Order.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$totalAmount' },
          totalOrders: { $sum: 1 },
          totalCommission: { $sum: '$commission.amount' },
          avgOrderValue: { $avg: '$totalAmount' }
        }
      }
    ]);
    
    // Format transactions for response
    const transactions = orders.map(order => ({
      transactionId: order.orderId,
      orderId: order._id,
      date: order.createdAt,
      status: order.status,
      paymentStatus: order.paymentInfo.status,
      paymentType: order.paymentInfo.type,
      items: order.items.map(item => ({
        product: item.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity,
        seller: item.sellerId?.name
      })),
      subtotal: order.subtotal,
      transportCost: order.transportCost,
      commission: order.commission,
      totalAmount: order.totalAmount,
      customer: user.role === 'seller' ? {
        name: order.shippingInfo.fullName,
        phone: order.shippingInfo.phone,
        address: order.shippingInfo.address
      } : undefined,
      driver: order.assignedDriver ? {
        name: order.assignedDriver.name,
        phone: order.assignedDriver.phoneNumber
      } : undefined,
      isPaid: order.isPaid,
      paidAt: order.paidAt,
      isDelivered: order.isDelivered,
      deliveredAt: order.deliveredAt
    }));
    
    res.json({
      success: true,
      summary: {
        totalOrders: stats[0]?.totalOrders || 0,
        totalAmount: stats[0]?.totalAmount || 0,
        totalCommission: stats[0]?.totalCommission || 0,
        avgOrderValue: stats[0]?.avgOrderValue || 0
      },
      transactions,
      pagination: {
        total: totalCount,
        limit: Number(limit),
        offset: Number(offset),
        hasMore: Number(offset) + Number(limit) < totalCount
      }
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

// Generate PDF receipt for an order
router.get('/receipt/:orderId/pdf', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findOne({ 
      $or: [{ _id: orderId }, { orderId: orderId }] 
    })
    .populate('user', 'name email phoneNumber')
    .populate('items.product', 'name category')
    .populate('items.sellerId', 'name businessLocation phoneNumber email');
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${order.orderId}.pdf`);
    
    // Pipe PDF to response
    doc.pipe(res);
    
    // Add company header
    doc.fontSize(20).text('UJII B2B Platform', { align: 'center' });
    doc.fontSize(12).text('Tax Invoice / Receipt', { align: 'center' });
    doc.moveDown();
    
    // Add order information
    doc.fontSize(14).text('Order Details', { underline: true });
    doc.fontSize(10);
    doc.text(`Order ID: ${order.orderId}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`);
    doc.text(`Status: ${order.status.toUpperCase()}`);
    doc.text(`Payment Method: ${order.paymentInfo.type.toUpperCase()}`);
    doc.text(`Payment Status: ${order.isPaid ? 'PAID' : 'PENDING'}`);
    if (order.isPaid && order.paidAt) {
      doc.text(`Payment Date: ${new Date(order.paidAt).toLocaleDateString()}`);
    }
    doc.moveDown();
    
    // Add customer information
    doc.fontSize(14).text('Customer Information', { underline: true });
    doc.fontSize(10);
    doc.text(`Name: ${order.shippingInfo.fullName}`);
    doc.text(`Phone: ${order.shippingInfo.phone}`);
    doc.text(`Email: ${order.user.email}`);
    doc.text(`Delivery Address: ${order.shippingInfo.address}`);
    doc.text(`${order.shippingInfo.city}, ${order.shippingInfo.state} ${order.shippingInfo.zipCode}`);
    doc.text(`${order.shippingInfo.country}`);
    doc.moveDown();
    
    // Add items table
    doc.fontSize(14).text('Order Items', { underline: true });
    doc.moveDown(0.5);
    
    // Table headers
    doc.fontSize(10);
    const tableTop = doc.y;
    doc.text('Item', 50, tableTop);
    doc.text('Qty', 250, tableTop);
    doc.text('Price', 300, tableTop);
    doc.text('Total', 400, tableTop);
    doc.text('Seller', 450, tableTop);
    
    // Draw line under headers
    doc.moveTo(50, tableTop + 15)
       .lineTo(550, tableTop + 15)
       .stroke();
    
    // Add items
    let yPosition = tableTop + 25;
    order.items.forEach(item => {
      doc.text(item.name.substring(0, 30), 50, yPosition);
      doc.text(item.quantity.toString(), 250, yPosition);
      doc.text(`UGX ${item.price.toLocaleString()}`, 300, yPosition);
      doc.text(`UGX ${(item.price * item.quantity).toLocaleString()}`, 400, yPosition);
      doc.text(item.sellerId?.name || 'N/A', 450, yPosition);
      yPosition += 20;
    });
    
    // Draw line before totals
    doc.moveTo(50, yPosition)
       .lineTo(550, yPosition)
       .stroke();
    
    // Add totals
    yPosition += 10;
    doc.fontSize(10);
    doc.text(`Subtotal: UGX ${order.subtotal.toLocaleString()}`, 350, yPosition);
    yPosition += 15;
    doc.text(`Transport Cost: UGX ${order.transportCost.toLocaleString()}`, 350, yPosition);
    yPosition += 15;
    if (order.multiLocationFee > 0) {
      doc.text(`Multi-location Fee: UGX ${order.multiLocationFee.toLocaleString()}`, 350, yPosition);
      yPosition += 15;
    }
    doc.text(`Platform Commission (${order.commission.percentage}%): UGX ${order.commission.amount.toLocaleString()}`, 350, yPosition);
    yPosition += 20;
    doc.fontSize(12).text(`Total Amount: UGX ${order.totalAmount.toLocaleString()}`, 350, yPosition, { 
      underline: true 
    });
    
    // Add QR code section if available
    if (order.qrCode?.imageUrl) {
      doc.addPage();
      doc.fontSize(14).text('QR Code for Verification', { align: 'center' });
      // Note: You'll need to convert base64 to buffer or save temporarily
      // doc.image(order.qrCode.imageUrl, { width: 200, align: 'center' });
    }
    
    // Add footer
    doc.fontSize(8);
    doc.text('Thank you for your business!', 50, 700, { align: 'center' });
    doc.text('For support, contact: support@ujii.com | +256 700 000000', 50, 715, { align: 'center' });
    
    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('Error generating PDF receipt:', error);
    res.status(500).json({ error: 'Failed to generate PDF receipt' });
  }
});

// Generate CSV export of transactions
router.get('/export/csv/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, status } = req.query;
    
    // Build query
    let query = {};
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.role === 'buyer') {
      query.user = userId;
    } else if (user.role === 'seller') {
      query['items.sellerId'] = userId;
    }
    
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    // Fetch orders
    const orders = await Order.find(query)
      .populate('user', 'name email')
      .populate('items.product', 'name')
      .populate('items.sellerId', 'name')
      .sort('-createdAt');
    
    // Prepare data for CSV
    const csvData = [];
    orders.forEach(order => {
      order.items.forEach(item => {
        csvData.push({
          'Order ID': order.orderId,
          'Date': new Date(order.createdAt).toLocaleDateString(),
          'Customer': order.user.name,
          'Customer Email': order.user.email,
          'Product': item.name,
          'Quantity': item.quantity,
          'Unit Price': item.price,
          'Subtotal': item.price * item.quantity,
          'Seller': item.sellerId?.name || 'N/A',
          'Transport Cost': order.transportCost,
          'Commission': order.commission.amount,
          'Total Amount': order.totalAmount,
          'Payment Method': order.paymentInfo.type,
          'Payment Status': order.isPaid ? 'Paid' : 'Pending',
          'Order Status': order.status,
          'Delivery Status': order.isDelivered ? 'Delivered' : 'Pending',
          'Delivery Date': order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString() : 'N/A'
        });
      });
    });
    
    // Convert to CSV
    const fields = [
      'Order ID', 'Date', 'Customer', 'Customer Email', 'Product', 
      'Quantity', 'Unit Price', 'Subtotal', 'Seller', 'Transport Cost',
      'Commission', 'Total Amount', 'Payment Method', 'Payment Status',
      'Order Status', 'Delivery Status', 'Delivery Date'
    ];
    
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(csvData);
    
    // Set response headers
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=transactions-${Date.now()}.csv`);
    
    res.send(csv);
  } catch (error) {
    console.error('Error generating CSV export:', error);
    res.status(500).json({ error: 'Failed to generate CSV export' });
  }
});

// Reorder from previous order
router.post('/reorder/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { userId } = req.body;
    
    // Find original order
    const originalOrder = await Order.findOne({ 
      $or: [{ _id: orderId }, { orderId: orderId }],
      user: userId
    }).populate('items.product');
    
    if (!originalOrder) {
      return res.status(404).json({ error: 'Order not found or unauthorized' });
    }
    
    // Check product availability
    const availableItems = [];
    const unavailableItems = [];
    
    for (const item of originalOrder.items) {
      const product = await Product.findById(item.product);
      if (product && product.status === 'active' && product.stock >= item.quantity) {
        availableItems.push({
          product: product._id,
          name: product.name,
          quantity: item.quantity,
          price: product.price, // Use current price
          sellerId: product.seller,
          weight: item.weight
        });
      } else {
        unavailableItems.push({
          name: item.name,
          reason: !product ? 'Product no longer exists' : 
                 product.status !== 'active' ? 'Product is inactive' :
                 'Insufficient stock'
        });
      }
    }
    
    if (availableItems.length === 0) {
      return res.status(400).json({ 
        error: 'No items available for reorder',
        unavailableItems 
      });
    }
    
    // Calculate new totals
    const subtotal = availableItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    // Create new order
    const newOrder = new Order({
      user: userId,
      items: availableItems,
      shippingInfo: originalOrder.shippingInfo,
      paymentInfo: {
        type: originalOrder.paymentInfo.type,
        status: 'pending'
      },
      subtotal,
      transportCost: originalOrder.transportCost, // Will be recalculated
      totalAmount: subtotal + originalOrder.transportCost,
      status: 'pending'
    });
    
    await newOrder.save();
    
    res.json({
      success: true,
      message: 'Reorder created successfully',
      order: {
        orderId: newOrder.orderId,
        _id: newOrder._id,
        itemsCount: availableItems.length,
        totalAmount: newOrder.totalAmount
      },
      unavailableItems: unavailableItems.length > 0 ? unavailableItems : undefined
    });
  } catch (error) {
    console.error('Error creating reorder:', error);
    res.status(500).json({ error: 'Failed to create reorder' });
  }
});

// Get transaction summary/analytics
router.get('/summary/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { period = '30d' } = req.query; // 7d, 30d, 90d, 1y, all
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Calculate date range
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
      case '1y':
        dateFilter = { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
        break;
      case 'all':
      default:
        dateFilter = {};
    }
    
    // Build query
    let matchQuery = {};
    if (user.role === 'buyer') {
      matchQuery.user = mongoose.Types.ObjectId(userId);
    } else if (user.role === 'seller') {
      matchQuery['items.sellerId'] = mongoose.Types.ObjectId(userId);
    }
    
    if (Object.keys(dateFilter).length > 0) {
      matchQuery.createdAt = dateFilter;
    }
    
    // Aggregate transaction data
    const summary = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalCommission: { $sum: '$commission.amount' },
          avgOrderValue: { $avg: '$totalAmount' },
          maxOrderValue: { $max: '$totalAmount' },
          minOrderValue: { $min: '$totalAmount' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] }
          },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          paidOrders: {
            $sum: { $cond: ['$isPaid', 1, 0] }
          },
          unpaidOrders: {
            $sum: { $cond: ['$isPaid', 0, 1] }
          }
        }
      }
    ]);
    
    // Get monthly trend
    const monthlyTrend = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 }
    ]);
    
    // Get top products (for sellers) or top sellers (for buyers)
    let topItems = [];
    if (user.role === 'seller') {
      topItems = await Order.aggregate([
        { $match: matchQuery },
        { $unwind: '$items' },
        { $match: { 'items.sellerId': mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: '$items.product',
            productName: { $first: '$items.name' },
            totalQuantity: { $sum: '$items.quantity' },
            totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: 5 }
      ]);
    } else {
      topItems = await Order.aggregate([
        { $match: matchQuery },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.sellerId',
            totalOrders: { $sum: 1 },
            totalSpent: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'seller'
          }
        },
        { $unwind: '$seller' },
        {
          $project: {
            sellerName: '$seller.name',
            totalOrders: 1,
            totalSpent: 1
          }
        }
      ]);
    }
    
    res.json({
      success: true,
      period,
      summary: summary[0] || {
        totalTransactions: 0,
        totalAmount: 0,
        totalCommission: 0,
        avgOrderValue: 0,
        maxOrderValue: 0,
        minOrderValue: 0,
        completedOrders: 0,
        pendingOrders: 0,
        cancelledOrders: 0,
        paidOrders: 0,
        unpaidOrders: 0
      },
      monthlyTrend,
      topItems,
      userRole: user.role
    });
  } catch (error) {
    console.error('Error fetching transaction summary:', error);
    res.status(500).json({ error: 'Failed to fetch transaction summary' });
  }
});

module.exports = router;
