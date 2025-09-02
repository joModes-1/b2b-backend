const Product = require('../models/Product');
const Category = require('../models/Category');
const { isAdmin } = require('../middleware/adminAuth');

// Simple slugify helper to generate string IDs
const slugify = (str) =>
  String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

// Normalize subcategories into [{ _id, name }]
const normalizeSubcategories = (parentId, subs) => {
  const arr = Array.isArray(subs)
    ? subs
    : (typeof subs === 'string' && subs.trim() !== '' ? [subs] : []);
  return arr
    .filter((s) => s !== null && s !== undefined && String(s).trim() !== '')
    .map((s) => {
      if (typeof s === 'string') {
        const name = s.trim();
        return { _id: `${parentId}-${slugify(name)}`, name };
      }
      const name = (s.name || '').trim();
      const id = s._id || `${parentId}-${slugify(name)}`;
      return { _id: String(id), name };
    });
};

// @desc    Get list of distinct product categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
  try {
    // Get all categories from Category collection
    const categories = await Category.find({});
    
    // Format to match frontend expectations
    const formatted = categories.map(category => ({
      _id: category._id,
      name: category.name,
      subcategories: category.subcategories
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ message: 'Failed to fetch categories', error: err.message });
  }
};

// @desc    Create a new category with subcategories
// @route   POST /api/categories
// @access  Admin
exports.createCategory = async (req, res) => {
  try {
    const { _id, name, subcategories } = req.body;
    console.log('[CATEGORY] createCategory payload:', req.body);

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    // Generate ID from name if not provided
    let id = _id ? String(_id) : slugify(name);
    if (!id) id = `cat-${Date.now()}`;

    // Ensure uniqueness if generated ID already exists
    const existingWithId = await Category.findById(id);
    if (existingWithId) {
      id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const normalizedSubs = normalizeSubcategories(id, subcategories);

    const category = new Category({ _id: id, name: String(name).trim(), subcategories: normalizedSubs });
    await category.save();

    res.status(201).json(category);
  } catch (err) {
    console.error('Error creating category:', err);
    res.status(500).json({ message: 'Failed to create category', error: err.message });
  }
};

// @desc    Update a category
// @route   PUT /api/categories/:id
// @access  Admin
exports.updateCategory = async (req, res) => {
  try {
    const { name, subcategories } = req.body;

    const categoryDoc = await Category.findById(req.params.id);
    if (!categoryDoc) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const updates = {};
    if (typeof name === 'string' && name.trim()) {
      updates.name = name.trim();
    }

    if (Array.isArray(subcategories)) {
      updates.subcategories = normalizeSubcategories(categoryDoc._id, subcategories);
    }

    const category = await Category.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );
    
    res.json(category);
  } catch (err) {
    console.error('Error updating category:', err);
    res.status(500).json({ message: 'Failed to update category', error: err.message });
  }
};

// @desc    Delete a category
// @route   DELETE /api/categories/:id
// @access  Admin
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findByIdAndDelete(req.params.id);
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    res.json({ message: 'Category deleted successfully' });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ message: 'Failed to delete category', error: err.message });
  }
};
