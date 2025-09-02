const axios = require('axios');
const User = require('../models/User');

// Pesapal configuration
const PESA_ENV = (process.env.PESAPAL_ENV || 'sandbox').toLowerCase();
const PESA_BASE_URL = PESA_ENV === 'live'
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

let PESA_TOKEN_CACHE = { token: null, expiresAt: 0 };

async function getPesapalToken() {
  const now = Date.now();
  if (PESA_TOKEN_CACHE.token && PESA_TOKEN_CACHE.expiresAt - 60000 > now) {
    return PESA_TOKEN_CACHE.token;
  }
  
  try {
    if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
      console.error('Pesapal credentials missing. Ensure PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET are set.');
      throw new Error('Missing Pesapal credentials');
    }
    
    const rawKey = process.env.PESAPAL_CONSUMER_KEY;
    const rawSecret = process.env.PESAPAL_CONSUMER_SECRET;
    const consumer_key = rawKey.trim().replace(/^"|"$/g, '');
    const consumer_secret = rawSecret.trim().replace(/^"|"$/g, '');
    
    const res = await axios.post(
      `${PESA_BASE_URL}/api/Auth/RequestToken`,
      {
        consumer_key,
        consumer_secret,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    if (!res || !res.data) {
      throw new Error('Empty response from Pesapal RequestToken');
    }
    
    const { token, expiryDate } = res.data;
    if (!token) {
      console.error('Pesapal RequestToken returned no token. Response:', res.data);
      throw new Error('Pesapal RequestToken returned no token');
    }
    
    PESA_TOKEN_CACHE = {
      token,
      expiresAt: new Date(expiryDate).getTime(),
    };
    
    return token;
  } catch (err) {
    const details = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('Pesapal RequestToken error:', details);
    throw new Error(`Pesapal token error: ${details}`);
  }
}

// Create a Pesapal subaccount for a seller
async function createPesapalSubaccount(seller) {
  try {
    // Only create subaccounts for sellers
    if (seller.role !== 'seller') {
      return null;
    }
    
    // If subaccount already exists, return it
    if (seller.pesapalSubaccountId && seller.pesapalSubaccountCreated) {
      return seller.pesapalSubaccountId;
    }
    
    const token = await getPesapalToken();
    
    // Prepare seller data for subaccount creation
    const [firstName, ...restName] = seller.name.trim().split(' ');
    const lastName = restName.join(' ') || 'Seller';
    
    const payload = {
      account_number: seller.phoneNumber.replace('+', ''), // Remove + for Pesapal
      first_name: firstName,
      last_name: lastName,
      email: seller.email,
      phone_number: seller.phoneNumber.replace('+', ''),
      country: 'UG',
      currency: 'UGX',
      merchant_reference: seller._id.toString() // Use MongoDB ID as reference
    };
    
    const res = await axios.post(
      `${PESA_BASE_URL}/api/Merchant/CreateSubAccount`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (res.data && res.data.subaccount_id) {
      // Update user with subaccount information
      seller.pesapalSubaccountId = res.data.subaccount_id;
      seller.pesapalSubaccountCreated = true;
      await seller.save();
      
      return res.data.subaccount_id;
    } else {
      throw new Error('Failed to create Pesapal subaccount');
    }
  } catch (error) {
    console.error('Error creating Pesapal subaccount:', error.message);
    throw error;
  }
}

// Get or create Pesapal subaccount for a seller
async function getOrCreatePesapalSubaccount(sellerId) {
  try {
    const seller = await User.findById(sellerId);
    if (!seller) {
      throw new Error('Seller not found');
    }
    
    // If subaccount already exists, return it
    if (seller.pesapalSubaccountId && seller.pesapalSubaccountCreated) {
      return seller.pesapalSubaccountId;
    }
    
    // Create new subaccount
    return await createPesapalSubaccount(seller);
  } catch (error) {
    console.error('Error getting/creating Pesapal subaccount:', error.message);
    throw error;
  }
}

module.exports = {
  createPesapalSubaccount,
  getOrCreatePesapalSubaccount
};
