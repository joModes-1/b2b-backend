const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { sendEmail } = require('../utils/emailService');

/**
 * Confirm delivery by scanning QR code
 * POST /api/delivery/confirm
 * Body: { orderId, token, deliveryPersonId? }
 */
router.post('/confirm', async (req, res) => {
  try {
    const { orderId, token, deliveryPersonId } = req.body;

    if (!orderId || !token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order ID and delivery token are required' 
      });
    }

    // Find order with matching delivery token
    const order = await Order.findById(orderId)
      .populate('buyer', 'name email')
      .populate('seller', 'name email');

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Verify delivery token
    if (!order.deliveryConfirmation || order.deliveryConfirmation.deliveryToken !== token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid delivery token' 
      });
    }

    // Check if already delivered
    if (order.status === 'delivered') {
      return res.status(200).json({ 
        success: true, 
        message: 'Order already marked as delivered',
        order: {
          orderNumber: order.orderNumber,
          status: order.status,
          deliveredAt: order.deliveryConfirmation.confirmedAt
        }
      });
    }

    // Check if order is in a deliverable state
    if (!['confirmed', 'processing', 'shipped'].includes(order.status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Order cannot be delivered. Current status: ${order.status}` 
      });
    }

    // Update order status to delivered
    order.updateStatus('delivered', 'Delivery confirmed via QR scan', deliveryPersonId || 'delivery-person');
    
    // Update delivery confirmation
    order.deliveryConfirmation.confirmedAt = new Date();
    order.deliveryConfirmation.confirmedBy = deliveryPersonId || 'delivery-person';

    await order.save();

    // Send email notifications
    try {
      if (order.buyer && order.buyer.email) {
        await sendEmail(
          order.buyer.email,
          `Order ${order.orderNumber} Delivered`,
          `Your order has been successfully delivered! Thank you for your business.`
        );
      }

      if (order.seller && order.seller.email) {
        await sendEmail(
          order.seller.email,
          `Order ${order.orderNumber} Delivered`,
          `Order ${order.orderNumber} has been successfully delivered to the customer.`
        );
      }
    } catch (emailError) {
      console.error('Email notification error (delivery):', emailError);
      // Don't fail the delivery confirmation due to email issues
    }

    res.json({
      success: true,
      message: 'Delivery confirmed successfully',
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        deliveredAt: order.deliveryConfirmation.confirmedAt,
        buyer: {
          name: order.buyer.name
        }
      }
    });

  } catch (error) {
    console.error('Delivery confirmation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to confirm delivery', 
      error: error.message 
    });
  }
});

/**
 * Get delivery details by scanning QR (for verification before confirming)
 * GET /api/delivery/details?orderId=xxx&token=xxx
 */
router.get('/details', async (req, res) => {
  try {
    const { orderId, token } = req.query;

    if (!orderId || !token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order ID and delivery token are required' 
      });
    }

    const order = await Order.findById(orderId)
      .populate('buyer', 'name')
      .populate('seller', 'name')
      .select('orderNumber status totalAmount shippingAddress deliveryConfirmation estimatedDeliveryDate');

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Verify delivery token
    if (!order.deliveryConfirmation || order.deliveryConfirmation.deliveryToken !== token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid delivery token' 
      });
    }

    res.json({
      success: true,
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: order.totalAmount,
        buyer: {
          name: order.buyer.name
        },
        seller: {
          name: order.seller.name
        },
        shippingAddress: order.shippingAddress,
        estimatedDeliveryDate: order.estimatedDeliveryDate,
        alreadyDelivered: order.status === 'delivered',
        deliveredAt: order.deliveryConfirmation.confirmedAt
      }
    });

  } catch (error) {
    console.error('Get delivery details error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get delivery details', 
      error: error.message 
    });
  }
});

module.exports = router;
