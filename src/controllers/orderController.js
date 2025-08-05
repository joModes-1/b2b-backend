const User = require('../models/User');
const Order = require('../models/Order');
const { sendEmail } = require('../utils/emailService');

// Create a new order
exports.createOrder = async (req, res) => {
  console.log('--- Executing updated createOrder function ---');
  try {
    console.log('Request user (from Firebase token):', req.user);
    // The user object from verifyToken is the full user profile from our database.
    const buyer = req.user;
    console.log('Found buyer in database:', buyer);

    if (!buyer) {
      console.error('Aborting: Buyer could not be found in the database.');
      return res.status(404).json({ message: 'Buyer account not found.' });
    }

    const {
      seller,
      items,
      shippingInfo,
      shippingMethod,
      notes,
      saveAddress,
    } = req.body;

    const shippingAddressForOrder = {
      fullName: shippingInfo.fullName,
      street: shippingInfo.address,
      city: shippingInfo.city,
      state: shippingInfo.state,
      zipCode: shippingInfo.zipCode,
      country: shippingInfo.country,
      phone: shippingInfo.phone,
    };

    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const tax = subtotal * 0.1;
    const shippingCost = shippingMethod === 'express' ? 20 : shippingMethod === 'priority' ? 30 : 10;
    const totalAmount = subtotal + tax + shippingCost;

    const order = new Order({
      buyer: buyer._id, // Use the MongoDB _id of the buyer
      seller,
      items: items.map(item => ({ ...item, subtotal: item.quantity * item.unitPrice })),
      subtotal,
      tax,
      shippingCost,
      totalAmount,
      shippingAddress: shippingAddressForOrder,
      shippingMethod,
      notes,
      estimatedDeliveryDate: calculateEstimatedDelivery(shippingMethod),
    });

    await order.save();

    if (saveAddress) {
      const userAddress = {
        street: shippingInfo.address,
        city: shippingInfo.city,
        state: shippingInfo.state,
        zipCode: shippingInfo.zipCode,
        country: shippingInfo.country,
      };
      // Update the user's address using their MongoDB _id
      await User.findByIdAndUpdate(buyer._id, { address: userAddress });
    }

    await order.populate('seller', 'email');
    await order.populate('buyer', 'name email');

    // Send email notifications. This is wrapped in a try-catch so that a
    // failure in the email service does not prevent the order from being created.
    try {
      if (order.seller && order.seller.email) {
        await sendEmail(
          order.seller.email,
          'New Order Received',
          `You have received a new order (${order.orderNumber}) worth $${totalAmount}`
        );
      }

      if (order.buyer && order.buyer.email) {
        await sendEmail(
          order.buyer.email,
          'Order Confirmation',
          `Your order (${order.orderNumber}) has been placed successfully`
        );
      }
    } catch (emailError) {
      console.error('--- Email Service Error ---');
      console.error('The order was created successfully, but confirmation emails could not be sent.');
      console.error('Please check your email provider credentials in the .env file.');
      console.error('Error Details:', emailError.message);
      console.error('--- End Email Service Error ---');
    }

    res.status(201).json(order);
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(400).json({ message: 'Failed to create order. ' + error.message });
  }
};

// Get all orders for buyer
exports.getBuyerOrders = async (req, res) => {
  try {
    const orders = await Order.find({ 'buyer.firebaseUid': req.user.firebaseUid })
      .populate('seller', 'name email')
      .populate('items.listing')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all orders for vendor
exports.getVendorOrders = async (req, res) => {
  try {
    const orders = await Order.find({ 'seller.firebaseUid': req.user.firebaseUid })
      .populate('buyer', 'name email')
      .populate('items.listing')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get single order
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'name email')
      .populate('seller', 'name email')
      .populate('items.listing')
      .populate('statusHistory.updatedBy', 'name');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to view this order
    if (order.buyer.firebaseUid !== req.user.firebaseUid &&
        order.seller.firebaseUid !== req.user.firebaseUid &&
        !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update order status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'email')
      .populate('seller', 'email');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to update this order (seller or admin only)
    if (order.seller.firebaseUid !== req.user.firebaseUid && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Update status
    order.updateStatus(status, note, req.user);

    // Add tracking number if provided
    if (req.body.trackingNumber) {
      order.trackingNumber = req.body.trackingNumber;
    }

    await order.save();

    // Send email notifications
    const statusMessage = getStatusMessage(status);
    await sendEmail(
      order.buyer.email,
      `Order ${order.orderNumber} Status Update`,
      `Your order status has been updated to ${status}. ${statusMessage}`
    );

    res.json(order);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Confirm payment
exports.confirmPayment = async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId) {
        return res.status(400).json({ message: 'Transaction ID is required.' });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Verify the user is the buyer of the order
    if (order.buyer.firebaseUid !== req.user.firebaseUid) {
      return res.status(403).json({ message: 'You are not authorized to confirm this order.' });
    }

    // Update order status and add payment details
    order.paymentDetails = {
      paymentId: transactionId,
      paymentStatus: 'Confirmed',
      paymentDate: new Date(),
    };
    order.updateStatus('confirmed', 'Payment confirmed via Flutterwave', req.user);
    
    await order.save();
    
    await order.populate('buyer', 'email');
    await order.populate('seller', 'email');

    // Send email notifications in a try-catch block
     try {
      if (order.seller && order.seller.email) {
        await sendEmail(
          order.seller.email,
          `Payment Confirmed for Order #${order.orderNumber}`,
          `Payment has been confirmed for order ${order.orderNumber}.`
        );
      }

      if (order.buyer && order.buyer.email) {
        await sendEmail(
          order.buyer.email,
          `Payment Confirmation for Order #${order.orderNumber}`,
          `Your payment for order (${order.orderNumber}) has been confirmed successfully.`
        );
      }
    } catch (emailError) {
      console.error('--- Email Service Error on Payment Confirmation ---');
      console.error('The payment was confirmed, but notification emails could not be sent.');
      console.error('Error Details:', emailError.message);
    }

    res.status(200).json({ message: 'Payment confirmed successfully', order });

  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ message: 'Failed to confirm payment', error: error.message });
  }
};

