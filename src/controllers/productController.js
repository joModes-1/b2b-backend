const Product = require('../models/Product');
const Category = require('../models/Category');
const PresetImage = require('../models/PresetImage');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');

// Temporary feature flag to restrict products to only seeded categories
// Set ONLY_SEEDED_CATEGORIES=true in env to enable
let allowedCategoryCache = { names: null, expires: 0 };
async function getAllowedCategoryNames() {
  const now = Date.now();
  if (allowedCategoryCache.names && allowedCategoryCache.expires > now) return allowedCategoryCache.names;
  const cats = await Category.find({}, 'name').lean();
  const names = cats.map(c => c.name);
  allowedCategoryCache = { names, expires: now + 5 * 60 * 1000 };
  return names;
}

// Get all products (public)
exports.getAllProducts = async (req, res) => {
  console.log('--- New Request to getAllProducts ---');
  console.log('Request Query:', req.query);

  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const filters = {};

    // Ensure we only show active products by default so counts match visible items
    // To include inactive/draft items (e.g., admin views), pass includeInactive=true
    if (req.query.includeInactive !== 'true') {
      // Include products explicitly active OR with no status (legacy docs)
      filters.$or = [
        { status: 'active' },
        { status: { $exists: false } }
      ];
    }

    // Temporary: restrict to seeded categories if flag enabled
    if (process.env.ONLY_SEEDED_CATEGORIES === 'true') {
      const allowed = await getAllowedCategoryNames();
      if (allowed && allowed.length > 0) {
        filters.category = { ...(filters.category || {}), $in: allowed };
      }
    }

    // 1. Handle Search Term
    // Prefer MongoDB text search for better performance (uses index on name/description)
    // Fallback to regex for partial matching across other fields.
    let useTextSearch = false;
    if (req.query.search) {
      const raw = req.query.search.trim();
      if (raw.length > 0) {
        // Attempt text search first (index exists on name/description)
        filters.$text = { $search: raw };
        useTextSearch = true;
      }
    }

    // 2. Handle Category Filter (can be single or array)
    if (req.query.category) {
      const categories = Array.isArray(req.query.category) ? req.query.category : [req.query.category];
      if (!categories.includes('All')) {
        // Case-insensitive category matching
        filters.$and = [
          ...(filters.$and || []),
          { category: { $in: categories.map(c => new RegExp(`^${c}$`, 'i')) } }
        ];
      }
    }

    // 3. Handle Price Range
    if (req.query.priceRange) {
      const priceRange = req.query.priceRange;
      if (Array.isArray(priceRange) && priceRange.length === 2) {
        filters.price = { $gte: Number(priceRange[0]), $lte: Number(priceRange[1]) };
      }
    }

    // 4. Handle Availability
    if (req.query.availability) {
        const availability = Array.isArray(req.query.availability) ? req.query.availability : [req.query.availability];
        if (availability.length > 0) {
            const availabilityFilters = [];
            if (availability.includes('In Stock')) {
                availabilityFilters.push({ stock: { $gt: 0 } });
            }
            if (availability.includes('Out of Stock')) {
                availabilityFilters.push({ stock: { $lte: 0 } });
            }
            if (availabilityFilters.length > 0) {
                filters.$or = availabilityFilters;
            }
        }
    }

    console.log('--- Constructed MongoDB Filters ---', JSON.stringify(filters, null, 2));

    const totalProducts = await Product.countDocuments(filters);
    const query = Product.find(filters);

    // If using text search, project score and sort by it first
    if (useTextSearch) {
      query.select({ score: { $meta: 'textScore' } });
      query.sort({ score: { $meta: 'textScore' }, createdAt: -1 });
    } else {
      // Legacy sort if not using text search
      query.sort({ createdAt: -1 });
    }

    const products = await query
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('seller', 'name companyName district');

    const sanitizedProducts = products.map(p => {
      const productJson = p.toJSON();
      if (!productJson.seller) {
        productJson.seller = { _id: null, name: 'Unknown Seller', companyName: 'Unknown Company' };
      }
      return productJson;
    });

    console.log(`--- Found ${sanitizedProducts.length} of ${totalProducts} products ---`);

    res.json({
      products: sanitizedProducts,
      page,
      limit,
      totalProducts
    });

  } catch (error) {
    console.error('Error in getAllProducts:', error);
    res.status(500).json({ 
      message: 'Error fetching products', 
      error: error.message, 
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

// Get single product (public)
exports.getProduct = async (req, res) => {
  try {
    // Validate that the ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }
    
    const product = await Product.findById(req.params.id).populate('seller', 'name email');
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    // After populating, if the seller is null, it means the reference is broken.
    // This prevents sending inconsistent data to the frontend.
    if (!product.seller) {
      console.error(`Data integrity issue: Product ${product._id} has a dangling seller reference.`);
      return res.status(500).json({ message: 'Product data is inconsistent: referenced seller not found.' });
    }
    res.json(product);
  } catch (error) {
    console.error('Error in getProduct:', error);
    res.status(500).json({ message: 'Error fetching product', error: error.message });
  }
};

// Get vendor's products
exports.getSellerProducts = async (req, res) => {
  try {
    console.log('Getting products for seller:', req.user._id);
    const products = await Product.find({ seller: req.user._id })
      .populate('seller', 'name'); // Populate seller's name
    console.log('Found products:', products.length);
    res.json(products);
  } catch (error) {
    console.error('Error in getSellerProducts:', error);
    res.status(500).json({ message: 'Error fetching seller products', error: error.message });
  }
};

// Update a product (seller only)
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    // Build update object from allowed fields
    // Allow toggling of flags like isTrending / isHotDeal and discount info
    const allowed = ['name', 'description', 'price', 'category', 'subcategory', 'stock', 'specifications', 'features', 'isTrending', 'isHotDeal', 'originalPrice', 'discountPercentage', 'hotDealType', 'discountAmount', 'buyQuantity', 'getFreeQuantity', 'dealDescription', 'dealStartDate', 'dealEndDate'];
    const update = {};
    for (const key of allowed) {
      if (key in req.body) update[key] = req.body[key];
    }

    // Optional: handle images later; for now ignore uploaded files to unblock server

    const product = await Product.findOneAndUpdate(
      { _id: id, seller: req.user._id },
      { $set: update },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found or not owned by user' });
    }

    res.json(product);
  } catch (error) {
    console.error('Error in updateProduct:', error);
    res.status(500).json({ message: 'Error updating product', error: error.message });
  }
};

// Delete a product (seller only)
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    const deleted = await Product.findOneAndDelete({ _id: id, seller: req.user._id });
    if (!deleted) {
      return res.status(404).json({ message: 'Product not found or not owned by user' });
    }

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error in deleteProduct:', error);
    res.status(500).json({ message: 'Error deleting product', error: error.message });
  }
};

