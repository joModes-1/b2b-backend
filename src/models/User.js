const mongoose = require('mongoose');
const validator = require('validator');

const userSchema = new mongoose.Schema({
  firebaseUid: {
    type: String,
    required: true,
    unique: true
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
    enum: ['buyer', 'seller', 'admin'],
    default: 'buyer'
  },
  profilePicture: {
    type: String
  },
  emailVerified: {
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
  }
}, {
  timestamps: true
});

// Ensure sparse unique index for phoneNumber to allow multiple docs without this field
userSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

// Remove password when converting to JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  return obj;
};

// Update the updatedAt timestamp before saving
userSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const User = mongoose.model('User', userSchema);

module.exports = User; 