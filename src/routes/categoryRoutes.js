const express = require('express');
const router = express.Router();
const { getCategories, getCategoriesWithCounts, createCategory, updateCategory, deleteCategory } = require('../controllers/categoryController');
const { isAdmin } = require('../middleware/adminAuth');

// Public route - list all categories with subcategories
router.get('/', getCategories);

// Public route - list all categories with product counts (including 0 count categories)
router.get('/with-counts', getCategoriesWithCounts);

// Admin routes
router.post('/', isAdmin, createCategory);
router.put('/:id', isAdmin, updateCategory);
router.delete('/:id', isAdmin, deleteCategory);

module.exports = router;
