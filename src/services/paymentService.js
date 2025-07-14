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
exports.createStripeSession = async (invoice) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: invoice.items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.description || 'Product',
          },
          unit_amount: Math.round(item.unitPrice * 100), // Convert to cents
        },
        quantity: item.quantity,
      })),
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/invoices/${invoice._id}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/invoices/${invoice._id}/cancel`,
      metadata: {
        invoiceId: invoice._id.toString()
      }
    });

    return { sessionId: session.id };
  } catch (error) {
    throw new Error(`Stripe payment error: ${error.message}`);
  }
};

// Create PayPal order
exports.createPayPalOrder = async (invoice) => {
  try {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: invoice.totalAmount.toString(),
          breakdown: {
            item_total: {
              currency_code: 'USD',
              value: invoice.subtotal.toString()
            },
            tax_total: {
              currency_code: 'USD',
              value: invoice.tax.toString()
            }
          }
        },
        items: invoice.items.map(item => ({
          name: item.description || 'Product',
          unit_amount: {
            currency_code: 'USD',
            value: item.unitPrice.toString()
          },
          quantity: item.quantity.toString()
        })),
        custom_id: invoice._id.toString()
      }]
    });

    const order = await paypalInstance.execute(request);
    return { orderId: order.result.id };
  } catch (error) {
    throw new Error(`PayPal payment error: ${error.message}`);
  }
};

// Create Flutterwave payment link
exports.createFlutterwavePayment = async (invoice, customer) => {
  try {
    const payload = {
      tx_ref: `INV-${invoice._id}-${Date.now()}`,
      amount: invoice.totalAmount,
      currency: 'USD',
      payment_type: 'card,mobilemoney,ussd',
      customer: {
        email: customer.email,
        name: customer.name,
        phone_number: customer.phone
      },
      customizations: {
        title: `Invoice Payment - ${invoice.invoiceNumber}`,
        description: 'Payment for products/services',
        logo: process.env.COMPANY_LOGO_URL
      },
      redirect_url: `${process.env.FRONTEND_URL}/invoices/${invoice._id}/verify`,
      meta: {
        invoice_id: invoice._id.toString()
      }
    };

    const response = await flw.Charge.create(payload);
    return { 
      paymentLink: response.data.link,
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