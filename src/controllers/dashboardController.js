const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');

// Get seller dashboard statistics
exports.getSellerStats = async (req, res) => {
  try {
    const sellerId = req.user._id;

    // Get order statistics
    const orderStats = await Order.aggregate([
      {
        $match: {
          seller: sellerId
        }
      },
      {
        $facet: {
          // Total orders count by status
          ordersByStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                revenue: { $sum: '$totalAmount' }
              }
            }
          ],
          // Revenue by month (last 6 months)
          revenueByMonth: [
            {
              $match: {
                createdAt: {
                  $gte: new Date(new Date().setMonth(new Date().getMonth() - 6))
                },
                status: { $nin: ['cancelled', 'refunded'] }
              }
            },
            {
              $group: {
                _id: {
                  month: { $month: '$createdAt' },
                  year: { $year: '$createdAt' }
                },
                revenue: { $sum: '$totalAmount' },
                orders: { $sum: 1 }
              }
            },
            {
              $sort: {
                '_id.year': 1,
                '_id.month': 1
              }
            }
          ],
          // Recent orders
          recentOrders: [
            { $sort: { createdAt: -1 } },
            { $limit: 5 },
            {
              $lookup: {
                from: 'users',
                localField: 'buyer',
                foreignField: '_id',
                as: 'buyer'
              }
            },
            {
              $unwind: {
                path: '$buyer',
                preserveNullAndEmptyArrays: true // Keep orders even if buyer is deleted
              }
            }
          ],
          // Total metrics
          totals: [
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalRevenue: {
                  $sum: {
                    $cond: [
                      { $not: { $in: ['$status', ['cancelled', 'refunded']] } },
                      '$totalAmount',
                      0
                    ]
                  }
                },
                averageOrderValue: { $avg: '$totalAmount' }
              }
            }
          ]
        }
      }
    ]);

    // Get shipping method distribution
    const shippingMethodStats = await Order.aggregate([
      {
        $match: {
          seller: sellerId,
          status: { $nin: ['cancelled', 'refunded'] }
        }
      },
      {
        $group: {
          _id: '$shippingMethod',
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      }
    ]);

    // Format the response
    const formattedStats = {
      ordersByStatus: orderStats[0].ordersByStatus.reduce((acc, curr) => {
        acc[curr._id] = {
          count: curr.count,
          revenue: curr.revenue
        };
        return acc;
      }, {}),
      revenueByMonth: orderStats[0].revenueByMonth,
      recentOrders: orderStats[0].recentOrders,
      totals: orderStats[0].totals[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        averageOrderValue: 0
      },
      shippingMethods: shippingMethodStats
    };

    res.json(formattedStats);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Error fetching dashboard statistics' });
  }
};

exports.getAdminStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalSellers = await User.countDocuments({ role: 'seller' });
    const totalProducts = await Product.countDocuments();

    res.json({
      users: totalUsers,
      sellers: totalSellers,
      products: totalProducts,
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ message: 'Failed to load admin statistics' });
  }
}; 