const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const axios = require('axios');
const Flutterwave = require('flutterwave-node-v3');

// PayPal client configuration
let paypalClient;
if (process.env.NODE_ENV === 'production') {
  paypalClient = new paypal.core.LiveEnvironment(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
  );
} else {
  paypalClient = new paypal.core.SandboxEnvironment(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
  );
}
const paypalInstance = new paypal.core.PayPalHttpClient(paypalClient);

// Flutterwave configuration (legacy; will be deprecated)
const flw = new Flutterwave(
  process.env.FLUTTERWAVE_PUBLIC_KEY,
  process.env.FLUTTERWAVE_SECRET_KEY
);

// Pesapal configuration
const PESA_ENV = (process.env.PESAPAL_ENV || 'sandbox').toLowerCase();
const PESA_BASE_URL = PESA_ENV === 'live'
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

let PESA_TOKEN_CACHE = { token: null, expiresAt: 0 };
let PESA_IPN_ID = process.env.PESAPAL_IPN_ID || null; // optional pre-configured

// Normalize a phone number to E.164 without '+' for Uganda
function normalizeUgPhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let p = raw.trim();
  // Remove spaces, dashes, and parentheses
  p = p.replace(/[\s\-()]/g, '');
  // If starts with +256, drop the plus
  if (p.startsWith('+256')) return '256' + p.slice(4);
  // If starts with 256 already
  if (p.startsWith('256')) return p;
  // If starts with 0 and looks like UG mobile (0XXXXXXXXX)
  if (/^0\d{9}$/.test(p)) return '256' + p.slice(1);
  // If already looks like E.164 without plus and 9-12 digits, accept
  if (/^\d{9,12}$/.test(p)) return p;
  return null;
}

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
    const keySuffix = consumer_key.slice(-4);
    console.log(`Requesting Pesapal token | env=${PESA_ENV} | base=${PESA_BASE_URL} | key=***${keySuffix} | keyLen=${consumer_key.length} | secLen=${consumer_secret.length}`);
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
    console.log('Pesapal RequestToken raw response keys:', Object.keys(res.data));
    const { token, expiryDate } = res.data; // expiryDate is ISO string
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

