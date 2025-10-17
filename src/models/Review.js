const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: false // Optional - link to order for verified purchase
  },
  retailer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  wholesaler: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    required: true,
    maxlength: 1000
  },
  images: [{
    url: String,
    publicId: String
  }],
  verifiedPurchase: {
    type: Boolean,
    default: false
  },
  helpful: {
    count: {
      type: Number,
      default: 0
    },
    users: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  response: {
    text: {
      type: String,
      maxlength: 500
    },
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    respondedAt: Date
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'flagged'],
    default: 'pending'
  },
  moderationNotes: String,
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  moderatedAt: Date,
  editHistory: [{
    editedAt: {
      type: Date,
      default: Date.now
    },
    previousComment: String,
    previousRating: Number
  }],
  flags: [{
    reason: {
      type: String,
      enum: ['spam', 'inappropriate', 'fake', 'offensive', 'other']
    },
    flaggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    flaggedAt: {
      type: Date,
      default: Date.now
    },
    notes: String
  }]
}, {
  timestamps: true
});

// Indexes
reviewSchema.index({ product: 1, retailer: 1 });
reviewSchema.index({ product: 1, status: 1 });
reviewSchema.index({ wholesaler: 1 });
reviewSchema.index({ rating: -1 });
reviewSchema.index({ createdAt: -1 });

// Virtual for display name
reviewSchema.virtual('displayName').get(function() {
  if (this.retailer && this.retailer.name) {
    // Hide part of the name for privacy
    const name = this.retailer.name;
    if (name.length > 2) {
      return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
    }
    return name;
  }
  return 'Anonymous';
});

// Method to mark as helpful
reviewSchema.methods.markAsHelpful = function(userId) {
  if (!this.helpful.users.includes(userId)) {
    this.helpful.users.push(userId);
    this.helpful.count += 1;
    return true;
  }
  return false;
};

// Method to remove helpful mark
reviewSchema.methods.unmarkAsHelpful = function(userId) {
  const index = this.helpful.users.indexOf(userId);
  if (index > -1) {
    this.helpful.users.splice(index, 1);
    this.helpful.count -= 1;
    return true;
  }
  return false;
};

// Static method to calculate product rating
reviewSchema.statics.calculateProductRating = async function(productId) {
  const result = await this.aggregate([
    {
      $match: {
        product: mongoose.Types.ObjectId(productId),
        status: 'approved'
      }
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        ratingDistribution: {
          $push: '$rating'
        }
      }
    }
  ]);
  
  if (result.length === 0) {
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  }
  
  // Calculate rating distribution
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  result[0].ratingDistribution.forEach(rating => {
    distribution[rating] += 1;
  });
  
  return {
    averageRating: Math.round(result[0].averageRating * 10) / 10,
    totalReviews: result[0].totalReviews,
    ratingDistribution: distribution
  };
};

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
