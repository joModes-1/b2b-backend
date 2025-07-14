const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const productController = require('../controllers/productController');

// Debug route registration
console.log('Setting up product routes...');

// Get all products (public)
router.get('/', productController.getAllProducts);

// Get featured products (public)
router.get('/featured', productController.getFeaturedProducts);

// Get product counts grouped by category (public)
router.get('/categories/counts', productController.getCategoryCounts);

// Get single product (public)
router.get('/:id', productController.getProduct);

// Seller routes
// POST /api/products - Create a new product (seller only)
router.post('/', verifyToken, checkRole(['seller']), upload.array('images', 5), productController.createProduct);

// GET /api/products/seller/my-products - Get all products for the logged-in seller
router.get('/seller/my-products', verifyToken, checkRole(['seller']), productController.getSellerProducts);

// PUT /api/products/seller/:id - Update a specific product owned by the seller
router.put('/seller/:id', verifyToken, checkRole(['seller']), upload.array('images', 5), productController.updateProduct);

// DELETE /api/products/seller/:id - Delete a specific product owned by the seller
router.delete('/seller/:id', verifyToken, checkRole(['seller']), productController.deleteProduct);

// Debug route registration
console.log('Product routes set up successfully');

module.exports = router; 