async function ensurePesapalIPN() {
  if (PESA_IPN_ID) return PESA_IPN_ID;
  const token = await getPesapalToken();
  try {
    const res = await axios.post(
      `${PESA_BASE_URL}/api/URLSetup/RegisterIPN`,
      {
        url: process.env.PESAPAL_IPN_URL,
        ipn_notification_type: 'POST',
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    PESA_IPN_ID = res.data && (res.data.ipn_id || res.data.ipnId || res.data.id);
    console.log('Pesapal IPN registered/using ID:', PESA_IPN_ID);
    return PESA_IPN_ID;
  } catch (err) {
    const details = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('Pesapal RegisterIPN error:', details);
    // Do not block payment initiation if IPN cannot be registered (e.g., localhost)
    console.warn('Proceeding without IPN (notification_id will be omitted). Set PESAPAL_IPN_URL to a public HTTPS URL for production.');
    return null;
  }
}

async function submitPesapalOrder(data, customer) {
  const token = await getPesapalToken();
  const ipnId = await ensurePesapalIPN();

  const isOrder = !data.invoiceNumber && data.orderNumber;

  const baseCallback = process.env.PESAPAL_CALLBACK_URL || `${process.env.FRONTEND_URL}/process-payment`;
  const callbackUrl = isOrder
    ? `${baseCallback}?order_id=${data._id}&method=pesapal`
    : `${baseCallback}?invoice_id=${data._id}&method=pesapal`;

  // Defensive: ensure required customer fields
  const customerEmail = (customer && customer.email) || (data.buyer && data.buyer.email) || 'no-reply@ujii.com';
  // Prefer provided phone sources then normalize to E.164 without '+' for UG
  const rawPhone = (customer && customer.phone)
    || (data.buyer && (data.buyer.phoneNumber || data.buyer.phone))
    || (data.shippingAddress && data.shippingAddress.phone)
    || null;
  const normalizedPhone = normalizeUgPhone(rawPhone);
  // Only use demo fallback in sandbox if no valid phone present
  const customerPhone = normalizedPhone || (PESA_ENV === 'sandbox' ? '256700000000' : null);
  const customerName = (customer && customer.name) || (data.buyer && data.buyer.name) || 'Ujii Customer';
  const [firstName, ...restName] = customerName.trim().split(' ');
  const lastName = restName.join(' ') || 'User';
  const amountNumber = Number(data.totalAmount || data.amount || 0);
  if (!amountNumber || amountNumber <= 0) {
    throw new Error('Invalid amount for Pesapal order');
  }

  // Build a unified merchant reference we want Pesapal to reflect back
  const unifiedRef = isOrder
    ? (data.orderNumber || data._id.toString())
    : (data.invoiceNumber || data._id.toString());

  const payload = {
    // Set id to the same as merchant_reference so Pesapal echoes it back consistently
    id: unifiedRef,
    currency: 'UGX',
    amount: amountNumber,
    description: isOrder ? `Order Payment - ${data.orderNumber}` : `Invoice Payment - ${data.invoiceNumber}`,
    // Pesapal requires a merchant reference (your own unique reference)
    merchant_reference: unifiedRef,
    // Some integrations accept order_reference as well; include for compatibility
    order_reference: unifiedRef,
    callback_url: callbackUrl,
    // Only include notification_id if we successfully registered IPN
    ...(ipnId ? { notification_id: ipnId } : {}),
    branch: 'default',
    billing_address: {
      email_address: customerEmail,
      // Pesapal requires phone_number; omit if truly unavailable (non-sandbox)
      ...(customerPhone ? { phone_number: customerPhone } : {}),
      country_code: 'UG',
      first_name: firstName || 'Customer',
      middle_name: '',
      last_name: lastName,
      line_1: 'N/A',
      city: 'Kampala',
      state: 'UG',
      postal_code: '00000',
      zip_code: '00000',
    },
    // Tracking references
    order_tracking_id: undefined,
    // Pesapal supports metadata under "metadata" key
    metadata: isOrder ? { order_id: data._id.toString() } : { invoice_id: data._id.toString() },
  };

  console.log('Pesapal SubmitOrderRequest payload:', {
    amount: payload.amount,
    currency: payload.currency,
    callback_url: payload.callback_url,
    merchant_reference: payload.merchant_reference,
    order_reference: payload.order_reference,
    notification_id: payload.notification_id,
    buyer: { email: payload.billing_address.email_address, phone: payload.billing_address.phone_number, first: payload.billing_address.first_name, last: payload.billing_address.last_name }
  });
  let res;
  try {
    res = await axios.post(
      `${PESA_BASE_URL}/api/Transactions/SubmitOrderRequest`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    // Pesapal sometimes returns HTTP 200 with an error object in the body
    if (res && res.data && res.data.error) {
      const e = res.data.error;
      const msg = (e && (e.message || e.error_message)) || 'Unknown Pesapal error';
      console.error('Pesapal SubmitOrderRequest returned body error:', e);
      throw new Error(`Pesapal submit order failed: ${msg}`);
    }
    console.log('Pesapal SubmitOrderRequest success:', res.data);
  } catch (err) {
    // Surface Pesapal error details for easier debugging
    const details = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    console.error('Pesapal SubmitOrderRequest error:', details);
    throw new Error(`Pesapal submit order failed: ${details}`);
  }

  // Pesapal returns order_tracking_id and redirect_url
  const { order_tracking_id, redirect_url } = res.data;
  if (!order_tracking_id || !redirect_url) {
    throw new Error('Pesapal did not return a payment link. Please try again.');
  }
  return {
    paymentLink: redirect_url,
    transactionRef: order_tracking_id,
  };
}

async function getPesapalTransactionStatus(orderTrackingId) {
  const token = await getPesapalToken();
  const res = await axios.get(
    `${PESA_BASE_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const { status, merchant_reference, payment_method, amount, created_date, confirmation_code, currency } = res.data;

  return {
    success: String(status).toUpperCase() === 'COMPLETED',
    transactionId: confirmation_code || merchant_reference || orderTrackingId,
    amount,
    currency: currency || 'UGX',
    method: payment_method,
    createdAt: created_date,
  };
}

// Create Stripe payment session
exports.createStripeSession = async (data) => {
  try {
    // Handle both invoice and order data structures
    const isOrder = !data.invoiceNumber && data.orderNumber;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: data.items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: isOrder ? 
              (item.listing?.name || item.listing?.title || 'Product') : 
              (item.description || 'Product'),
          },
          unit_amount: Math.round(item.unitPrice * 100), // Convert to cents
        },
        quantity: item.quantity,
      })),
      mode: 'payment',
      success_url: isOrder ? 
        `${process.env.FRONTEND_URL}/orders/${data._id}/success?session_id={CHECKOUT_SESSION_ID}` : 
        `${process.env.FRONTEND_URL}/invoices/${data._id}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: isOrder ? 
        `${process.env.FRONTEND_URL}/orders/${data._id}/cancel` : 
        `${process.env.FRONTEND_URL}/invoices/${data._id}/cancel`,
      metadata: isOrder ? 
        { orderId: data._id.toString() } : 
        { invoiceId: data._id.toString() }
    });

    return { sessionId: session.id };
  } catch (error) {
    throw new Error(`Stripe payment error: ${error.message}`);
  }
};

// Create PayPal order
exports.createPayPalOrder = async (data) => {
  try {
    // Handle both invoice and order data structures
    const isOrder = !data.invoiceNumber && data.orderNumber;
    
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: data.totalAmount.toString(),
          breakdown: {
            item_total: {
              currency_code: 'USD',
              value: data.subtotal.toString()
            },
            tax_total: {
              currency_code: 'USD',
              value: data.tax.toString()
            }
          }
        },
        custom_id: data._id.toString(),
        description: isOrder ? 
          `Order payment for ${data.orderNumber}` : 
          `Invoice payment for ${data.invoiceNumber}`
      }],
      application_context: {
        return_url: isOrder ? 
          `${process.env.FRONTEND_URL}/orders/${data._id}/success` : 
          `${process.env.FRONTEND_URL}/invoices/${data._id}/success`,
        cancel_url: isOrder ? 
          `${process.env.FRONTEND_URL}/orders/${data._id}/cancel` : 
          `${process.env.FRONTEND_URL}/invoices/${data._id}/cancel`
      }
    });

    const order = await paypalInstance.execute(request);
    return { orderId: order.result.id };
  } catch (error) {
    throw new Error(`PayPal payment error: ${error.message}`);
  }
};

