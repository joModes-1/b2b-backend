const express = require('express');
const router = express.Router();
const { getCategories } = require('../controllers/categoryController');

// Public route - list all categories
router.get('/', getCategories);

module.exports = router;
