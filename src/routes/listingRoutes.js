const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  createListing,
  getListings,
  getListing,
  updateListing,
  deleteListing,
  getSellersListings
} = require('../controllers/listingController');

// Create a new listing
router.post('/', verifyToken, upload.array('images', 5), createListing);

// Get all listings
router.get('/', getListings);

// Get vendor's listings
router.get('/seller', verifyToken, getSellersListings);

// Get single listing
router.get('/:id', getListing);

// Update listing
router.put('/:id', verifyToken, upload.array('images', 5), updateListing);

// Delete listing
router.delete('/:id', verifyToken, deleteListing);

module.exports = router; 