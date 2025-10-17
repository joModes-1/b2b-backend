const mongoose = require('mongoose');
const QRCode = require('qrcode');
const crypto = require('crypto');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: true,
    default: function() {
      return 'ORD-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    }
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [{
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    name: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    weight: {
      type: Number,
      default: 1
    }
  }],
  shippingInfo: {
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number] // [longitude, latitude]
      }
    },
    fullName: {
      type: String,
      required: true
    },
    address: {
      type: String,
      required: true
    },
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    zipCode: {
      type: String,
      required: true
    },
    country: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      required: true
    }
  },
  paymentInfo: {
    id: {
      type: String
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed'],
      default: 'pending'
    },
    type: {
      type: String,
      enum: ['stripe', 'paypal', 'flutterwave', 'mobile_money', 'cod'],
      required: true
    },
    provider: {
      type: String,
      enum: ['mtn', 'airtel', 'stripe', 'paypal', 'flutterwave', 'cash'],
      required: false
    },
    transactionId: String,
    reference: String
  },
  transportCost: {
    type: Number,
    default: 0
  },
  multiLocationFee: {
    type: Number,
    default: 0
  },
  subtotal: {
    type: Number,
    required: true
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  isPaid: {
    type: Boolean,
    default: false
  },
  paidAt: {
    type: Date
  },
  isDelivered: {
    type: Boolean,
    default: false
  },
  deliveredAt: {
    type: Date
  },
  // Commission fields
  commission: {
    percentage: {
      type: Number,
      required: true,
      default: function() {
        return this.paymentInfo.type === 'cod' ? 4 : 3;
      }
    },
    amount: {
      type: Number,
      required: true,
      default: 0
    },
    status: {
      type: String,
      enum: ['pending', 'collected', 'paid'],
      default: 'pending'
    }
  },
  // Mobile money fee estimation
  estimatedMobileFees: {
    type: Number,
    default: 0
  },
  netAmount: {
    type: Number,
    required: true,
    default: 0
  },
  // QR Code data
  qrCode: {
    data: String,
    imageUrl: String,
    generatedAt: Date
  },
  // Driver assignment
  assignedDriver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeliveryPerson'
  },
  driverEvents: [{
    eventType: {
      type: String,
      enum: ['assigned', 'pickup_confirmed', 'in_transit', 'delivered', 'cash_collected', 'deposited']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: [Number]
    },
    notes: String,
    photoUrl: String
  }],
  // Seller locations for multi-location orders
  sellerLocations: [{
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: [Number]
    },
    distance: Number,
    transportCost: Number
  }]
}, {
  timestamps: true
});

// Calculate commission and net amount before saving
orderSchema.pre('save', async function(next) {
  if (this.isModified('totalAmount') || this.isModified('paymentInfo.type')) {
    // Calculate commission
    const commissionPercentage = this.paymentInfo.type === 'cod' ? 4 : 3;
    this.commission.percentage = commissionPercentage;
    this.commission.amount = Math.round((this.totalAmount * commissionPercentage) / 100);
    
    // Estimate mobile money fees (simplified - adjust based on actual provider rates)
    if (this.paymentInfo.type === 'mobile_money') {
      if (this.totalAmount <= 5000) {
        this.estimatedMobileFees = 150;
      } else if (this.totalAmount <= 30000) {
        this.estimatedMobileFees = 300;
      } else {
        this.estimatedMobileFees = Math.round(this.totalAmount * 0.01); // 1% for larger amounts
      }
    } else {
      this.estimatedMobileFees = 0;
    }
    
    // Calculate net amount
    this.netAmount = this.totalAmount - this.commission.amount - this.estimatedMobileFees;
  }
  
  // Generate QR code if not exists
  if (!this.qrCode.data && this.orderId) {
    await this.generateQRCode();
  }
  
  next();
});

// Method to generate QR code
orderSchema.methods.generateQRCode = async function() {
  const qrData = {
    orderId: this.orderId,
    amount: this.totalAmount,
    paymentType: this.paymentInfo.type,
    timestamp: new Date().toISOString(),
    commission: this.commission.amount
  };
  
  try {
    const qrString = JSON.stringify(qrData);
    const qrImage = await QRCode.toDataURL(qrString, {
      width: 300,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    this.qrCode = {
      data: qrString,
      imageUrl: qrImage,
      generatedAt: new Date()
    };
  } catch (error) {
    console.error('Error generating QR code:', error);
  }
};

// Add indexes for better query performance
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ 'paymentInfo.status': 1 });
orderSchema.index({ orderId: 1 });
orderSchema.index({ assignedDriver: 1 });
orderSchema.index({ 'commission.status': 1 });
orderSchema.index({ 'shippingInfo.coordinates': '2dsphere' });

// Check if model already exists before compiling
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

module.exports = Order; 