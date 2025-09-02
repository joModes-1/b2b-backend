const User = require('../models/User');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const { Parser } = require('json2csv');
const PDFDocument = require('pdfkit');

// Internal function to get platform statistics
const getPlatformStatsInternal = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  return {
    users: await User.countDocuments({ role: 'buyer' }),
    sellers: await User.countDocuments({ role: 'seller' }),
    pendingVendors: await User.countDocuments({ role: 'seller', status: 'pending' }),
    products: await Listing.countDocuments(),
    pendingProducts: await Listing.countDocuments({ status: 'pending' }),
    orders: {
      total: await Order.countDocuments(),
      pending: await Order.countDocuments({ status: 'pending' }),
      processing: await Order.countDocuments({ status: 'processing' }),
      delivered: await Order.countDocuments({ status: 'delivered' }),
    },
    revenue: {
      daily: await getRevenueForPeriod(today),
      weekly: await getRevenueForPeriod(startOfWeek),
      monthly: await getRevenueForPeriod(startOfMonth),
      total: await getRevenueForPeriod(),
    },
    topVendors: await getTopPerformingVendors(),
    popularCategories: await getPopularCategories(),
  };
};

// Helper function to calculate revenue for a given period
const getRevenueForPeriod = async (startDate) => {
  const matchStage = {
    status: { $nin: ['cancelled', 'refunded'] },
  };
  if (startDate) {
    matchStage.createdAt = { $gte: startDate };
  }

  const result = await Order.aggregate([
    { $match: matchStage },
    { $group: { _id: null, total: { $sum: '$totalAmount' } } },
  ]);

  return result[0]?.total || 0;
};

// Helper to get top performing sellers
const getTopPerformingVendors = async () => {
  return await Order.aggregate([
    { $match: { status: { $nin: ['cancelled', 'refunded'] } } },
    { $group: { _id: '$seller', totalRevenue: { $sum: '$totalAmount' }, totalOrders: { $sum: 1 } } },
    { $sort: { totalRevenue: -1 } },
    { $limit: 5 },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'sellerDetails' } },
    { $unwind: '$sellerDetails' },
    { $project: { 'sellerDetails.password': 0, 'sellerDetails.firebaseUid': 0 } },
  ]);
};

