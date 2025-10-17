const mongoose = require('mongoose');
const validator = require('validator');

const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: false,  // Made optional to support backend-only auth for delivery personnel
    unique: true,
    sparse: true  // Allow multiple docs without this field
  },
  password: {
    type: String,
    required: false  // Optional, used for delivery personnel backend auth
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email']
  },
  phoneNumber: {
    type: String,
    required: false, // allow missing phone for Google Sign-In; prompt later
    unique: true,
    sparse: true, // allow multiple docs without this field set
    validate: {
      validator: function(v) {
        // Validate only when provided
        if (!v) return true;
        // Basic phone number validation (adjust regex as needed)
        return /^\+?[1-9]\d{1,14}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  phoneVerified: {
    type: Boolean,
    default: false
  },
  phoneVerificationCode: String,
  phoneVerificationExpires: Date,
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['buyer', 'seller', 'admin', 'delivery'],  // Added 'delivery' role
    default: 'buyer'
  },
  profilePicture: {
    type: String
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  verified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Business location fields for sellers (optional for buyers)
  businessLocation: {
    address: {
      type: String,
      required: false  // Make optional to avoid validation errors
    },
    city: {
      type: String,
      required: false  // Make optional to avoid validation errors
    },
    state: {
      type: String,
      required: false
    },
    country: {
      type: String,
      required: false  // Make optional to avoid validation errors
    },
    postalCode: {
      type: String,
      required: false
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: false,  // Make optional to avoid validation errors
        index: '2dsphere'
      }
    },
    placeId: {
      type: String,
      required: false
    },
    formattedAddress: {
      type: String,
      required: false
    }
  },
  // Delivery address for buyers
  deliveryAddress: {
    address: {
      type: String,
      required: false  // Make optional to avoid validation errors
    },
    city: {
      type: String,
      required: false  // Make optional to avoid validation errors
    },
    state: {
      type: String,
      required: false
    },
    country: {
      type: String,
      required: false  // Make optional to avoid validation errors
    },
    postalCode: {
      type: String,
      required: false
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: false,  // Make optional to avoid validation errors
        index: '2dsphere'
      }
    },
    placeId: {
      type: String,
      required: false
    },
    formattedAddress: {
      type: String,
      required: false
    },
    isDefault: {
      type: Boolean,
      default: true
    }
  },
  // Additional delivery addresses for buyers
  additionalAddresses: [{
    nickname: {
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
      required: false
    },
    country: {
      type: String,
      required: true
    },
    postalCode: {
      type: String,
      required: false
    },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
        index: '2dsphere'
      }
    },
    placeId: {
      type: String,
      required: false
    },
    formattedAddress: {
      type: String,
      required: false
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  }],
  locationVerified: {
    type: Boolean,
    default: false
  },
  // Delivery personnel specific fields
  deliveryInfo: {
    vehicleType: {
      type: String,
      enum: ['motorcycle', 'car', 'van', 'truck', 'bicycle', 'walking'],
      default: 'motorcycle'
    },
    vehicleNumber: String,
    licenseNumber: String,
    zone: String,
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    completedDeliveries: {
      type: Number,
      default: 0
    },
    isAvailable: {
      type: Boolean,
      default: true
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: false
      }
    },
    lastLocationUpdate: Date
  }
}, {
  timestamps: true
});

// Ensure sparse unique index for phoneNumber to allow multiple docs without this field
userSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

// Add sparse geospatial indexes for location-based queries (sparse allows null/missing values)
userSchema.index({ 'businessLocation.coordinates': '2dsphere' }, { sparse: true });
userSchema.index({ 'deliveryAddress.coordinates': '2dsphere' }, { sparse: true });
userSchema.index({ 'additionalAddresses.coordinates': '2dsphere' }, { sparse: true });

// Remove password when converting to JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  return obj;
};

// Sanitize location fields before validation to avoid invalid GeoJSON in indexes
userSchema.pre('validate', function(next) {
  // Helper: ensure a location object has valid GeoJSON coordinates
  const isValidGeo = (loc) => {
    if (!loc || !loc.coordinates) return false;
    const t = loc.coordinates.type;
    const coords = loc.coordinates.coordinates;
    return (
      t === 'Point' &&
      Array.isArray(coords) &&
      coords.length === 2 &&
      typeof coords[0] === 'number' &&
      typeof coords[1] === 'number' &&
      !Number.isNaN(coords[0]) &&
      !Number.isNaN(coords[1])
    );
  };

  // Buyers should never persist businessLocation
  if (this.role === 'buyer') {
    this.businessLocation = undefined;
  } else {
    // For non-buyers, drop if incomplete
    if (!isValidGeo(this.businessLocation)) {
      this.businessLocation = undefined;
    }
  }

  // Drop deliveryAddress if incomplete to avoid index extraction errors
  if (!isValidGeo(this.deliveryAddress)) {
    this.deliveryAddress = undefined;
  }

  // Filter additionalAddresses to only keep valid ones
  if (Array.isArray(this.additionalAddresses)) {
    this.additionalAddresses = this.additionalAddresses.filter(addr => isValidGeo(addr));
  }

  next();
});

// Update the updatedAt timestamp before saving
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Remove businessLocation for buyers to prevent geospatial index issues
  if (this.role === 'buyer' && this.businessLocation) {
    this.businessLocation = undefined;
  }
  
  next();
});

const User = mongoose.model('User', userSchema);

module.exports = User; 