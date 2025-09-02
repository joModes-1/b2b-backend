const express = require('express');
const router = express.Router();
const { getCategories, createCategory, updateCategory, deleteCategory } = require('../controllers/categoryController');
const { isAdmin } = require('../middleware/adminAuth');

// Public route - list all categories with subcategories
router.get('/', getCategories);

// Admin routes
router.post('/', isAdmin, createCategory);
router.put('/:id', isAdmin, updateCategory);
router.delete('/:id', isAdmin, deleteCategory);

module.exports = router;