// Create Pesapal payment
exports.createPesapalPayment = async (data, customer) => {
  try {
    const result = await submitPesapalOrder(data, customer);
    // Ensure frontend gets the expected merchant reference (orderNumber/invoiceNumber)
    const isOrder = !data.invoiceNumber && data.orderNumber;
    const merchantRef = isOrder
      ? (data.orderNumber || data._id.toString())
      : (data.invoiceNumber || data._id.toString());
    return {
      paymentLink: result.redirect_url,
      transactionRef: result.order_tracking_id,
      merchant_reference: merchantRef,
    };
  } catch (error) {
    console.error('Error creating Pesapal payment:', error);
    throw error;
  }
};

// Verify Stripe payment
exports.verifyStripePayment = async (sessionId) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      success: session.payment_status === 'paid',
      transactionId: session.payment_intent,
      amount: session.amount_total / 100,
      currency: session.currency,
      metadata: session.metadata
    };
  } catch (error) {
    throw new Error(`Stripe verification error: ${error.message}`);
  }
};

// Verify PayPal payment
exports.verifyPayPalPayment = async (orderId) => {
  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    const capture = await paypalInstance.execute(request);
    
    return {
      success: capture.result.status === 'COMPLETED',
      transactionId: capture.result.id,
      amount: capture.result.purchase_units[0].amount.value,
      currency: capture.result.purchase_units[0].amount.currency_code,
      customId: capture.result.purchase_units[0].custom_id
    };
  } catch (error) {
    throw new Error(`PayPal verification error: ${error.message}`);
  }
};

// Verify Pesapal payment
exports.verifyPesapalPayment = async (orderTrackingId) => {
  try {
    console.log('Verifying Pesapal payment with orderTrackingId:', orderTrackingId);
    const status = await getPesapalTransactionStatus(orderTrackingId);
    console.log('Pesapal GetTransactionStatus response:', status);
    const success = status && (status.payment_status_description === 'Completed' || status.status_code === 1 || status.result_code === 0);
    return {
      success,
      transactionId: orderTrackingId,
      status: status && (status.payment_status_description || status.status_description || status.status),
      raw: status,
    };
  } catch (error) {
    const msg = error && error.message ? error.message : String(error);
    console.error('Pesapal verification error:', msg);
    throw new Error(`Pesapal verification error: ${msg}`);
  }
};