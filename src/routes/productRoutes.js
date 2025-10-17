const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const { isAdmin } = require('../middleware/adminAuth');
const upload = require('../middleware/upload');
const productController = require('../controllers/productController');

// Debug route registration
console.log('Setting up product routes...');

// Get trending products (public)
router.get('/trending', productController.getTrendingProducts);

// Get featured products (public)
router.get('/featured', productController.getFeaturedProducts);

// Get hot deals products (public)
router.get('/hot-deals', productController.getHotDeals);

// Get product counts grouped by category (public)
router.get('/categories/counts', productController.getCategoryCounts);

// Get all products (public)
router.get('/', productController.getAllProducts);

// Preset images routes (put BEFORE parameterized ':id' route)
// Get preset images by category (public)
router.get('/preset-images', productController.getPresetImages);
// Admin listing of preset images
router.get('/preset-images/admin', isAdmin, productController.getPresetImagesAdmin);

// Similar products (must be before ':id')
router.get('/:id/similar', productController.getSimilarProducts);

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

// Admin routes for preset images
router.post('/preset-images', isAdmin, productController.createPresetImage);
router.post('/preset-images/upload', isAdmin, upload.single('image'), productController.createPresetImageWithFile);
router.put('/preset-images/:id', isAdmin, productController.updatePresetImage);
router.put('/preset-images/:id/upload', isAdmin, upload.single('image'), productController.updatePresetImageWithFile);
router.delete('/preset-images/:id', isAdmin, productController.deletePresetImage);

// Debug route registration
console.log('Product routes set up successfully');

module.exports = router; 