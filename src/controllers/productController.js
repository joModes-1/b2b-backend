const Product = require('../models/Product');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');

// Get all products (public)
exports.getAllProducts = async (req, res) => {
  try {
    console.log('--- Executing getAllProducts ---');
    // Advanced search: use aggregation to score and sort by relevance
    let sanitizedProducts = [];
    if (req.query.search && req.query.search.trim() !== '') {
      const search = req.query.search.trim();
      const searchRegex = new RegExp(search, 'i');
      const exactNameRegex = new RegExp(`^${search}$`, 'i');
      // First, find the category of the exact match (if any)
      let exactCategory = null;
      const exactMatchDoc = await Product.findOne({ name: { $regex: exactNameRegex } });
      if (exactMatchDoc) exactCategory = exactMatchDoc.category;
      
      // Aggregation pipeline
      const pipeline = [
        {
          $addFields: {
            relevance: {
              $switch: {
                branches: [
                  { case: { $regexMatch: { input: "$name", regex: exactNameRegex } }, then: 4 },
                  { case: { $and: [
                    { $regexMatch: { input: "$name", regex: searchRegex } },
                    { $not: [{ $regexMatch: { input: "$name", regex: exactNameRegex } }] }
                  ] }, then: 3 },
                  { case: { $and: [
                    { $eq: ["$category", exactCategory] },
                    { $not: [{ $regexMatch: { input: "$name", regex: searchRegex } }] }
                  ] }, then: 2 },
                  { case: { $or: [
                    { $regexMatch: { input: "$name", regex: searchRegex } },
                    { $regexMatch: { input: "$description", regex: searchRegex } }
                  ] }, then: 1 },
                ],
                default: 0
              }
            }
          }
        },
        { $match: { relevance: { $gt: 0 } } },
        { $sort: { relevance: -1, name: 1 } }
      ];
      sanitizedProducts = await Product.aggregate(pipeline);
      // Populate seller for each product (manual, since aggregate doesn't auto-populate)
      const ids = sanitizedProducts.map(p => p._id);
      const populated = await Product.find({ _id: { $in: ids } }).populate('seller', 'name companyName');
      // Preserve aggregation order
      const popMap = new Map(populated.map(p => [p._id.toString(), p]));
      sanitizedProducts = sanitizedProducts.map(p => {
        const full = popMap.get(p._id.toString());
        if (full && !full.seller) {
          full.seller = { _id: null, name: 'Unknown Seller', companyName: 'Unknown Seller' };
        }
        return full || p;
      }).filter(Boolean);
    } else {
      // No search: default to normal
      // Fetch products with pagination for infinite scroll
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const products = await Product.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('seller', 'name companyName');
      // If user is authenticated, move their products to the top
      if (req.user && req.user._id) {
        const myProducts = [];
        const otherProducts = [];
        for (const p of products) {
          if (!p.seller) {
            p.seller = { _id: null, name: 'Unknown Seller', companyName: 'Unknown Seller' };
          }
          if (p.seller && p.seller._id && p.seller._id.toString() === req.user._id.toString()) {
            myProducts.push(p);
          } else {
            otherProducts.push(p);
          }
        }
        sanitizedProducts = [...myProducts, ...otherProducts];
      } else {
        sanitizedProducts = products.map(p => {
          if (!p.seller) {
            p.seller = { _id: null, name: 'Unknown Seller', companyName: 'Unknown Seller' };
          }
          return p;
        });
      }
    }

    // Respond with paginated products (already paginated from DB)
    res.json({
      data: sanitizedProducts,
      total: undefined, // Optionally, you can add total count if you want, but not needed for infinite scroll
      currentPage: page,
      hasNextPage: sanitizedProducts.length === limit
    });
  } catch (error) {
    console.error('Error in getAllProducts:', error);
    res.status(500).json({ message: 'Error fetching products', error: error.message });
  }
};

// Get single product (public)
exports.getProduct = async (req, res) => {
  try {
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
    const { name, description, price, category, stock } = req.body;
    const errors = [];
    if (!name || typeof name !== 'string' || name.trim() === '') errors.push('Product name is required.');
    if (!description || typeof description !== 'string' || description.trim() === '') errors.push('Product description is required.');
    if (price === undefined || isNaN(Number(price)) || Number(price) < 0) errors.push('Valid product price is required and cannot be negative.');
    if (!category || typeof category !== 'string' || category.trim() === '') errors.push('Product category is required.');
    if (!req.user || !req.user._id) errors.push('Seller information is missing or invalid.');
    if (!imageUrls.length) errors.push('At least one product image is required.');
    // Stock is optional but if provided, must be non-negative
    if (stock !== undefined && (isNaN(Number(stock)) || Number(stock) < 0)) errors.push('Stock must be a non-negative number.');
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
    const { name, description, price, category, stock } = req.body;
    const updateData = {
      name,
      description,
      price,
      category,
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
    if (categoryCountsCache.data && categoryCountsCache.expires > now) {
      return res.json({ success: true, data: categoryCountsCache.data, cached: true });
    }
    // First get total count for 'All' category
    const totalCount = await Product.countDocuments();
    
    // Get counts for each category by grouping all products
    const counts = await Product.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Format as { category: count } and add total count for 'All'
    const result = { 'All': totalCount };
    counts.forEach(c => { result[c._id] = c.count; });
    categoryCountsCache = {
      data: result,
      expires: now + 60 * 1000 // 60 seconds TTL
    };
    res.json({ success: true, data: result, cached: false });
  } catch (error) {
    console.error('Error in getCategoryCounts:', error);
    res.status(500).json({ success: false, message: 'Error fetching category counts', error: error.message });
  }
};

// Get featured products (public) - latest 8 active products
exports.getFeaturedProducts = async (req, res) => {
  try {
    const products = await Product.find({ status: 'active' })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('seller', 'name');
    res.json(products);
  } catch (error) {
    console.error('Error fetching featured products:', error);
    res.status(500).json({ message: 'Error fetching featured products', error: error.message });
  }
}; 