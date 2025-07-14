const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getOrCreateConversation,
  sendMessage,
  getMessages,
  getConversations,
  archiveConversation,
  getAllConversations
} = require('../controllers/messageController');

// Get or create conversation for an order
router.get('/conversations/order/:orderId', verifyToken, getOrCreateConversation);

// Get all conversations for user
router.get('/conversations', verifyToken, getConversations);

// Get messages in a conversation
router.get('/conversations/:conversationId/messages', verifyToken, getMessages);

// Send a message in a conversation
router.post('/conversations/:conversationId/messages', verifyToken, sendMessage);

// Archive a conversation
router.patch('/conversations/:conversationId/archive', verifyToken, archiveConversation);

// Admin: Get all conversations
router.get('/admin/conversations', verifyToken, getAllConversations);

module.exports = router; 