// Cancel order
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'email')
      .populate('seller', 'email');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Only allow cancellation if order is pending or confirmed
    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ message: 'Order cannot be cancelled at this stage' });
    }

    // Verify user is either buyer or vendor
    if (order.buyer.firebaseUid !== req.user.firebaseUid &&
        order.seller.firebaseUid !== req.user.firebaseUid &&
        !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    order.updateStatus('cancelled', req.body.note || 'Order cancelled', req.user);
    await order.save();

    // Send email notifications
    await sendEmail(
      order.buyer.email,
      `Order ${order.orderNumber} Cancelled`,
      'Your order has been cancelled.'
    );

    await sendEmail(
      order.seller.email,
      `Order ${order.orderNumber} Cancelled`,
      'An order has been cancelled.'
    );

    res.json(order);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Helper function to calculate estimated delivery date
const calculateEstimatedDelivery = (shippingMethod) => {
  const date = new Date();
  switch (shippingMethod) {
    case 'express':
      date.setDate(date.getDate() + 3);
      break;
    case 'priority':
      date.setDate(date.getDate() + 2);
      break;
    default:
      date.setDate(date.getDate() + 5);
  }
  return date;
};

// Helper function to get status message
const getStatusMessage = (status) => {
  const messages = {
    pending: 'Order is pending confirmation',
    confirmed: 'Payment confirmed, order being processed',
    shipped: 'Order has been shipped',
    delivered: 'Order has been delivered',
    cancelled: 'Order has been cancelled',
    completed: 'Order completed successfully',
    returned: 'Order has been returned',
  };
  return messages[status] || 'Order status updated';
};

// Initiate payment
const initiatePayment = async (req, res) => {
  try {
    const { paymentMethod } = req.body;
    const order = await Order.findById(req.params.id).populate('buyer');
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to initiate payment for this order
    if (order.buyer.firebaseUid !== req.user.firebaseUid) {
      return res.status(403).json({ message: 'You are not authorized to initiate payment for this order.' });
    }

    const paymentService = require('../services/paymentService');
    
    let paymentData;
    switch (paymentMethod) {
      case 'stripe':
        paymentData = await paymentService.createStripeSession(order);
        break;
      case 'paypal':
        paymentData = await paymentService.createPayPalOrder(order);
        break;
      case 'flutterwave':
        paymentData = await paymentService.createFlutterwavePayment(order, order.buyer);
        break;
      default:
        return res.status(400).json({ message: 'Invalid payment method' });
    }

    res.json(paymentData);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Verify payment
const verifyPayment = async (req, res) => {
  try {
    const { paymentMethod, transactionId } = req.body;
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to verify payment for this order
    if (order.buyer.firebaseUid !== req.user.firebaseUid) {
      return res.status(403).json({ message: 'You are not authorized to verify payment for this order.' });
    }

    const paymentService = require('../services/paymentService');
    
    let paymentVerification;
    switch (paymentMethod) {
      case 'stripe':
        paymentVerification = await paymentService.verifyStripePayment(transactionId);
        break;
      case 'paypal':
        paymentVerification = await paymentService.verifyPayPalPayment(transactionId);
        break;
      case 'flutterwave':
        paymentVerification = await paymentService.verifyFlutterwavePayment(transactionId);
        break;
      default:
        return res.status(400).json({ message: 'Invalid payment method' });
    }

    if (paymentVerification.success) {
      order.paymentMethod = paymentMethod;
      order.paymentDetails = {
        paymentId: transactionId,
        paymentStatus: 'Confirmed',
        paymentDate: new Date(),
      };
      order.updateStatus('confirmed', 'Payment confirmed', req.user._id);
      await order.save();
      
      await order.populate('buyer', 'email');
      await order.populate('seller', 'email');

      // Send email notifications
      try {
        if (order.seller && order.seller.email) {
          await sendEmail(
            order.seller.email,
            `Payment Confirmed for Order #${order.orderNumber}`,
            `Payment has been confirmed for order ${order.orderNumber}.`
          );
        }

        if (order.buyer && order.buyer.email) {
          await sendEmail(
            order.buyer.email,
            `Payment Confirmed for Order #${order.orderNumber}`,
            `Your payment has been confirmed for order ${order.orderNumber}.`
          );
        }
      } catch (emailError) {
        console.error('Email notification error:', emailError);
        // Don't throw error as payment verification should not fail due to email issues
      }

      res.json({ success: true, message: 'Payment verified successfully', order });
    } else {
      res.status(400).json({ success: false, message: 'Payment verification failed' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getOrder,
  updateOrderStatus,
  confirmPayment,
  cancelOrder,
  initiatePayment,
  verifyPayment,
  calculateEstimatedDelivery,
  getStatusMessage
};