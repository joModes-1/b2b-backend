const User = require('../models/User');
const Order = require('../models/Order');
const { sendEmail } = require('../utils/emailService');
const { generateDeliveryQR } = require('../utils/qrGenerator');
// Simple in-memory throttle to avoid repeated verify-payment hits within a short window
const verifyThrottle = new Map(); // key: `${orderId}:${transactionId || 'none'}` -> timestamp
const VERIFY_THROTTLE_MS = 4000;

// Haversine formula to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return distance; // Distance in kilometers
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

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

    let {
      seller,
      items,
      shippingInfo,
      shippingMethod,
      notes,
      saveAddress,
      paymentMethod,
    } = req.body;

    // Derive seller if not provided at top level
    if (!seller && Array.isArray(items) && items.length > 0) {
      const first = items[0];
      seller = first?.seller?._id || first?.seller || seller;
    }
    
    // If seller is still not provided, use the current user as seller if they're a seller
    if (!seller && req.user.role === 'seller') {
      seller = req.user._id;
    }
    
    if (!seller) {
      return res.status(400).json({ message: 'Seller is required for creating an order.' });
    }

    const shippingAddressForOrder = {
      fullName: shippingInfo.fullName,
      street: shippingInfo.address,
      city: shippingInfo.city,
      state: shippingInfo.state,
      zipCode: shippingInfo.zipCode,
      country: shippingInfo.country,
      phone: shippingInfo.phone,
    };

    // Normalize items to expected schema: listing, quantity, unitPrice
    const normalizedItems = (Array.isArray(items) ? items : []).map((item) => {
      const listing = item.listing || item.product || item._id;
      const unitPrice = item.unitPrice != null ? item.unitPrice : item.price;
      const quantity = item.quantity != null ? item.quantity : 1;
      
      // Ensure listing is provided
      if (!listing) {
        throw new Error('Each item must have a listing ID');
      }
      
      return {
        listing,
        quantity,
        unitPrice,
        subtotal: Number(quantity) * Number(unitPrice || 0),
      };
    });

    // Basic validation after normalization
    if (!normalizedItems.length || normalizedItems.some(i => !i.listing)) {
      return res.status(400).json({ message: 'At least one item with a valid listing is required.' });
    }

    const subtotal = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const tax = 0; // No tax for COD
    
    // Calculate distance-based shipping cost
    let shippingCost = 0;
    try {
      // Get seller's location
      const sellerUser = await User.findById(seller);
      const sellerLocation = sellerUser?.businessLocation?.coordinates?.coordinates; // [lng, lat]
      const buyerLocation = shippingInfo.coordinates; // Should be [lng, lat] from frontend
      
      if (sellerLocation && buyerLocation && 
          Array.isArray(sellerLocation) && sellerLocation.length === 2 &&
          Array.isArray(buyerLocation) && buyerLocation.length === 2) {
        // Calculate distance using Haversine formula
        const distance = calculateDistance(
          sellerLocation[1], sellerLocation[0], // lat, lng
          buyerLocation[1], buyerLocation[0]    // lat, lng
        );
        
        // Calculate shipping cost based on distance
        // Base rate: 5000 UGX for first 5km, then 1000 UGX per additional km
        const baseRate = 5000;
        const perKmRate = 1000;
        const freeKm = 5;
        
        if (distance <= freeKm) {
          shippingCost = baseRate;
        } else {
          shippingCost = baseRate + Math.ceil(distance - freeKm) * perKmRate;
        }
        
        console.log(`Distance: ${distance.toFixed(2)}km, Shipping cost: ${shippingCost} UGX`);
      } else {
        // Default shipping cost if locations not available
        shippingCost = 5000;
        console.log('Using default shipping cost - location data incomplete');
      }
    } catch (error) {
      console.error('Error calculating shipping cost:', error);
      shippingCost = 5000; // Default fallback
    }
    
    const totalAmount = subtotal + tax + shippingCost;

    const order = new Order({
      buyer: buyer._id, // Use the MongoDB _id of the buyer
      seller,
      items: normalizedItems,
      subtotal,
      tax,
      shippingCost,
      totalAmount,
      shippingAddress: shippingAddressForOrder,
      shippingMethod,
      // Persist what the buyer selected. For MTN/Airtel we keep their choice; verification may later normalize to 'pesapal'.
      paymentMethod: paymentMethod || null,
      notes,
      estimatedDeliveryDate: calculateEstimatedDelivery(shippingMethod),
    });
    

    await order.save();

    // Generate QR code for delivery confirmation
    try {
      const qrData = await generateDeliveryQR(order._id.toString());
      order.deliveryConfirmation = {
        qrCode: qrData.qrCode,
        deliveryToken: qrData.deliveryToken,
        deliveryUrl: qrData.deliveryUrl,
        qrPayload: qrData.qrPayload
      };
      await order.save();
    } catch (qrError) {
      console.error('QR code generation error:', qrError);
      // Don't fail order creation if QR generation fails
    }

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
      const method = (order.paymentMethod || '').toLowerCase();
      const isMobileMoney = method === 'pesapal' || method === 'mtn' || method === 'airtel';

      // For mobile money, do NOT notify the seller at creation time.
      // Seller will be notified after payment verification in verifyPayment().
      if (!isMobileMoney) {
        if (order.seller && order.seller.email) {
          const paymentMethodDisplay = {
            'cod': 'Cash on Delivery',
            'paypal': 'PayPal',
            'stripe': 'Stripe (Card)',
            'pesapal': 'Pesapal (Mobile Money)',
            'mtn': 'MTN Mobile Money',
            'airtel': 'Airtel Money'
          };
          const methodName = paymentMethodDisplay[method] || method || 'Not specified';
          
          await sendEmail(
            order.seller.email,
            'New Order Received',
            `You have received a new order (${order.orderNumber}) worth $${totalAmount}. Payment method: ${methodName}`
          );
        }
      }

      // For mobile money, also do NOT email the buyer at creation time.
      if (!isMobileMoney) {
        if (order.buyer && order.buyer.email) {
          await sendEmail(
            order.buyer.email,
            'Order Confirmation',
            `Your order (${order.orderNumber}) has been placed successfully`
          );
        }
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
    // Orders store buyer as ObjectId (see createOrder), so match by ObjectId
    const buyerId = req.user && req.user._id;
    if (!buyerId) {
      return res.status(400).json({ message: 'Unable to resolve buyer id from token' });
    }
    const orders = await Order.find({ buyer: buyerId })
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
      .populate('buyer', 'name email phone phoneNumber')
      .populate('seller', 'name email')
      .populate({
        path: 'items.listing',
        select: 'name title images image thumbnail mainImage price',
      })
      .populate('statusHistory.updatedBy', 'name');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Debug logging
    console.log('Current user firebaseUid:', req.user.firebaseUid);
    console.log('Order buyer:', order.buyer);
    console.log('Order seller:', order.seller);
    
    // Check if user is authorized to view this order
    const isBuyer = order.buyer && (order.buyer.firebaseUid === req.user.firebaseUid || order.buyer._id.toString() === req.user._id?.toString());
    const isSeller = order.seller && (order.seller.firebaseUid === req.user.firebaseUid || order.seller._id?.toString() === req.user._id?.toString());
    
    if (!isBuyer && !isSeller && !req.user.isAdmin) {
      console.log('Authorization failed - user not buyer, seller, or admin');
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Ensure QR code exists (self-healing for legacy/missed generation)
    try {
      if (!order.deliveryConfirmation || !order.deliveryConfirmation.qrCode) {
        const qrData = await generateDeliveryQR(order._id.toString());
        order.deliveryConfirmation = {
          qrCode: qrData.qrCode,
          deliveryToken: qrData.deliveryToken,
          deliveryUrl: qrData.deliveryUrl,
          qrPayload: qrData.qrPayload
        };
        await order.save();
      }
    } catch (qrAutoError) {
      console.warn('Auto-generate QR in getOrder failed (non-fatal):', qrAutoError.message);
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
      .populate('buyer', 'email firebaseUid')
      .populate('seller', 'email firebaseUid');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Prevent updates on terminal states
    if (['cancelled', 'delivered', 'refunded'].includes(order.status)) {
      return res.status(400).json({ message: `Order in '${order.status}' state cannot be edited.` });
    }

    // Check if user is authorized to update this order (seller or admin only)
    const isSellerByUid = order.seller && order.seller.firebaseUid && (order.seller.firebaseUid === req.user.firebaseUid);
    const isSellerById = order.seller && order.seller._id && req.user._id && (order.seller._id.toString() === req.user._id.toString());
    if (!isSellerByUid && !isSellerById && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Update status
    order.updateStatus(status, note, req.user._id || req.user);

    // Add tracking number if provided
    if (req.body.trackingNumber) {
      order.trackingNumber = req.body.trackingNumber;
    }

    await order.save();

    // Send email notifications (best-effort)
    try {
      const statusMessage = getStatusMessage(status);
      if (order.buyer && order.buyer.email) {
        await sendEmail(
          order.buyer.email,
          `Order ${order.orderNumber} Status Update`,
          `Your order status has been updated to ${status}. ${statusMessage}`
        );
      }
    } catch (emailErr) {
      // Log and continue
      console.error('Email notification error (status update):', emailErr.message);
    }

    res.json(order);
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Error updating order status', error: error.message });
  }
};

// Confirm payment
exports.confirmPayment = async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId) {
        return res.status(400).json({ message: 'Transaction ID is required.' });
    }

    let order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    // Ensure buyer is populated for auth and downstream usage
    await order.populate('buyer', 'name email phone firebaseUid');

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
        const paymentMethodDisplay = {
          'cod': 'Cash on Delivery',
          'paypal': 'PayPal',
          'stripe': 'Stripe (Card)',
          'pesapal': 'Pesapal (Mobile Money)',
          'mtn': 'MTN Mobile Money',
          'airtel': 'Airtel Money'
        };
        const methodName = paymentMethodDisplay[order.paymentMethod] || order.paymentMethod || 'Not specified';
        
        await sendEmail(
          order.seller.email,
          `Payment Confirmed for Order #${order.orderNumber}`,
          `Payment has been confirmed for order ${order.orderNumber}. Payment method: ${methodName}. Total amount: $${order.totalAmount}`
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
      .populate('buyer', 'email firebaseUid')
      .populate('seller', 'email firebaseUid');

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Only allow cancellation if order is pending or confirmed
    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ message: 'Order cannot be cancelled at this stage' });
    }

    // Verify user is either buyer, seller, or admin
    const isBuyerByUid = order.buyer && order.buyer.firebaseUid && (order.buyer.firebaseUid === req.user.firebaseUid);
    const isBuyerById = order.buyer && order.buyer._id && req.user._id && (order.buyer._id.toString() === req.user._id.toString());
    const isSellerByUid = order.seller && order.seller.firebaseUid && (order.seller.firebaseUid === req.user.firebaseUid);
    const isSellerById = order.seller && order.seller._id && req.user._id && (order.seller._id.toString() === req.user._id.toString());
    if (!isBuyerByUid && !isBuyerById && !isSellerByUid && !isSellerById && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    order.updateStatus('cancelled', req.body.note || 'Order cancelled', req.user._id || req.user);
    await order.save();

    // Send email notifications (best-effort)
    try {
      if (order.buyer && order.buyer.email) {
        await sendEmail(
          order.buyer.email,
          `Order ${order.orderNumber} Cancelled`,
          'Your order has been cancelled.'
        );
      }
      if (order.seller && order.seller.email) {
        await sendEmail(
          order.seller.email,
          `Order ${order.orderNumber} Cancelled`,
          'An order has been cancelled.'
        );
      }
    } catch (emailErr) {
      console.error('Email notification error (cancel):', emailErr.message);
    }

    res.json(order);
  } catch (error) {
    console.error('Cancel order error:', error);
    return res.status(500).json({ message: 'Error cancelling order', error: error.message });
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
    console.log('initiate-payment request body:', req.body);
    let { paymentMethod } = req.body || {};
    // Be tolerant: default to pesapal if not provided
    if (!paymentMethod || typeof paymentMethod !== 'string' || !paymentMethod.trim()) {
      paymentMethod = 'pesapal';
    }
    // Map legacy values
    if (paymentMethod.toLowerCase() === 'flutterwave') {
      paymentMethod = 'pesapal';
    }
    console.log('initiate-payment derived method:', paymentMethod);

    const order = await Order.findById(req.params.id).populate('buyer');
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if user is authorized to initiate payment for this order
    const buyerId = order.buyer && (order.buyer._id ? order.buyer._id.toString() : order.buyer.toString());
    const requesterId = req.user && req.user._id && req.user._id.toString();
    if (!buyerId || !requesterId || buyerId !== requesterId) {
      return res.status(403).json({ message: 'You are not authorized to initiate payment for this order.' });
    }

    // If already confirmed previously, short-circuit to avoid duplicate emails and logs
    if (order.paymentDetails && String(order.paymentDetails.paymentStatus).toLowerCase() === 'confirmed') {
      return res.json({ success: true, message: 'Payment already confirmed', order });
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
      case 'pesapal':
      case 'mtn':
      case 'airtel': {
        // Prefer user.phoneNumber, then shippingAddress.phone, then any legacy buyer.phone
        const derivedPhone = (order.buyer && (order.buyer.phoneNumber || order.buyer.phone))
          || (order.shippingAddress && order.shippingAddress.phone)
          || undefined;
        const customer = {
          email: order.buyer?.email,
          phone: derivedPhone,
          name: order.buyer?.name,
        };
        console.log('Initiating Pesapal payment with:', {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          amount: order.totalAmount,
          buyer: { email: customer.email, phone: customer.phone, name: customer.name },
          method: paymentMethod
        });
        paymentData = await paymentService.createPesapalPayment(order, customer);
        break;
      }
      default:
        console.warn('initiate-payment invalid paymentMethod:', paymentMethod);
        return res.status(400).json({ message: `Invalid payment method: ${paymentMethod}. Use one of: pesapal, mtn, airtel, stripe, paypal.` });
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
    // If client hasn't provided a transactionId yet (e.g., still redirecting), don't error
    if (!transactionId) {
      return res.status(200).json({ success: false, status: 'PENDING', message: 'Awaiting transaction reference', reason: 'missing_transactionId' });
    }

    // Basic throttle to reduce spam to provider and logs
    const throttleKey = `${req.params.id}:${transactionId}`;
    const lastAt = verifyThrottle.get(throttleKey) || 0;
    const now = Date.now();
    if (now - lastAt < VERIFY_THROTTLE_MS) {
      return res.status(200).json({ success: false, status: 'PENDING', message: 'Verification in progress (throttled)' });
    }
    verifyThrottle.set(throttleKey, now);

    let order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Ensure buyer is populated for auth
    await order.populate('buyer', 'name email phone firebaseUid');

    // Check if user is authorized to verify payment for this order
    const buyerId = order.buyer && (order.buyer._id ? order.buyer._id.toString() : order.buyer.toString());
    const requesterId = req.user && req.user._id && req.user._id.toString();
    if (!buyerId || !requesterId || buyerId !== requesterId) {
      return res.status(403).json({ message: 'You are not authorized to verify payment for this order.' });
    }

    // If already confirmed previously, short-circuit to avoid duplicate emails and logs
    if (order.paymentDetails && String(order.paymentDetails.paymentStatus).toLowerCase() === 'confirmed') {
      return res.json({ success: true, message: 'Payment already confirmed', order });
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
      case 'pesapal':
      case 'mtn':
      case 'airtel':
        paymentVerification = await paymentService.verifyPesapalPayment(transactionId);
        break;
      default:
        return res.status(400).json({ message: 'Invalid payment method' });
    }

    if (paymentVerification.success) {
      // Normalize MTN/Airtel to pesapal as the provider
      order.paymentMethod = (paymentMethod === 'mtn' || paymentMethod === 'airtel') ? 'pesapal' : paymentMethod;
      order.paymentDetails = {
        paymentId: transactionId,
        paymentStatus: 'Confirmed',
        paymentDate: new Date(),
      };
      order.updateStatus('confirmed', 'Payment confirmed', req.user);
      await order.save();
      
      await order.populate('buyer', 'email');
      await order.populate('seller', 'email');

      // Send email notifications
      try {
        if (order.seller && order.seller.email) {
          const paymentMethodDisplay = {
            'cod': 'Cash on Delivery',
            'paypal': 'PayPal',
            'stripe': 'Stripe (Card)',
            'pesapal': 'Pesapal (Mobile Money)',
            'mtn': 'MTN Mobile Money',
            'airtel': 'Airtel Money'
          };
          const methodName = paymentMethodDisplay[order.paymentMethod] || order.paymentMethod || 'Not specified';
          
          await sendEmail(
            order.seller.email,
            `Payment Confirmed for Order #${order.orderNumber}`,
            `Payment has been confirmed for order ${order.orderNumber}. Payment method: ${methodName}. Total amount: $${order.totalAmount}`
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

      // Clear throttle on success to allow immediate subsequent reads
      verifyThrottle.delete(throttleKey);
      res.json({ success: true, message: 'Payment verified successfully', order });
    } else {
      // Do not treat non-completed as an error; allow client to poll
      const status = paymentVerification.status || paymentVerification.raw?.status || 'PENDING';
      res.status(200).json({ success: false, status, message: 'Payment pending or not completed yet', details: paymentVerification.raw });
    }
  } catch (error) {
    return res.status(200).json({ success: false, status: 'PENDING', message: 'Verification pending or temporarily unavailable', error: error.message });
  }
};

// Get all orders for admin
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find({})
      .populate('buyer', 'name email')
      .populate('seller', 'name email')
      .populate('items.listing', 'name price')
      .sort({ createdAt: -1 });

    res.json({ orders });
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

module.exports = {
  createOrder: exports.createOrder,
  getBuyerOrders: exports.getBuyerOrders,
  getVendorOrders: exports.getVendorOrders,
  getOrder: exports.getOrder,
  updateOrderStatus: exports.updateOrderStatus,
  confirmPayment: exports.confirmPayment,
  cancelOrder: exports.cancelOrder,
  getAllOrders: exports.getAllOrders,
  initiatePayment,
  verifyPayment,
  calculateEstimatedDelivery,
  getStatusMessage
};