// Get similar products
exports.getSimilarProducts = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const similarProducts = await Product.find({
      category: product.category,
      _id: { $ne: product._id } // Exclude the product itself
    })
    .limit(4) // Limit to 4 similar products
    .populate('seller', 'name companyName');

    res.json(similarProducts);
  } catch (error) {
    console.error('Error in getSimilarProducts:', error);
    res.status(500).json({ message: 'Error fetching similar products', error: error.message });
  }
};

// Get trending products (public)
exports.getTrendingProducts = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    const filters = { $or: [ { status: 'active' }, { status: { $exists: false } } ] };

    // 1) Prefer manually marked trending products
    const flagged = await Product.find({ ...filters, isTrending: true })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    // 2) If not enough, backfill with latest active products not already included
    let products = flagged;
    if (flagged.length < limit) {
      const remaining = limit - flagged.length;
      const flaggedIds = new Set(flagged.map(p => String(p._id)));
      const backfill = await Product.find(filters)
        .sort({ createdAt: -1 })
        .limit(limit * 2) // fetch extra to filter out duplicates safely
        .lean();
      const extras = backfill.filter(p => !flaggedIds.has(String(p._id))).slice(0, remaining);
      products = [...flagged, ...extras];
    }

    res.json({ products });
  } catch (error) {
    console.error('Error in getTrendingProducts:', error);
    res.status(500).json({ message: 'Error fetching trending products', error: error.message });
  }
};

