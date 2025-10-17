const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../../models/Order');
const User = require('../models/User');

// Create a review
router.post('/create', async (req, res) => {
  try {
    const { 
      productId, 
      retailerId, 
      orderId, 
      rating, 
      comment, 
      images 
    } = req.body;
    
    // Validate product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Validate retailer exists and is a buyer
    const retailer = await User.findById(retailerId);
    if (!retailer || retailer.role !== 'buyer') {
      return res.status(404).json({ error: 'Retailer not found or invalid role' });
    }
    
    // Check for existing review from this retailer for this product
    const existingReview = await Review.findOne({
      product: productId,
      retailer: retailerId
    });
    
    if (existingReview) {
      return res.status(400).json({ 
        error: 'You have already reviewed this product',
        reviewId: existingReview._id
      });
    }
    
    // Verify purchase if orderId provided
    let verifiedPurchase = false;
    if (orderId) {
      const order = await Order.findOne({
        _id: orderId,
        user: retailerId,
        'items.product': productId,
        status: 'delivered'
      });
      
      if (order) {
        verifiedPurchase = true;
      }
    }
    
    // Create review
    const review = new Review({
      product: productId,
      order: orderId,
      retailer: retailerId,
      wholesaler: product.seller,
      rating,
      comment,
      images,
      verifiedPurchase,
      status: 'pending' // Auto-approve if needed based on business rules
    });
    
    // Auto-approve verified purchases
    if (verifiedPurchase) {
      review.status = 'approved';
    }
    
    await review.save();
    
    // Update product rating if review is approved
    if (review.status === 'approved') {
      const stats = await Review.calculateProductRating(productId);
      // You might want to store these stats in the Product model
    }
    
    res.json({
      success: true,
      message: 'Review submitted successfully',
      review: {
        _id: review._id,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        verifiedPurchase: review.verifiedPurchase
      }
    });
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

// Get reviews for a product
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { 
      status = 'approved', 
      sort = '-createdAt', 
      limit = 20, 
      offset = 0,
      rating
    } = req.query;
    
    let query = { product: productId };
    
    // Filter by status (only show approved to public)
    if (status !== 'all') {
      query.status = status;
    }
    
    // Filter by rating if specified
    if (rating) {
      query.rating = Number(rating);
    }
    
    const reviews = await Review.find(query)
      .populate('retailer', 'name')
      .populate('response.respondedBy', 'name')
      .sort(sort)
      .limit(Number(limit))
      .skip(Number(offset));
    
    // Get rating statistics
    const stats = await Review.calculateProductRating(productId);
    
    // Format reviews for response
    const formattedReviews = reviews.map(review => ({
      _id: review._id,
      rating: review.rating,
      comment: review.comment,
      images: review.images,
      retailerName: review.displayName,
      verifiedPurchase: review.verifiedPurchase,
      helpful: review.helpful.count,
      response: review.response,
      createdAt: review.createdAt
    }));
    
    res.json({
      success: true,
      stats,
      reviews: formattedReviews,
      total: await Review.countDocuments(query)
    });
  } catch (error) {
    console.error('Error fetching product reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Wholesaler response to review
router.post('/respond/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { wholesalerId, responseText } = req.body;
    
    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    // Verify the responder is the wholesaler
    if (review.wholesaler.toString() !== wholesalerId) {
      return res.status(403).json({ error: 'Only the product owner can respond to reviews' });
    }
    
    // Check if already responded
    if (review.response && review.response.text) {
      return res.status(400).json({ error: 'Review already has a response' });
    }
    
    // Add response
    review.response = {
      text: responseText,
      respondedBy: wholesalerId,
      respondedAt: new Date()
    };
    
    await review.save();
    
    res.json({
      success: true,
      message: 'Response added successfully',
      response: review.response
    });
  } catch (error) {
    console.error('Error responding to review:', error);
    res.status(500).json({ error: 'Failed to respond to review' });
  }
});

// Mark review as helpful
router.post('/helpful/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { userId } = req.body;
    
    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    const marked = review.markAsHelpful(userId);
    if (!marked) {
      return res.status(400).json({ error: 'Already marked as helpful' });
    }
    
    await review.save();
    
    res.json({
      success: true,
      message: 'Review marked as helpful',
      helpfulCount: review.helpful.count
    });
  } catch (error) {
    console.error('Error marking review as helpful:', error);
    res.status(500).json({ error: 'Failed to mark as helpful' });
  }
});

