const Listing = require('../models/Listing');
const fs = require('fs').promises;
const path = require('path');

// Create a new listing
exports.createListing = async (req, res) => {
  try {
    const { title, description, price, category } = req.body;
    const images = req.files ? req.files.map(file => file.path) : [];
    
    const listing = new Listing({
      title,
      description,
      price,
      category,
      images,
      seller: req.user._id
    });

    await listing.save();
    res.status(201).json(listing);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all listings
exports.getListings = async (req, res) => {
  try {
    const { category, search, minPrice, maxPrice, sort } = req.query;
    let query = {};

    // Apply filters
    if (category) {
      query.category = category;
    }
    if (search) {
      query.$text = { $search: search };
    }
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Build sort object
    let sortObj = {};
    if (sort) {
      const [field, order] = sort.split(':');
      sortObj[field] = order === 'desc' ? -1 : 1;
    } else {
      sortObj = { createdAt: -1 }; // Default sort by newest
    }

    const listings = await Listing.find(query)
      .sort(sortObj)
      .populate('seller', 'name email');
    
    res.json(listings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get seller's listings
exports.getSellersListings = async (req, res) => {
  try {
    const listings = await Listing.find({ seller: req.user._id });
    res.json(listings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get single listing
exports.getListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('seller', 'name email');
    
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update listing
exports.updateListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // Check if user is the seller
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const updates = { ...req.body };
    if (req.files && req.files.length > 0) {
      // Delete old images
      for (const imagePath of listing.images) {
        try {
          await fs.unlink(imagePath);
        } catch (error) {
          console.error('Error deleting image:', error);
        }
      }
      updates.images = req.files.map(file => file.path);
    }

    const updatedListing = await Listing.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    );

    res.json(updatedListing);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete listing
exports.deleteListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // Check if user is the seller
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Delete associated images
    for (const imagePath of listing.images) {
      try {
        await fs.unlink(imagePath);
      } catch (error) {
        console.error('Error deleting image:', error);
      }
    }

    await listing.remove();
    res.json({ message: 'Listing deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 