// Get featured products (public)
exports.getFeaturedProducts = async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 12;
    // If products have an isFeatured flag, prefer it; otherwise return latest
    const query = { $or: [{ isFeatured: true }, { isFeatured: { $exists: false } }] };
    const products = await Product.find(query).sort({ isFeatured: -1, createdAt: -1 }).limit(limit).lean();
    res.json(products);
  } catch (error) {
    console.error('Error in getFeaturedProducts:', error);
    res.status(500).json({ message: 'Error fetching featured products', error: error.message });
  }
};

// Get product counts grouped by category (public)
exports.getCategoryCounts = async (req, res) => {
  try {
    // Get all categories from Category collection
    const categories = await Category.find({});
    
    // Create a result object with all categories
    const result = { data: {} };
    
    // Get product counts for each category
    for (const category of categories) {
      const count = await Product.countDocuments({ 
        category: category.name,
        $or: [ { status: 'active' }, { status: { $exists: false } } ]
      });
      result.data[category.name] = count;
    }
    
    // Sort categories by count (descending)
    const sortedEntries = Object.entries(result.data).sort(([,a], [,b]) => b - a);
    result.data = Object.fromEntries(sortedEntries);
    
    res.json(result);
  } catch (error) {
    console.error('Error in getCategoryCounts:', error);
    res.status(500).json({ message: 'Error fetching category counts', error: error.message });
  }
};

// Get preset images by category and subcategory
exports.getPresetImages = async (req, res) => {
  try {
    const { category, subcategory, productName } = req.query;
    
    // Build query filter
    const filter = {};
    if (category) {
      filter.category = category;
    }
    if (subcategory) {
      filter.subcategory = subcategory;
    }
    
    let presetImages = [];
    
    // If productName is provided, perform a more specific search.
    if (productName && productName.trim()) {
      const searchTerm = productName.trim();
      
      // To find images that match all terms, we can use regex.
      // This is more intuitive for users than MongoDB's text search for this use case.
      const keywords = searchTerm.split(' ').filter(k => k.length > 0);
      const regexQueries = keywords.map(k => ({ 
        $or: [
          { name: { $regex: k, $options: 'i' } },
          { tags: { $regex: k, $options: 'i' } }
        ]
      }));

      if (regexQueries.length > 0) {
        filter.$and = regexQueries;
      }
      
      presetImages = await PresetImage.find(filter);

    } else {
      // If no product name provided, return all images for the category/subcategory.
      presetImages = await PresetImage.find(filter);
    }
    
    // Format images for frontend
    const images = presetImages.map(img => ({
      url: img.url,
      name: img.name
    }));

    res.json({ images });
  } catch (error) {
    console.error('Error in getPresetImages:', error);
    res.status(500).json({ message: 'Error fetching preset images', error: error.message });
  }
};

// Get preset images (admin) - return full documents
exports.getPresetImagesAdmin = async (req, res) => {
  try {
    const { category, subcategory, productName } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (subcategory) filter.subcategory = subcategory;
    if (productName && productName.trim()) {
      const keywords = productName.toLowerCase().trim().split(' ');
      filter.$or = [
        { name: { $regex: keywords.join('|'), $options: 'i' } },
        { tags: { $in: keywords } }
      ];
    }

    const docs = await PresetImage.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ images: docs });
  } catch (error) {
    console.error('Error in getPresetImagesAdmin:', error);
    res.status(500).json({ message: 'Error fetching preset images (admin)', error: error.message });
  }
};

