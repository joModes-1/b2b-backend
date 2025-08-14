const Product = require('../models/Product');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');

// Get all products (public)
exports.getAllProducts = async (req, res) => {
  console.log('--- New Request to getAllProducts ---');
  console.log('Request Query:', req.query);

  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const filters = {};

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

// Create product
exports.createProduct = async (req, res) => {
  const files = req.files;
  const imageUrls = []; // To store details of uploaded images for potential cleanup

  try {
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

    // 2. Upload images to Cloudinary
    if (files && files.length > 0) {
      for (const file of files) {
        const result = await uploadToCloudinary(file.path, 'products');
        imageUrls.push({ url: result.secure_url, public_id: result.public_id });
      }
    }

    // 3. Validate all required fields before creating product
    const { name, description, price, category, productType, condition, stock } = req.body;
    const errors = [];
    if (!name || typeof name !== 'string' || name.trim() === '') errors.push('Product name is required.');
    if (!description || typeof description !== 'string' || description.trim() === '') errors.push('Product description is required.');
    if (price === undefined || isNaN(Number(price)) || Number(price) < 0) errors.push('Valid product price is required and cannot be negative.');
    if (!category || typeof category !== 'string' || category.trim() === '') errors.push('Product category is required.');
    if (!req.user || !req.user._id) errors.push('Seller information is missing or invalid.');
    if (!imageUrls.length) errors.push('At least one product image is required.');
    // Stock is optional but if provided, must be non-negative
    if (stock !== undefined && (isNaN(Number(stock)) || Number(stock) < 0)) errors.push('Stock must be a non-negative number.');
    // Product type and condition are optional but if provided, must be strings
    if (productType !== undefined && typeof productType !== 'string') errors.push('Product type must be a string.');
    if (condition !== undefined && typeof condition !== 'string') errors.push('Condition must be a string.');
    // Features/specifications are optional, but if present, must be correct types
    if (features && !Array.isArray(features)) errors.push('Features must be an array of strings.');
    if (specifications && typeof specifications !== 'object') errors.push('Specifications must be an object.');
    if (errors.length) {
      // Clean up uploaded images if validation fails
      if (imageUrls.length > 0) {
        for (const image of imageUrls) {
          try { await deleteFromCloudinary(image.public_id); } catch {}
        }
      }
      return res.status(400).json({ message: 'Product creation failed due to validation errors.', errors });
    }
    const productData = {
      name: name.trim(),
      description: description.trim(),
      price: Number(price),
      category: category.trim(),
      productType: productType || '',
      condition: condition || '',
      stock: stock !== undefined ? Number(stock) : 0,
      specifications,
      features,
      seller: req.user._id,
      images: imageUrls,
    };

    // 4. Save product to database
    const product = new Product(productData);
    await product.save();

    res.status(201).json(product);
  } catch (error) {
    console.error('Error in createProduct:', error.message);
    console.error('Stack Trace:', error.stack);
    // If any error occurs, attempt to clean up images that were already uploaded to Cloudinary
    if (imageUrls.length > 0) {
      console.log('Error occurred, cleaning up uploaded images...');
      for (const image of imageUrls) {
        try {
          await deleteFromCloudinary(image.public_id);
        } catch (cleanupError) {
          console.error('Error cleaning up Cloudinary image:', cleanupError);
        }
      }
    }
    res.status(500).json({ message: 'An internal server error occurred while creating the product.', error: error.message });
  } finally {
    // 5. Clean up temporary files from server
    if (files && files.length > 0) {
      for (const file of files) {
        try {
          await fs.unlink(file.path);
        } catch (cleanupError) {
          console.error('Error deleting temporary file:', cleanupError);
        }
      }
    }
  }
};

exports.updateProduct = async (req, res) => {
  const { id } = req.params;
  const files = req.files;
  const newImageUrls = [];

  try {
    const product = await Product.findOne({ _id: id, seller: req.user._id });
    if (!product) {
      return res.status(404).json({ message: 'Product not found or you do not have permission to edit it.' });
    }

    // 1. Parse JSON fields from FormData
    const specifications = req.body.specifications ? JSON.parse(req.body.specifications) : {};
    const features = req.body.features ? JSON.parse(req.body.features) : [];
    const existingImages = req.body.existingImages ? JSON.parse(req.body.existingImages) : [];

    // 2. Upload new images to Cloudinary
    if (files && files.length > 0) {
      for (const file of files) {
        const result = await uploadToCloudinary(file.path, 'products');
        newImageUrls.push({ url: result.secure_url, public_id: result.public_id });
      }
    }

    // 3. Determine which old images to delete from Cloudinary
    const oldImages = product.images || [];
    const existingImageUrls = existingImages.map(img => img.url);
    const imagesToDelete = oldImages.filter(img => !existingImageUrls.includes(img.url));

    for (const image of imagesToDelete) {
      if (image.public_id) {
        await deleteFromCloudinary(image.public_id);
      }
    }

    // 4. Construct the final update data
    const { name, description, price, category, productType, condition, stock } = req.body;
    const updateData = {
      name,
      description,
      price,
      category,
      productType,
      condition,
      stock,
      specifications,
      features,
      images: [...existingImages, ...newImageUrls],
    };

    // 5. Update product in the database
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res.json(updatedProduct);
  } catch (error) {
    console.error('Error in updateProduct:', error);
    // Cleanup newly uploaded images if update fails
    if (newImageUrls.length > 0) {
      for (const image of newImageUrls) {
        await deleteFromCloudinary(image.public_id);
      }
    }
    res.status(500).json({ message: 'Error updating product', error: error.message });
  } finally {
    // 6. Clean up temporary files from server
    if (files && files.length > 0) {
      for (const file of files) {
        await fs.unlink(file.path).catch(err => console.error('Error deleting temp file:', err));
      }
    }
  }
};

// Delete product
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, seller: req.user._id });
    if (!product) {
      return res.status(404).json({ message: 'Product not found or you do not have permission to delete it.' });
    }

    // Delete associated images from Cloudinary
    if (product.images && product.images.length > 0) {
      for (const image of product.images) {
        if (image.public_id) {
          await deleteFromCloudinary(image.public_id);
        }
      }
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error in deleteProduct:', error);
    res.status(500).json({ message: 'Error deleting product', error: error.message });
  }
};

