const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Order = require('../models/Order');
const { sendEmail } = require('../utils/emailService');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/attachments/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
}).array('attachments', 5); // Max 5 files

// Get or create conversation for an order
exports.getOrCreateConversation = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Find the order and verify access
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Verify user is either buyer or vendor
    if (order.buyer.toString() !== req.user._id.toString() &&
        order.vendor.toString() !== req.user._id.toString() &&
        !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Find existing conversation or create new one
    let conversation = await Conversation.findOne({ order: orderId })
      .populate('participants', 'name email')
      .populate('lastMessage');

    if (!conversation) {
      conversation = new Conversation({
        order: orderId,
        participants: [order.buyer, order.vendor],
        unreadCount: new Map([
          [order.buyer.toString(), 0],
          [order.vendor.toString(), 0]
        ])
      });
      await conversation.save();
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Send a message
exports.sendMessage = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      const { conversationId } = req.params;
      const { content } = req.body;

      const conversation = await Conversation.findById(conversationId)
        .populate('participants', 'email name')
        .populate('order');

      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      // Verify sender is a participant or admin
      if (!conversation.participants.some(p => p._id.toString() === req.user._id.toString()) &&
          !req.user.isAdmin) {
        return res.status(403).json({ message: 'Not authorized' });
      }

      // Create message
      const message = new Message({
        conversation: conversationId,
        sender: req.user._id,
        content,
        isAdminMessage: req.user.isAdmin,
        attachments: req.files ? req.files.map(file => ({
          filename: file.originalname,
          path: file.path,
          mimetype: file.mimetype
        })) : []
      });

      await message.save();

      // Update conversation
      conversation.lastMessage = message._id;
      conversation.adminInvolved = conversation.adminInvolved || req.user.isAdmin;

      // Update unread counts for other participants
      conversation.participants.forEach(participant => {
        if (participant._id.toString() !== req.user._id.toString()) {
          const currentCount = conversation.unreadCount.get(participant._id.toString()) || 0;
          conversation.unreadCount.set(participant._id.toString(), currentCount + 1);
        }
      });

      await conversation.save();

      // Send email notifications
      const otherParticipants = conversation.participants.filter(
        p => p._id.toString() !== req.user._id.toString()
      );

      for (const participant of otherParticipants) {
        await sendEmail(
          participant.email,
          'New Message Received',
          `You have received a new message regarding order ${conversation.order.title}.\n\nMessage: ${content}`
        );
      }

      res.status(201).json(message);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });
};

// Get messages for a conversation
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Verify user is a participant or admin
    if (!conversation.participants.includes(req.user._id) && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const messages = await Message.find({ conversation: conversationId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('sender', 'name email');

    // Mark messages as read
    await Message.updateMany(
      {
        conversation: conversationId,
        'readBy.user': { $ne: req.user._id }
      },
      {
        $push: {
          readBy: {
            user: req.user._id,
            readAt: new Date()
          }
        }
      }
    );

    // Reset unread count for this user
    conversation.unreadCount.set(req.user._id.toString(), 0);
    await conversation.save();

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all conversations for a user
exports.getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id,
      isArchived: false
    })
      .populate('participants', 'name email')
      .populate('lastMessage')
      .populate('order')
      .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Archive conversation
exports.archiveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Verify user is a participant or admin
    if (!conversation.participants.includes(req.user._id) && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    conversation.isArchived = true;
    await conversation.save();

    res.json({ message: 'Conversation archived' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: Get all conversations
exports.getAllConversations = async (req, res) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const conversations = await Conversation.find()
      .populate('participants', 'name email')
      .populate('lastMessage')
      .populate('order')
      .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 