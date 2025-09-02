const mongoose = require('mongoose');

const presetImageSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    trim: true
  },
  subcategory: {
    type: String,
    required: true,
    trim: true
  },
  url: {
    type: String,
    required: true
  },
  public_id: {
    type: String
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  tags: {
    type: [String],
    default: []
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  }
}, { 
  timestamps: true 
});

// Add text index for name and tags fields to enable text search
presetImageSchema.index({ name: 'text', tags: 'text' });

module.exports = mongoose.model('PresetImage', presetImageSchema);
