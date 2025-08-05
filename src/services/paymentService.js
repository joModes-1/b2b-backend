const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
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

// Flutterwave configuration
const flw = new Flutterwave(
  process.env.FLUTTERWAVE_PUBLIC_KEY,
  process.env.FLUTTERWAVE_SECRET_KEY
);

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

// Create Flutterwave payment link
exports.createFlutterwavePayment = async (data, customer) => {
  try {
    // Handle both invoice and order data structures
    const isOrder = !data.invoiceNumber && data.orderNumber;
    
    const payload = {
      tx_ref: isOrder ? 
        `ORD-${data._id}-${Date.now()}` : 
        `INV-${data._id}-${Date.now()}`,
      amount: data.totalAmount,
      currency: 'USD',
      payment_type: 'card,mobilemoney,ussd',
      customer: {
        email: customer.email,
        name: customer.name,
        phone_number: customer.phone
      },
      customizations: {
        title: isOrder ? 
          `Order Payment - ${data.orderNumber}` : 
          `Invoice Payment - ${data.invoiceNumber}`,
        description: isOrder ? 
          'Payment for order' : 
          'Payment for products/services',
        logo: process.env.COMPANY_LOGO_URL
      },
      redirect_url: isOrder ? 
        `${process.env.FRONTEND_URL}/process-payment?order_id=${data._id}&method=flutterwave` : 
        `${process.env.FRONTEND_URL}/process-payment?invoice_id=${data._id}&method=flutterwave`,
      meta: isOrder ? 
        { order_id: data._id.toString() } : 
        { invoice_id: data._id.toString() }
    };

    // For mobile money payments, we'll create a payment link via direct API call
    const axios = require('axios');
    
    const response = await axios.post(
      'https://api.flutterwave.com/v3/payments',
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return { 
      paymentLink: response.data.data.link,
      transactionRef: payload.tx_ref
    };
  } catch (error) {
    throw new Error(`Flutterwave payment error: ${error.message}`);
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

// Verify Flutterwave payment
exports.verifyFlutterwavePayment = async (transactionId) => {
  try {
    const response = await flw.Transaction.verify({ id: transactionId });
    
    return {
      success: response.data.status === 'successful',
      transactionId: response.data.id,
      amount: response.data.amount,
      currency: response.data.currency,
      metadata: response.data.meta
    };
  } catch (error) {
    throw new Error(`Flutterwave verification error: ${error.message}`);
  }
}; 