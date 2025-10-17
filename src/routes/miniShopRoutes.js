const express = require('express');
const router = express.Router();
const MiniShop = require('../models/MiniShop');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../../models/Order');

// Create mini-shop for wholesaler
router.post('/create', async (req, res) => {
  try {
    const { 
      wholesalerId, 
      shopName, 
      description, 
      logo, 
      banner,
      customization,
      socialLinks,
      contactInfo,
      settings,
      seoMetadata
    } = req.body;
    
    // Verify wholesaler exists and is a seller
    const wholesaler = await User.findById(wholesalerId);
    if (!wholesaler || wholesaler.role !== 'seller') {
      return res.status(404).json({ error: 'Wholesaler not found or not a seller' });
    }
    
    // Check if wholesaler already has a mini-shop
    const existingShop = await MiniShop.findOne({ wholesaler: wholesalerId });
    if (existingShop) {
      return res.status(400).json({ 
        error: 'Wholesaler already has a mini-shop',
        shopId: existingShop.shopId,
        link: existingShop.shareableLink
      });
    }
    
    // Get all products for this wholesaler
    const products = await Product.find({ 
      seller: wholesalerId,
      status: 'active'
    });
    
    // Group products by category
    const categoriesMap = {};
    products.forEach(product => {
      if (!categoriesMap[product.category]) {
        categoriesMap[product.category] = [];
      }
      categoriesMap[product.category].push(product._id);
    });
    
    const categories = Object.entries(categoriesMap).map(([name, productIds]) => ({
      name,
      products: productIds
    }));
    
    // Create mini-shop
    const miniShop = new MiniShop({
      wholesaler: wholesalerId,
      shopName: shopName || wholesaler.name + "'s Shop",
      description: description || `Welcome to ${wholesaler.name}'s wholesale shop`,
      logo,
      banner,
      customization,
      products: products.map(p => p._id),
      categories,
      socialLinks,
      contactInfo: contactInfo || {
        phone: wholesaler.phoneNumber,
        email: wholesaler.email,
        address: wholesaler.businessLocation?.formattedAddress
      },
      settings,
      seoMetadata: seoMetadata || {
        title: `${wholesaler.name} - Wholesale Shop`,
        description: description || `Shop quality wholesale products from ${wholesaler.name}`,
        keywords: [...new Set(products.map(p => p.category))]
      }
    });
    
    await miniShop.save();
    
    res.json({
      success: true,
      message: 'Mini-shop created successfully',
      miniShop: {
        shopId: miniShop.shopId,
        shareableLink: miniShop.shareableLink,
        shortLink: miniShop.shortLink,
        shopName: miniShop.shopName
      }
    });
  } catch (error) {
    console.error('Error creating mini-shop:', error);
    res.status(500).json({ error: 'Failed to create mini-shop' });
  }
});

// Update mini-shop
router.put('/update/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const updates = req.body;
    
    const miniShop = await MiniShop.findOne({ shopId });
    if (!miniShop) {
      return res.status(404).json({ error: 'Mini-shop not found' });
    }
    
    // Update allowed fields
    const allowedUpdates = [
      'shopName', 'description', 'logo', 'banner', 
      'customization', 'socialLinks', 'contactInfo', 
      'settings', 'seoMetadata', 'isActive'
    ];
    
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        miniShop[field] = updates[field];
      }
    });
    
    await miniShop.save();
    
    res.json({
      success: true,
      message: 'Mini-shop updated successfully',
      miniShop
    });
  } catch (error) {
    console.error('Error updating mini-shop:', error);
    res.status(500).json({ error: 'Failed to update mini-shop' });
  }
});

// Get mini-shop by ID (public access)
router.get('/shop/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { sessionId, referrer, userAgent } = req.headers;
    
    const miniShop = await MiniShop.findOne({ 
      shopId,
      isActive: true 
    })
    .populate('wholesaler', 'name email phoneNumber businessLocation')
    .populate('products')
    .populate('categories.products');
    
    if (!miniShop) {
      return res.status(404).json({ error: 'Shop not found or inactive' });
    }
    
    // Record view
    miniShop.recordView({
      sessionId: sessionId || req.ip,
      ip: req.ip,
      userAgent,
      referrer
    });
    await miniShop.save();
    
    res.json({
      success: true,
      shop: miniShop
    });
  } catch (error) {
    console.error('Error fetching mini-shop:', error);
    res.status(500).json({ error: 'Failed to fetch shop' });
  }
});

// Get wholesaler's mini-shop
router.get('/wholesaler/:wholesalerId', async (req, res) => {
  try {
    const { wholesalerId } = req.params;
    
    const miniShop = await MiniShop.findOne({ wholesaler: wholesalerId })
      .populate('products', 'name price category images')
      .populate('categories.products', 'name price images');
    
    if (!miniShop) {
      return res.status(404).json({ error: 'Mini-shop not found for this wholesaler' });
    }
    
    res.json({
      success: true,
      miniShop
    });
  } catch (error) {
    console.error('Error fetching wholesaler mini-shop:', error);
    res.status(500).json({ error: 'Failed to fetch mini-shop' });
  }
});