// Delete product image
exports.deleteProductImage = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      seller: req.user._id
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const image = product.images.id(req.params.imageId);
    if (!image) {
      return res.status(404).json({ message: 'Image not found' });
    }

    // Delete image from Cloudinary
    await deleteFromCloudinary(image.public_id);

    // Remove image from product
    product.images.pull(req.params.imageId);
    await product.save();

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting product image:', error);
    res.status(500).json({ message: 'Error deleting product image' });
  }
};

// In-memory cache for category counts
let categoryCountsCache = {
  data: null,
  expires: 0
};

// Get product counts grouped by category (with simple in-memory cache)
exports.getCategoryCounts = async (req, res) => {
  try {
    const now = Date.now();
    // If a valid cache exists, return it immediately
    if (categoryCountsCache.data && categoryCountsCache.expires > now) {
      return res.json(categoryCountsCache.data);
    }

    // Get total count for 'All' category
    const totalCount = await Product.countDocuments();

    // Get counts for each category
    const categoryData = await Product.aggregate([
      { $unwind: "$category" },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // Format the final array, starting with 'All'
    const finalCategories = [
      { _id: 'All', count: totalCount },
      ...categoryData
    ];

    // Update the cache
    categoryCountsCache = {
      data: finalCategories,
      expires: now + (5 * 60 * 1000) // 5 minute TTL
    };

    // Send the final array as the response
    res.json(finalCategories);

  } catch (error) {
    console.error('Error in getCategoryCounts:', error);
    res.status(500).json({ message: 'Error fetching category counts' });
  }
};

// Get featured products (public) - latest 8 active products
exports.getFeaturedProducts = async (req, res) => {
  try {
    const products = await Product.find({ status: 'active' })
      .sort({ createdAt: -1 })
      .limit(8)
      .select('name price images category district seller')
      .populate('seller', 'name companyName district');
    
    res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error('Error fetching featured products:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get trending products (public) - latest 15 active products
exports.getTrendingProducts = async (req, res) => {
  try {
    const products = await Product.find({ status: 'active' })
      .sort({ createdAt: -1 })
      .limit(15)
      .select('name price images category district seller')
      .populate('seller', 'name companyName district');
    
    res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error('Error fetching trending products:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};