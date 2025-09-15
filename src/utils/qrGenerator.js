const QRCode = require('qrcode');
const crypto = require('crypto');

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
    
    // Create delivery confirmation URL
    const deliveryUrl = `${baseUrl}/delivery/confirm?orderId=${orderId}&token=${deliveryToken}`;
    
    // Generate QR code as base64 image
    const qrCodeBase64 = await QRCode.toDataURL(deliveryUrl, {
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
      qrCode: qrCodeBase64
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