// Flag review for moderation
router.post('/flag/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { userId, reason, notes } = req.body;
    
    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    // Check if user already flagged this review
    const alreadyFlagged = review.flags.some(flag => 
      flag.flaggedBy.toString() === userId
    );
    
    if (alreadyFlagged) {
      return res.status(400).json({ error: 'You have already flagged this review' });
    }
    
    // Add flag
    review.flags.push({
      reason,
      flaggedBy: userId,
      notes
    });
    
    // Auto-flag for moderation if multiple flags
    if (review.flags.length >= 3) {
      review.status = 'flagged';
    }
    
    await review.save();
    
    res.json({
      success: true,
      message: 'Review flagged for moderation'
    });
  } catch (error) {
    console.error('Error flagging review:', error);
    res.status(500).json({ error: 'Failed to flag review' });
  }
});

// Admin: Moderate review
router.put('/moderate/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { adminId, action, notes } = req.body; // action: approve, reject
    
    // Verify admin role
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    review.status = action === 'approve' ? 'approved' : 'rejected';
    review.moderationNotes = notes;
    review.moderatedBy = adminId;
    review.moderatedAt = new Date();
    
    await review.save();
    
    // Update product rating if approved
    if (review.status === 'approved') {
      const stats = await Review.calculateProductRating(review.product);
      // Update product with new stats
    }
    
    res.json({
      success: true,
      message: `Review ${action}d successfully`,
      review
    });
  } catch (error) {
    console.error('Error moderating review:', error);
    res.status(500).json({ error: 'Failed to moderate review' });
  }
});

// Get reviews for moderation (admin)
router.get('/moderation/pending', async (req, res) => {
  try {
    const { adminId } = req.query;
    
    // Verify admin role
    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const reviews = await Review.find({
      status: { $in: ['pending', 'flagged'] }
    })
    .populate('product', 'name')
    .populate('retailer', 'name')
    .populate('wholesaler', 'name')
    .populate('flags.flaggedBy', 'name')
    .sort('-createdAt');
    
    res.json({
      success: true,
      total: reviews.length,
      reviews
    });
  } catch (error) {
    console.error('Error fetching reviews for moderation:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Get wholesaler's product reviews
router.get('/wholesaler/:wholesalerId', async (req, res) => {
  try {
    const { wholesalerId } = req.params;
    const { status, responded, limit = 20, offset = 0 } = req.query;
    
    let query = { wholesaler: wholesalerId };
    
    if (status) query.status = status;
    if (responded === 'true') {
      query['response.text'] = { $exists: true };
    } else if (responded === 'false') {
      query['response.text'] = { $exists: false };
    }
    
    const reviews = await Review.find(query)
      .populate('product', 'name images')
      .populate('retailer', 'name')
      .sort('-createdAt')
      .limit(Number(limit))
      .skip(Number(offset));
    
    const total = await Review.countDocuments(query);
    
    // Get summary statistics
    const stats = await Review.aggregate([
      { $match: { wholesaler: mongoose.Types.ObjectId(wholesalerId) } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          respondedCount: {
            $sum: { $cond: [{ $ne: ['$response.text', null] }, 1, 0] }
          }
        }
      }
    ]);
    
    res.json({
      success: true,
      stats: stats[0] || { averageRating: 0, totalReviews: 0, respondedCount: 0 },
      reviews,
      total
    });
  } catch (error) {
    console.error('Error fetching wholesaler reviews:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Edit review
router.put('/edit/:reviewId', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { retailerId, rating, comment } = req.body;
    
    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    // Verify the editor is the review owner
    if (review.retailer.toString() !== retailerId) {
      return res.status(403).json({ error: 'You can only edit your own reviews' });
    }
    
    // Check if review can be edited (within 7 days and no response)
    const daysSinceCreation = (Date.now() - review.createdAt) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation > 7) {
      return res.status(400).json({ error: 'Reviews can only be edited within 7 days' });
    }
    
    if (review.response && review.response.text) {
      return res.status(400).json({ error: 'Cannot edit review that has a response' });
    }
    
    // Save edit history
    review.editHistory.push({
      previousComment: review.comment,
      previousRating: review.rating
    });
    
    // Update review
    review.rating = rating || review.rating;
    review.comment = comment || review.comment;
    
    await review.save();
    
    res.json({
      success: true,
      message: 'Review updated successfully',
      review
    });
  } catch (error) {
    console.error('Error editing review:', error);
    res.status(500).json({ error: 'Failed to edit review' });
  }
});

module.exports = router;
