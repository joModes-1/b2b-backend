const QRCode = require('qrcode');
const crypto = require('crypto');
const Order = require('../models/Order');

/**
 * Generate QR code for delivery confirmation
 * @param {string} orderId - The order ID
 * @param {string} baseUrl - Base URL for the delivery confirmation (e.g., 'https://yourdeliveryapp.com')
 * @returns {Object} - QR code data including token, URL, and base64 image
 */
const generateDeliveryQR = async (orderId, baseUrl = process.env.DELIVERY_BASE_URL || 'http://localhost:3001') => {
  try {
    // Generate secure token for delivery confirmation
    const deliveryToken = crypto.randomBytes(32).toString('hex');
    // Fetch order to include delivery details in payload
    const order = await Order.findById(orderId)
      .populate('buyer', 'name email phoneNumber')
      .lean();

    // Build rich payload with delivery details
    const payload = {
      v: 1,
      type: 'delivery_confirmation',
      order: {
        id: orderId,
        number: order?.orderNumber || null,
        total: order?.totalAmount || null,
      },
      buyer: {
        id: order?.buyer?._id?.toString?.() || (order?.buyer?.toString?.() || null),
        name: order?.buyer?.name || null,
        phone: order?.buyer?.phoneNumber || null,
        email: order?.buyer?.email || null,
      },
      // Backward-compatible code pattern used by existing delivery scanners
      code: (order?.orderNumber && (order?.buyer?._id || order?.buyer))
        ? `ORDER_${order.orderNumber}_BUYER_${(order?.buyer?._id || order?.buyer).toString()}`
        : null,
      delivery: {
        name: order?.shippingAddress?.fullName || order?.buyer?.name || null,
        address: order?.shippingAddress?.street || order?.shippingAddress?.address || null,
        city: order?.shippingAddress?.city || null,
        state: order?.shippingAddress?.state || null,
        country: order?.shippingAddress?.country || null,
        phone: order?.shippingAddress?.phone || order?.buyer?.phoneNumber || null,
      },
      token: deliveryToken,
      ts: Date.now()
    };

    // Create delivery confirmation URL (kept for backward compatibility)
    const deliveryUrl = `${baseUrl}/delivery/confirm?orderId=${orderId}&token=${deliveryToken}`;

    // Generate QR code as base64 image from JSON payload
    const qrCodeBase64 = await QRCode.toDataURL(JSON.stringify(payload), {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 256
    });
    
    return {
      deliveryToken,
      deliveryUrl,
      qrCode: qrCodeBase64,
      qrPayload: JSON.stringify(payload)
    };
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw new Error('Failed to generate delivery QR code');
  }
};

/**
 * Generate QR code using Google Charts API (fallback method)
 * @param {string} orderId - The order ID
 * @param {string} baseUrl - Base URL for the delivery confirmation
 * @returns {Object} - QR code data with Google Charts URL
 */
const generateDeliveryQRFallback = (orderId, baseUrl = process.env.DELIVERY_BASE_URL || 'http://localhost:3001') => {
  const deliveryToken = crypto.randomBytes(32).toString('hex');
  const deliveryUrl = `${baseUrl}/delivery/confirm?orderId=${orderId}&token=${deliveryToken}`;
  
  // Google Charts QR Code API
  const googleQRUrl = `https://chart.googleapis.com/chart?cht=qr&chs=256x256&chl=${encodeURIComponent(deliveryUrl)}`;
  
  return {
    deliveryToken,
    deliveryUrl,
    qrCode: googleQRUrl // This will be a URL instead of base64
  };
};

module.exports = {
  generateDeliveryQR,
  generateDeliveryQRFallback
};
