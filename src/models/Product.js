const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Product description is required']
  },
  price: {
    type: Number,
    required: [true, 'Product price is required'],
    min: [0, 'Price cannot be negative']
  },
  category: {
    type: String,
    required: [true, 'Product category is required']
  },
  productType: {
    type: String,
    required: false
  },
  condition: {
    type: String,
    required: false
  },
  district: {
    type: String,
    required: false // Set to false for demo data
  },
  stock: {
    type: Number,
    required: false, // Temporarily false for seeding
    min: [0, 'Stock cannot be negative'],
    default: 0
  },
  specifications: {
    type: Map,
    of: String,
    default: {}
  },
  features: [{
    type: String
  }],
  images: [{
    url: {
      type: String,
      required: true
    },
    public_id: {
      type: String,
      required: false
    }
  }],
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'draft'],
    default: 'active'
  },
  isHotDeal: {
    type: Boolean,
    default: false
  },
  hotDealType: {
    type: String,
    enum: ['percentage', 'buy_x_get_y', 'free_delivery', 'fixed_amount'],
    required: false
  },
  isTrending: {
    type: Boolean,
    default: false
  },
  originalPrice: {
    type: Number,
    required: false,
    min: [0, 'Original price cannot be negative']
  },
  discountPercentage: {
    type: Number,
    required: false,
    min: [0, 'Discount percentage cannot be negative'],
    max: [100, 'Discount percentage cannot exceed 100']
  },
  discountAmount: {
    type: Number,
    required: false,
    min: [0, 'Discount amount cannot be negative']
  },
  buyQuantity: {
    type: Number,
    required: false,
    min: [1, 'Buy quantity must be at least 1']
  },
  getFreeQuantity: {
    type: Number,
    required: false,
    min: [1, 'Get free quantity must be at least 1']
  },
  dealDescription: {
    type: String,
    required: false,
    maxlength: [200, 'Deal description cannot exceed 200 characters']
  },
  dealStartDate: {
    type: Date,
    required: false
  },
  dealEndDate: {
    type: Date,
    required: false
  },
}, {
  timestamps: true
});

// Add text index for search functionality
productSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema); 