// Create product
exports.createProduct = async (req, res) => {
  const files = req.files;
  const imageUrls = []; // To store details of uploaded images for potential cleanup

  try {
    // 0. Validate seller has required business information
    const User = require('../models/User');
    const seller = await User.findOne({ firebaseUid: req.user.firebaseUid });
    
    if (!seller) {
      return res.status(404).json({ message: 'Seller not found' });
    }

    const missingFields = [];
    
    // Check for phone number
    if (!seller.phoneNumber) {
      missingFields.push('phoneNumber');
    }
    
    // Check for business location
    if (!seller.businessLocation || !seller.businessLocation.formattedAddress) {
      missingFields.push('businessLocation');
    }
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        message: 'Please complete your business information before creating products',
        missingFields,
        requiresCompletion: true
      });
    }
    // 1. Parse JSON fields from FormData with error handling
    let specifications = {};
    if (req.body.specifications) {
      try {
        specifications = JSON.parse(req.body.specifications);
      } catch (e) {
        console.error('Error parsing specifications:', e);
        return res.status(400).json({ message: 'Invalid specifications format. Expected a JSON string.' });
      }
    }

    let features = [];
    if (req.body.features) {
      try {
        features = JSON.parse(req.body.features);
      } catch (e) {
        console.error('Error parsing features:', e);
        return res.status(400).json({ message: 'Invalid features format. Expected a JSON string.' });
      }
    }

    // 2. Handle image uploads
    const images = [];
    
    // Process uploaded files
    if (files && files.length > 0) {
      for (const file of files) {
        try {
          const result = await uploadToCloudinary(file.path, { folder: 'products' });
          images.push({
            url: result.secure_url,
            public_id: result.public_id
          });
          imageUrls.push(result);
          await fs.unlink(file.path);
        } catch (uploadError) {
          console.error('Error uploading image to Cloudinary:', uploadError);
          // Clean up any images that were uploaded before the error
          for (const uploadedImage of imageUrls) {
            await deleteFromCloudinary(uploadedImage.public_id).catch(err => 
              console.error('Error cleaning up image:', err)
            );
          }
          return res.status(500).json({ 
            message: 'Error uploading images', 
            error: uploadError.message 
          });
        }
      }
    }
    
    // Process preset images
    let presetImages = [];
    if (req.body.presetImages) {
      try {
        // Handle both single URL and array of URLs
        if (typeof req.body.presetImages === 'string') {
          presetImages = [req.body.presetImages];
        } else if (Array.isArray(req.body.presetImages)) {
          presetImages = req.body.presetImages;
        }
        
        // Add preset images to the images array
        for (const url of presetImages) {
          images.push({
            url: url,
            public_id: '' // Preset images don't have public_id
          });
        }
      } catch (e) {
        console.error('Error processing preset images:', e);
      }
    }

    // 3. Create new product with all data
    const productData = {
      name: req.body.name?.trim(),
      description: req.body.description?.trim(),
      price: Number(req.body.price),
      category: req.body.category?.trim(),
      productType: req.body.productType?.trim(),
      condition: req.body.condition?.trim(),
      stock: Number(req.body.stock) || 0,
      specifications,
      features,
      images,
      seller: req.user._id,
      isTrending: req.body.isTrending || false
    };

    const product = new Product(productData);
    await product.save();

    res.status(201).json(product);
  } catch (error) {
    console.error('Error in createProduct:', error);
    res.status(500).json({ message: 'Error creating product', error: error.message });
  }
};

// Create a preset image (admin only)
exports.createPresetImage = async (req, res) => {
  try {
    const { category, subcategory, url, name, tags } = req.body;
    // Validate required fields for non-file creation
    if (!category || !category.trim()) {
      return res.status(400).json({ message: 'Category is required' });
    }
    if (!subcategory || !subcategory.trim()) {
      return res.status(400).json({ message: 'Subcategory is required' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    if (!url || !url.trim()) {
      return res.status(400).json({ message: 'Image URL is required' });
    }
    
    const presetImage = new PresetImage({
      category,
      subcategory,
      url,
      name,
      tags: tags || [],
      createdBy: req.user?._id
    });
    
    await presetImage.save();
    
    res.status(201).json(presetImage);
  } catch (error) {
    console.error('Error in createPresetImage:', error);
    const status = error?.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ message: 'Error creating preset image', error: error.message });
  }
};

// Create a preset image with file upload (admin only)
exports.createPresetImageWithFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }
    
    // Upload image to Cloudinary
    const result = await uploadToCloudinary(req.file.path, { folder: 'preset-images' });
    
    const { category, subcategory, name, tags } = req.body;
    
    const presetImage = new PresetImage({
      category,
      subcategory,
      url: result.secure_url,
      public_id: result.public_id,
      name,
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      createdBy: req.user?._id
    });
    
    await presetImage.save();
    
    // Clean up temporary file
    await fs.unlink(req.file.path);
    
    res.status(201).json(presetImage);
  } catch (error) {
    console.error('Error in createPresetImageWithFile:', error);
    
    // Clean up temporary file if exists
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(err => console.error('Error deleting temp file:', err));
    }
    
    res.status(500).json({ message: 'Error creating preset image with file', error: error.message });
  }
};

