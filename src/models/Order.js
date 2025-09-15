const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  subtotal: {
    type: Number,
    required: true
  }
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    // The `required` property is removed because the order number is auto-generated
    // by the pre-save hook. The validation was firing before the hook could run.
    sparse: true // Allows multiple documents to have a null value if not yet generated
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  subtotal: {
    type: Number,
    required: true
  },
  tax: {
    type: Number,
    default: 0
  },
  shippingCost: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending'
  },
  shippingAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  paymentMethod: {
    type: String,
    enum: ['cod', 'paypal', 'stripe', 'pesapal', 'mtn', 'airtel'],
    default: null
  },
  deliveryConfirmation: {
    qrCode: String, // Base64 encoded QR code image
    deliveryToken: String, // Secure token for delivery confirmation
    deliveryUrl: String, // URL that the QR code points to
    confirmedAt: Date,
    confirmedBy: String // Delivery person identifier
  },
  shippingMethod: {
    type: String,
    enum: ['standard', 'express', 'priority'],
    default: 'standard'
  },
  trackingNumber: String,
  notes: String,
  estimatedDeliveryDate: Date,
  statusHistory: [{
    status: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    note: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }]
}, {
  timestamps: true
});

// Add indexes for frequent queries
orderSchema.index({ buyer: 1, createdAt: -1 });
orderSchema.index({ seller: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'items.listing': 1 });
orderSchema.index({ createdAt: 1 });

// Auto-generate order number
orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    
    // Get the count of orders for the current month
    const count = await mongoose.model('Order').countDocuments({
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), 1),
        $lt: new Date(date.getFullYear(), date.getMonth() + 1, 1)
      }
    });

    // Format: ORD-YY-MM-XXXX (e.g., ORD-23-01-0001)
    this.orderNumber = `ORD-${year}-${month}-${(count + 1).toString().padStart(4, '0')}`;

    // Add initial status to history
    this.statusHistory = [{
      status: this.status,
      timestamp: new Date(),
      note: 'Order created',
      updatedBy: this.buyer
    }];
  }
  next();
});

// Method to update order status
orderSchema.methods.updateStatus = function(newStatus, note, userId) {
  this.status = newStatus;
  this.statusHistory.push({
    status: newStatus,
    timestamp: new Date(),
    note: note || `Status updated to ${newStatus}`,
    updatedBy: userId
  });
};

module.exports = mongoose.model('Order', orderSchema); 