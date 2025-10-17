const mongoose = require('mongoose');

const refundRequestSchema = new mongoose.Schema({
  requestId: {
    type: String,
    unique: true,
    required: true,
    default: function() {
      return 'REF-' + Date.now() + '-' + require('crypto').randomBytes(4).toString('hex').toUpperCase();
    }
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestType: {
    type: String,
    enum: ['refund', 'cancellation', 'return'],
    required: true
  },
  reason: {
    type: String,
    enum: [
      'defective_product',
      'wrong_item',
      'not_as_described',
      'damaged_in_transit',
      'changed_mind',
      'late_delivery',
      'duplicate_order',
      'pricing_error',
      'other'
    ],
    required: true
  },
  reasonDetails: {
    type: String,
    maxlength: 1000,
    required: true
  },
  items: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    quantity: Number,
    amount: Number,
    approved: {
      type: Boolean,
      default: null
    }
  }],
  requestAmount: {
    type: Number,
    required: true
  },
  approvedAmount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'under_review', 'approved', 'rejected', 'partial_approved', 'completed', 'cancelled'],
    default: 'pending'
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvalNotes: String,
  approvedAt: Date,
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  processedAt: Date,
  refundMethod: {
    type: String,
    enum: ['original_payment', 'mobile_money', 'bank_transfer', 'store_credit'],
    default: 'original_payment'
  },
  refundDetails: {
    transactionId: String,
    reference: String,
    provider: String,
    accountNumber: String,
    completedAt: Date
  },
  evidence: [{
    type: {
      type: String,
      enum: ['photo', 'video', 'document']
    },
    url: String,
    description: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  timeline: [{
    status: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    notes: String
  }],
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  escalated: {
    type: Boolean,
    default: false
  },
  escalationReason: String,
  estimatedProcessingDays: {
    type: Number,
    default: 7
  },
  actualProcessingDays: Number,
  customerSatisfaction: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: String,
    submittedAt: Date
  }
}, {
  timestamps: true
});

// Indexes
refundRequestSchema.index({ order: 1, requestedBy: 1 });
refundRequestSchema.index({ status: 1, createdAt: -1 });
refundRequestSchema.index({ requestId: 1 });
refundRequestSchema.index({ priority: 1, status: 1 });

// Methods
refundRequestSchema.methods.addTimelineEntry = function(status, performedBy, notes) {
  this.timeline.push({
    status,
    performedBy,
    notes
  });
};

refundRequestSchema.methods.calculateProcessingDays = function() {
  if (this.status === 'completed' && this.processedAt) {
    const days = Math.ceil((this.processedAt - this.createdAt) / (1000 * 60 * 60 * 24));
    this.actualProcessingDays = days;
    return days;
  }
  return null;
};

// Auto-set priority based on order value and reason
refundRequestSchema.pre('save', function(next) {
  if (this.isNew) {
    // Set priority based on reason
    if (['defective_product', 'wrong_item', 'damaged_in_transit'].includes(this.reason)) {
      this.priority = 'high';
    } else if (this.requestAmount > 500000) { // High value orders
      this.priority = 'high';
    } else if (this.requestAmount > 100000) {
      this.priority = 'medium';
    } else {
      this.priority = 'low';
    }
    
    // Add initial timeline entry
    this.timeline.push({
      status: 'requested',
      performedBy: this.requestedBy,
      notes: `${this.requestType} request initiated`
    });
  }
  next();
});

const RefundRequest = mongoose.model('RefundRequest', refundRequestSchema);

module.exports = RefundRequest;
