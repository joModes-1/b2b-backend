const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { generateDeliveryQR } = require('../utils/qrGenerator');
const { verifyToken } = require('../middleware/auth');

/**
 * Generate QR code for existing order
 * POST /api/qr/generate/:orderId
 */
router.post('/generate/:orderId', verifyToken, async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await Order.findById(orderId).populate('buyer', 'firebaseUid');
    
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Check if user is authorized (buyer of the order)
    const isBuyer = order.buyer && order.buyer.firebaseUid === req.user.firebaseUid;
    if (!isBuyer && !req.user.isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to generate QR code for this order' 
      });
    }

    // Generate QR code if it doesn't exist or regenerate if requested
    if (!order.deliveryConfirmation || !order.deliveryConfirmation.qrCode) {
      try {
        const qrData = await generateDeliveryQR(order._id.toString());
        order.deliveryConfirmation = {
          qrCode: qrData.qrCode,
          deliveryToken: qrData.deliveryToken,
          deliveryUrl: qrData.deliveryUrl
        };
        await order.save();
      } catch (qrError) {
        console.error('QR code generation error:', qrError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to generate QR code' 
        });
      }
    }

    res.json({
      success: true,
      message: 'QR code generated successfully',
      deliveryConfirmation: order.deliveryConfirmation
    });

  } catch (error) {
    console.error('Generate QR code error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate QR code', 
      error: error.message 
    });
  }
});

module.exports = router;