// Update a preset image (admin only)
exports.updatePresetImage = async (req, res) => {
  try {
    const { category, subcategory, url, name, tags } = req.body;
    
    const presetImage = await PresetImage.findByIdAndUpdate(
      req.params.id,
      { category, subcategory, url, name, tags },
      { new: true, runValidators: true }
    );
    
    if (!presetImage) {
      return res.status(404).json({ message: 'Preset image not found' });
    }
    
    res.json(presetImage);
  } catch (error) {
    console.error('Error in updatePresetImage:', error);
    res.status(500).json({ message: 'Error updating preset image', error: error.message });
  }
};

// Update a preset image with file upload (admin only)
exports.updatePresetImageWithFile = async (req, res) => {
  try {
    const { category, subcategory, name, tags } = req.body;
    
    // Find existing preset image
    const presetImage = await PresetImage.findById(req.params.id);
    if (!presetImage) {
      return res.status(404).json({ message: 'Preset image not found' });
    }
    
    // If a new file is uploaded, process it
    if (req.file) {
      // Delete old image from Cloudinary if it exists
      if (presetImage.public_id) {
        await deleteFromCloudinary(presetImage.public_id);
      }
      
      // Upload new image to Cloudinary
      const result = await uploadToCloudinary(req.file.path, { folder: 'preset-images' });
      
      // Update image URL and public_id
      presetImage.url = result.secure_url;
      presetImage.public_id = result.public_id;
      
      // Clean up temporary file
      await fs.unlink(req.file.path);
    }
    
    // Update other fields
    presetImage.category = category || presetImage.category;
    presetImage.subcategory = subcategory || presetImage.subcategory;
    presetImage.name = name || presetImage.name;
    presetImage.tags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : presetImage.tags;
    
    await presetImage.save();
    
    res.json(presetImage);
  } catch (error) {
    // If any error occurs, attempt to clean up images that were already uploaded to Cloudinary
    if (req.file && req.file.path) {
      console.log('Error occurred, cleaning up uploaded images...');
      await fs.unlink(req.file.path).catch(err => console.error('Error deleting temp file:', err));
      if (presetImage.public_id) {
        await deleteFromCloudinary(presetImage.public_id).catch(err => console.error('Error deleting image from Cloudinary:', err));
      }
    }
    console.error('Error in updatePresetImageWithFile:', error.message);
    console.error('Stack Trace:', error.stack);
    res.status(500).json({ message: 'Error updating preset image with file', error: error.message });
  }
};

// @desc    Get hot deals products
// @route   GET /api/products/hot-deals
// @access  Public
exports.getHotDeals = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 12;
    const skip = (page - 1) * limit;

    const hotDeals = await Product.find({
      isHotDeal: true,
      $or: [ { status: 'active' }, { status: { $exists: false } } ]
    })
    .populate('seller', 'displayName email profilePicture')
    .sort({ discountPercentage: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit);

    const total = await Product.countDocuments({
      isHotDeal: true,
      $or: [ { status: 'active' }, { status: { $exists: false } } ]
    });

    res.json({
      products: hotDeals,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalProducts: total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching hot deals:', error);
    res.status(500).json({ message: 'Error fetching hot deals', error: error.message });
  }
};

// Delete a preset image (admin only)
exports.deletePresetImage = async (req, res) => {
  try {
    const presetImage = await PresetImage.findById(req.params.id);
    
    if (!presetImage) {
      return res.status(404).json({ message: 'Preset image not found' });
    }
    
    // Delete image from Cloudinary if public_id exists
    if (presetImage.public_id) {
      await deleteFromCloudinary(presetImage.public_id);
    }
    
    // Delete the preset image document
    await PresetImage.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Preset image deleted successfully' });
  } catch (error) {
    console.error('Error in deletePresetImage:', error);
    res.status(500).json({ message: 'Error deleting preset image', error: error.message });
  }
};