// Helper to get popular product categories
const getPopularCategories = async () => {
  return await Listing.aggregate([
    { $unwind: '$category' },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);
};

// Main function to get all dashboard data
exports.getDashboardData = async (req, res) => {
  try {
    console.log('Admin dashboard request from user:', req.user?.email);
    
    const [stats, recentActivities] = await Promise.all([
      getPlatformStatsInternal(),
      getActivityLogInternal(req.query.limit || 10),
    ]);

    console.log('Dashboard data fetched successfully');
    res.json({ stats, recentActivities });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard data: ' + error.message });
  }
};

// Get all users with pagination and filters
exports.getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const role = req.query.role;
    const status = req.query.status;
    const search = req.query.search;

    const query = {};
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await User.countDocuments(query);

    res.json({
      users,
      total,
      pages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



// Get pending approvals (sellers and products)
exports.getPendingApprovals = async (req, res) => {
  try {
    const pendingVendors = await User.find({ role: 'seller', status: 'pending' })
      .select('-password')
      .sort({ createdAt: -1 });

    const pendingProducts = await Listing.find({ status: 'pending' })
      .populate('seller', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      sellers: pendingVendors,
      products: pendingProducts
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Approve or reject seller
exports.updateVendorStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.status = status;
    if (reason) user.statusReason = reason;
    await user.save();

    // TODO: Send email notification to seller

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Approve or reject product
exports.updateProductStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const product = await Listing.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    product.status = status;
    if (reason) product.statusReason = reason;
    await product.save();

    // TODO: Send email notification to seller

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete or deactivate user
exports.updateUserStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.isAdmin) {
      return res.status(403).json({ message: 'Cannot modify admin user' });
    }

    user.status = status;
    if (reason) user.statusReason = reason;
    await user.save();

    // TODO: Send email notification

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete or deactivate product
exports.updateListingStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    const product = await Listing.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    product.status = status;
    if (reason) product.statusReason = reason;
    await product.save();

    // TODO: Send email notification to seller

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Internal function to get activity log
const getActivityLogInternal = async (limit = 10) => {
  // Combine recent activities from different collections
  const [newUsers, newOrders, newProducts] = await Promise.all([
    User.find()
      .select('name email role status createdAt')
      .sort({ createdAt: -1 })
      .limit(limit),
    Order.find()
      .populate('buyer', 'name')
      .populate('seller', 'name')
      .sort({ createdAt: -1 })
      .limit(limit),
    Listing.find()
      .populate('seller', 'name')
      .sort({ createdAt: -1 })
      .limit(limit)
  ]);

  // Combine and sort activities
  return [
    ...newUsers.map(user => ({
      type: 'NEW_USER',
      data: user,
      timestamp: user.createdAt
    })),
    ...newOrders.map(order => ({
      type: 'NEW_ORDER',
      data: order,
      timestamp: order.createdAt
    })),
    ...newProducts.map(product => ({
      type: 'NEW_PRODUCT',
      data: product,
      timestamp: product.createdAt
    }))
  ].sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
};

// Export data to CSV
exports.exportToCsv = async (req, res) => {
  try {
    const { type } = req.query;
    let data;
    let fields;

    switch (type) {
      case 'users':
        data = await User.find().select('-password');
        fields = ['_id', 'name', 'email', 'role', 'status', 'createdAt'];
        break;
      case 'orders':
        data = await Order.find()
          .populate('buyer', 'name email')
          .populate('seller', 'name email');
        fields = ['orderNumber', 'buyer.name', 'seller.name', 'totalAmount', 'status', 'createdAt'];
        break;
      case 'products':
        data = await Listing.find().populate('seller', 'name');
        fields = ['title', 'seller.name', 'price', 'status', 'createdAt'];
        break;
      default:
        return res.status(400).json({ message: 'Invalid export type' });
    }

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(data);

    res.header('Content-Type', 'text/csv');
    res.attachment(`${type}-${new Date().toISOString()}.csv`);
    return res.send(csv);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Export data to PDF
exports.exportToPdf = async (req, res) => {
  try {
    const { type } = req.query;
    let data;

    switch (type) {
      case 'users':
        data = await User.find().select('-password');
        break;
      case 'orders':
        data = await Order.find()
          .populate('buyer', 'name email')
          .populate('seller', 'name email');
        break;
      case 'products':
        data = await Listing.find().populate('seller', 'name');
        break;
      default:
        return res.status(400).json({ message: 'Invalid export type' });
    }

    const doc = new PDFDocument();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${type}-${new Date().toISOString()}.pdf`);
    doc.pipe(res);

    // Add content to PDF
    doc.fontSize(16).text(`${type.toUpperCase()} REPORT`, { align: 'center' });
    doc.moveDown();

    data.forEach((item, index) => {
      doc.fontSize(12).text(JSON.stringify(item, null, 2));
      if (index < data.length - 1) doc.moveDown();
    });

    doc.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getListings = async (req, res) => {
  const { page = 1, limit = 10, status, search } = req.query;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;

  try {
    console.log('[ADMIN] getListings called', { page: pageNum, limit: limitNum, status, search });
    const query = {};
    if (status) query.status = status;
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const listings = await Listing.find(query)
      .populate('seller', 'name')
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum)
      .exec();

    const count = await Listing.countDocuments(query);

    const payload = {
      listings,
      pages: Math.ceil(count / limitNum),
      currentPage: pageNum,
    };
    console.log('[ADMIN] getListings success', { count: listings.length, pages: payload.pages, currentPage: payload.currentPage });
    res.json(payload);
  } catch (error) {
    console.error('[ADMIN] getListings error:', error);
    res.status(500).json({ message: 'Failed to fetch listings: ' + error.message });
  }
};

module.exports = {
  getDashboardData: exports.getDashboardData,
  getUsers: exports.getUsers,
  getListings: exports.getListings,
  getPendingApprovals: exports.getPendingApprovals,
  updateVendorStatus: exports.updateVendorStatus,
  updateProductStatus: exports.updateProductStatus,
  updateUserStatus: exports.updateUserStatus,
  updateListingStatus: exports.updateListingStatus,
  exportToCsv: exports.exportToCsv,
  exportToPdf: exports.exportToPdf,
}; 