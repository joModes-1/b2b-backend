const mongoose = require('mongoose');
const crypto = require('crypto');

const miniShopSchema = new mongoose.Schema({
  shopId: {
    type: String,
    unique: true,
    required: true,
    default: function() {
      return crypto.randomBytes(6).toString('hex');
    }
  },
  wholesaler: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  shopName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    maxlength: 500
  },
  logo: {
    url: String,
    publicId: String
  },
  banner: {
    url: String,
    publicId: String
  },
  customization: {
    primaryColor: {
      type: String,
      default: '#1a73e8'
    },
    secondaryColor: {
      type: String,
      default: '#f0f0f0'
    },
    fontFamily: {
      type: String,
      default: 'Inter'
    }
  },
  products: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  categories: [{
    name: String,
    products: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    }]
  }],
  socialLinks: {
    facebook: String,
    instagram: String,
    twitter: String,
    whatsapp: String
  },
  contactInfo: {
    phone: String,
    email: String,
    address: String,
    workingHours: String
  },
  shareableLink: {
    type: String,
    unique: true,
    sparse: true
  },
  shortLink: {
    type: String,
    unique: true,
    sparse: true
  },
  analytics: {
    totalViews: {
      type: Number,
      default: 0
    },
    uniqueVisitors: {
      type: Number,
      default: 0
    },
    totalOrders: {
      type: Number,
      default: 0
    },
    conversionRate: {
      type: Number,
      default: 0
    },
    lastViewedAt: Date,
    viewHistory: [{
      timestamp: {
        type: Date,
        default: Date.now
      },
      ip: String,
      userAgent: String,
      referrer: String,
      sessionId: String
    }],
    shareClicks: [{
      platform: {
        type: String,
        enum: ['whatsapp', 'facebook', 'sms', 'email', 'copy', 'other']
      },
      timestamp: {
        type: Date,
        default: Date.now
      }
    }],
    orderTracking: [{
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order'
      },
      timestamp: Date,
      amount: Number
    }]
  },
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    showPrices: {
      type: Boolean,
      default: true
    },
    allowDirectOrders: {
      type: Boolean,
      default: true
    },
    requireLogin: {
      type: Boolean,
      default: false
    },
    minimumOrderAmount: {
      type: Number,
      default: 0
    },
    deliveryZones: [{
      name: String,
      districts: [String],
      deliveryFee: Number
    }]
  },
  seoMetadata: {
    title: String,
    description: String,
    keywords: [String],
    ogImage: String
  }
}, {
  timestamps: true
});

// Generate shareable links
miniShopSchema.pre('save', function(next) {
  if (!this.shareableLink) {
    const baseUrl = process.env.FRONTEND_URL || 'https://ujii.netlify.app';
    this.shareableLink = `${baseUrl}/shop/${this.shopId}`;
    this.shortLink = `${baseUrl}/s/${this.shopId.substring(0, 6)}`;
  }
  next();
});

// Update analytics
miniShopSchema.methods.recordView = function(sessionData) {
  this.analytics.totalViews += 1;
  this.analytics.lastViewedAt = new Date();
  
  // Add to view history (limit to last 1000 views)
  this.analytics.viewHistory.push(sessionData);
  if (this.analytics.viewHistory.length > 1000) {
    this.analytics.viewHistory = this.analytics.viewHistory.slice(-1000);
  }
  
  // Update unique visitors (simplified - in production use proper session tracking)
  const uniqueSessions = new Set(this.analytics.viewHistory.map(v => v.sessionId));
  this.analytics.uniqueVisitors = uniqueSessions.size;
};

miniShopSchema.methods.recordShare = function(platform) {
  this.analytics.shareClicks.push({
    platform,
    timestamp: new Date()
  });
};

miniShopSchema.methods.recordOrder = function(orderId, amount) {
  this.analytics.totalOrders += 1;
  this.analytics.orderTracking.push({
    orderId,
    timestamp: new Date(),
    amount
  });
  
  // Update conversion rate
  if (this.analytics.uniqueVisitors > 0) {
    this.analytics.conversionRate = (this.analytics.totalOrders / this.analytics.uniqueVisitors) * 100;
  }
};

// Indexes
miniShopSchema.index({ wholesaler: 1 });
miniShopSchema.index({ shopId: 1 });
miniShopSchema.index({ shareableLink: 1 });
miniShopSchema.index({ isActive: 1 });

const MiniShop = mongoose.model('MiniShop', miniShopSchema);

module.exports = MiniShop;
