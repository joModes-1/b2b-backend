const Product = require('../models/Product');

// @desc    Get list of distinct product categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
  try {
    // Get distinct categories from products collection
    const categories = await Product.distinct('category');

    // Map to objects with id & name to align with frontend expectations
    const formatted = categories.map((name, idx) => ({ id: idx.toString(), name }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ message: 'Failed to fetch categories', error: err.message });
  }
};