// Update mini-shop products
router.put('/products/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { action, productIds } = req.body; // action: 'add' or 'remove'
    
    const miniShop = await MiniShop.findOne({ shopId });
    if (!miniShop) {
      return res.status(404).json({ error: 'Mini-shop not found' });
    }
    
    if (action === 'add') {
      // Verify products belong to the wholesaler
      const products = await Product.find({
        _id: { $in: productIds },
        seller: miniShop.wholesaler
      });
      
      if (products.length !== productIds.length) {
        return res.status(400).json({ error: 'Some products do not belong to this wholesaler' });
      }
      
      // Add products to shop
      const newProductIds = productIds.filter(id => 
        !miniShop.products.includes(id)
      );
      miniShop.products.push(...newProductIds);
      
      // Update categories
      for (const product of products) {
        let category = miniShop.categories.find(c => c.name === product.category);
        if (!category) {
          miniShop.categories.push({
            name: product.category,
            products: [product._id]
          });
        } else if (!category.products.includes(product._id)) {
          category.products.push(product._id);
        }
      }
    } else if (action === 'remove') {
      // Remove products from shop
      miniShop.products = miniShop.products.filter(id => 
        !productIds.includes(id.toString())
      );
      
      // Update categories
      miniShop.categories.forEach(category => {
        category.products = category.products.filter(id => 
          !productIds.includes(id.toString())
        );
      });
      
      // Remove empty categories
      miniShop.categories = miniShop.categories.filter(c => c.products.length > 0);
    }
    
    await miniShop.save();
    
    res.json({
      success: true,
      message: `Products ${action === 'add' ? 'added to' : 'removed from'} mini-shop`,
      totalProducts: miniShop.products.length
    });
  } catch (error) {
    console.error('Error updating mini-shop products:', error);
    res.status(500).json({ error: 'Failed to update products' });
  }
});

// Track share click
router.post('/track-share/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { platform } = req.body;
    
    const miniShop = await MiniShop.findOne({ shopId });
    if (!miniShop) {
      return res.status(404).json({ error: 'Mini-shop not found' });
    }
    
    miniShop.recordShare(platform);
    await miniShop.save();
    
    res.json({
      success: true,
      message: 'Share tracked successfully'
    });
  } catch (error) {
    console.error('Error tracking share:', error);
    res.status(500).json({ error: 'Failed to track share' });
  }
});

// Get share links for mini-shop
router.get('/share-links/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    
    const miniShop = await MiniShop.findOne({ shopId })
      .populate('wholesaler', 'name');
    
    if (!miniShop) {
      return res.status(404).json({ error: 'Mini-shop not found' });
    }
    
    const shareText = `Check out ${miniShop.shopName} for great wholesale deals!`;
    const shareUrl = miniShop.shareableLink;
    
    const shareLinks = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
      sms: `sms:?body=${encodeURIComponent(shareText + ' ' + shareUrl)}`,
      email: `mailto:?subject=${encodeURIComponent(miniShop.shopName)}&body=${encodeURIComponent(shareText + '\n\n' + shareUrl)}`,
      copyText: `${shareText}\n${shareUrl}`
    };
    
    res.json({
      success: true,
      shareLinks,
      directLink: shareUrl,
      shortLink: miniShop.shortLink
    });
  } catch (error) {
    console.error('Error generating share links:', error);
    res.status(500).json({ error: 'Failed to generate share links' });
  }
});

// Get analytics for mini-shop
router.get('/analytics/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { startDate, endDate } = req.query;
    
    const miniShop = await MiniShop.findOne({ shopId })
      .populate('analytics.orderTracking.orderId', 'orderId totalAmount status');
    
    if (!miniShop) {
      return res.status(404).json({ error: 'Mini-shop not found' });
    }
    
    let analytics = {
      totalViews: miniShop.analytics.totalViews,
      uniqueVisitors: miniShop.analytics.uniqueVisitors,
      totalOrders: miniShop.analytics.totalOrders,
      conversionRate: miniShop.analytics.conversionRate,
      lastViewedAt: miniShop.analytics.lastViewedAt
    };
    
    // Filter by date range if provided
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : new Date(0);
      const end = endDate ? new Date(endDate) : new Date();
      
      analytics.viewsInPeriod = miniShop.analytics.viewHistory.filter(v => 
        v.timestamp >= start && v.timestamp <= end
      ).length;
      
      analytics.sharesInPeriod = miniShop.analytics.shareClicks.filter(s => 
        s.timestamp >= start && s.timestamp <= end
      ).length;
      
      analytics.ordersInPeriod = miniShop.analytics.orderTracking.filter(o => 
        o.timestamp >= start && o.timestamp <= end
      );
    }
    
    // Share platform breakdown
    const sharePlatforms = {};
    miniShop.analytics.shareClicks.forEach(click => {
      sharePlatforms[click.platform] = (sharePlatforms[click.platform] || 0) + 1;
    });
    analytics.sharePlatforms = sharePlatforms;
    
    // Recent activity
    analytics.recentViews = miniShop.analytics.viewHistory.slice(-10);
    analytics.recentShares = miniShop.analytics.shareClicks.slice(-10);
    analytics.recentOrders = miniShop.analytics.orderTracking.slice(-10);
    
    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Create order from mini-shop
router.post('/create-order/:shopId', async (req, res) => {
  try {
    const { shopId } = req.params;
    const { buyerId, items, shippingInfo } = req.body;
    
    const miniShop = await MiniShop.findOne({ shopId });
    if (!miniShop) {
      return res.status(404).json({ error: 'Mini-shop not found' });
    }
    
    // Verify products are in mini-shop
    const productIds = items.map(item => item.productId);
    const validProducts = miniShop.products.filter(p => 
      productIds.includes(p.toString())
    );
    
    if (validProducts.length !== productIds.length) {
      return res.status(400).json({ error: 'Some products are not available in this shop' });
    }
    
    // Create order (simplified - use existing order creation logic)
    // ... order creation logic ...
    
    // Track order in mini-shop analytics
    miniShop.recordOrder('orderId', 'amount'); // Replace with actual order ID and amount
    await miniShop.save();
    
    res.json({
      success: true,
      message: 'Order created successfully',
      // order details
    });
  } catch (error) {
    console.error('Error creating order from mini-shop:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

module.exports = router;
