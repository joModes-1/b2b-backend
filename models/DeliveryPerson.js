const mongoose = require('mongoose');

const deliveryPersonSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    default: 'delivery',
    immutable: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  vehicleType: {
    type: String,
    enum: ['motorcycle', 'bicycle', 'car', 'van', 'truck'],
    default: 'motorcycle'
  },
  licenseNumber: {
    type: String,
    required: true
  },
  currentLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    },
    address: String,
    lastUpdated: {
      type: Date,
      default: Date.now
    }
  },
  // Cash management
  cashManagement: {
    currentCashBalance: {
      type: Number,
      default: 0
    },
    cashLimit: {
      type: Number,
      default: 500000 // 500,000 UGX default limit
    },
    totalCollected: {
      type: Number,
      default: 0
    },
    totalDeposited: {
      type: Number,
      default: 0
    },
    lastDepositAt: Date,
    deposits: [{
      amount: Number,
      depositedAt: Date,
      location: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point'
        },
        coordinates: [Number]
      },
      agentDetails: {
        name: String,
        phone: String,
        provider: String
      },
      receiptPhotoUrl: String,
      verificationStatus: {
        type: String,
        enum: ['pending', 'verified', 'rejected'],
        default: 'pending'
      },
      verifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      verifiedAt: Date,
      transactionReference: String
    }]
  },
  // OTP for authentication
  otp: {
    code: String,
    expiresAt: Date,
    attempts: {
      type: Number,
      default: 0
    },
    lastAttemptAt: Date
  },
  workingHours: {
    start: {
      type: String,
      default: '08:00'
    },
    end: {
      type: String,
      default: '18:00'
    }
  },
  // Offline data sync
  offlineData: {
    lastSyncAt: Date,
    pendingSync: [{
      eventType: String,
      data: mongoose.Schema.Types.Mixed,
      timestamp: Date,
      synced: {
        type: Boolean,
        default: false
      }
    }]
  },
  // Active deliveries
  activeDeliveries: [{
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    assignedAt: Date,
    pickupConfirmedAt: Date,
    deliveredAt: Date,
    status: {
      type: String,
      enum: ['assigned', 'pickup_confirmed', 'in_transit', 'delivered'],
      default: 'assigned'
    },
    cashCollected: Number,
    notes: String
  }],
  deliveryStats: {
    totalDeliveries: {
      type: Number,
      default: 0
    },
    successfulDeliveries: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    totalEarnings: {
      type: Number,
      default: 0
    }
  },
  bankDetails: {
    accountName: String,
    accountNumber: String,
    bankName: String,
    mobileMoneyNumber: String,
    mobileMoneyProvider: {
      type: String,
      enum: ['MTN', 'Airtel', 'Vodafone', 'Other']
    }
  },
  documents: {
    nationalId: {
      number: String,
      imageUrl: String,
      verified: {
        type: Boolean,
        default: false
      }
    },
    drivingLicense: {
      number: String,
      imageUrl: String,
      expiryDate: Date,
      verified: {
        type: Boolean,
        default: false
      }
    }
  },
  profilePicture: String,
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationDate: Date,
  lastLogin: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
deliveryPersonSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Methods for driver operations
deliveryPersonSchema.methods.generateOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = {
    code: otp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    attempts: 0,
    lastAttemptAt: new Date()
  };
  return otp;
};

deliveryPersonSchema.methods.verifyOTP = function(code) {
  if (!this.otp || !this.otp.code) return false;
  if (new Date() > this.otp.expiresAt) return false;
  if (this.otp.attempts >= 5) return false;
  
  this.otp.attempts += 1;
  this.otp.lastAttemptAt = new Date();
  
  if (this.otp.code === code) {
    this.otp = undefined;
    return true;
  }
  return false;
};

deliveryPersonSchema.methods.canCollectCash = function(amount) {
  return (this.cashManagement.currentCashBalance + amount) <= this.cashManagement.cashLimit;
};

deliveryPersonSchema.methods.recordCashCollection = function(amount, orderId) {
  this.cashManagement.currentCashBalance += amount;
  this.cashManagement.totalCollected += amount;
  
  // Update active delivery
  const delivery = this.activeDeliveries.find(d => d.orderId.toString() === orderId.toString());
  if (delivery) {
    delivery.cashCollected = amount;
  }
};

deliveryPersonSchema.methods.recordDeposit = function(depositData) {
  this.cashManagement.deposits.push(depositData);
  this.cashManagement.currentCashBalance -= depositData.amount;
  this.cashManagement.totalDeposited += depositData.amount;
  this.cashManagement.lastDepositAt = new Date();
};

// Index for geospatial queries
deliveryPersonSchema.index({ 'currentLocation.coordinates': '2dsphere' });

// Index for efficient queries
deliveryPersonSchema.index({ email: 1 });
deliveryPersonSchema.index({ phoneNumber: 1 });
deliveryPersonSchema.index({ isActive: 1 });
deliveryPersonSchema.index({ isVerified: 1 });

const DeliveryPerson = mongoose.model('DeliveryPerson', deliveryPersonSchema);

module.exports = DeliveryPerson;
