const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  unreadCount: {
    type: Map,
    of: Number,
    default: new Map()
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  adminInvolved: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Add indexes for frequent queries
conversationSchema.index({ order: 1 });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ 'unreadCount.userId': 1 });

module.exports = mongoose.model('Conversation', conversationSchema); 