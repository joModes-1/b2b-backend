const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { protect } = require('../middleware/authMiddleware');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('@paypal/checkout-server-sdk');
const Flutterwave = require('flutterwave-node-v3');

// PayPal configuration
const environment = new paypal.core.SandboxEnvironment(
  process.env.PAYPAL_CLIENT_ID,
  process.env.PAYPAL_CLIENT_SECRET
);
const paypalClient = new paypal.core.PayPalHttpClient(environment);

// Flutterwave configuration
const flw = new Flutterwave(
  process.env.FLUTTERWAVE_PUBLIC_KEY,
  process.env.FLUTTERWAVE_SECRET_KEY
);

// Create new order
router.post('/', protect, async (req, res) => {
  try {
    const { items, shippingInfo, total, paymentMethod } = req.body;

    const order = await Order.create({
      user: req.user._id,
      items,
      shippingInfo,   
      totalAmount: total,
      paymentInfo: {
        type: paymentMethod
      }
    });

    res.status(201).json(order);
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Error creating order' });
  }
});

// Get user's orders
router.get('/my-orders', protect, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// Get single order
router.get('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(order);
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ message: 'Error fetching order' });
  }
});

// Create Stripe payment session
router.post('/create-stripe-session', protect, async (req, res) => {
  try {
    const { orderId, amount, currency } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: 'Order Payment',
            },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/checkout`,
      metadata: {
        orderId
      }
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Create Stripe session error:', error);
    res.status(500).json({ message: 'Error creating payment session' });
  }
});

// Handle Stripe webhook
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata.orderId;

      await Order.findByIdAndUpdate(orderId, {
        isPaid: true,
        paidAt: Date.now(),
        'paymentInfo.status': 'completed',
        'paymentInfo.id': session.payment_intent
      });
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// Create PayPal order
router.post('/create-paypal-order', protect, async (req, res) => {
  try {
    const { orderId, amount } = req.body;

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'USD',
          value: amount
        },
        reference_id: orderId
      }]
    });

    const order = await paypalClient.execute(request);
    res.json({ id: order.result.id });
  } catch (error) {
    console.error('Create PayPal order error:', error);
    res.status(500).json({ message: 'Error creating PayPal order' });
  }
});

// Capture PayPal payment
router.post('/capture-paypal-payment', protect, async (req, res) => {
  try {
    const { orderId } = req.body;

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    const capture = await paypalClient.execute(request);

    const order = await Order.findById(capture.result.purchase_units[0].reference_id);
    order.isPaid = true;
    order.paidAt = Date.now();
    order.paymentInfo.status = 'completed';
    order.paymentInfo.id = capture.result.id;
    await order.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Capture PayPal payment error:', error);
    res.status(500).json({ message: 'Error capturing payment' });
  }
});

// Initialize Flutterwave payment
router.post('/initiate-flutterwave', protect, async (req, res) => {
  try {
    const { orderId, amount, email, name, phone } = req.body;

    const payload = {
      tx_ref: orderId,
      amount,
      currency: 'USD',
      payment_options: 'card,mobilemoney,ussd',
      customer: {
        email,
        name,
        phone_number: phone
      },
      customizations: {
        title: 'B2B Platform',
        description: 'Payment for order #' + orderId,
        logo: process.env.FRONTEND_URL + '/logo.png'
      }
    };

    const response = await flw.Charge.initiate(payload);
    res.json(response);
  } catch (error) {
    console.error('Initiate Flutterwave payment error:', error);
    res.status(500).json({ message: 'Error initiating payment' });
  }
});

// Verify Flutterwave payment
router.post('/verify-flutterwave', protect, async (req, res) => {
  try {
    const { transaction_id } = req.body;

    const response = await flw.Transaction.verify({ id: transaction_id });
    
    if (response.status === 'success') {
      const order = await Order.findById(response.tx_ref);
      order.isPaid = true;
      order.paidAt = Date.now();
      order.paymentInfo.status = 'completed';
      order.paymentInfo.id = transaction_id;
      await order.save();
    }

    res.json(response);
  } catch (error) {
    console.error('Verify Flutterwave payment error:', error);
    res.status(500).json({ message: 'Error verifying payment' });
  }
});

// Update order status
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    order.status = status;
    if (status === 'delivered') {
      order.isDelivered = true;
      order.deliveredAt = Date.now();
    }

    await order.save();
    res.json(order);
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ message: 'Error updating order status' });
  }
});

// Cancel order
router.post('/:id/cancel', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ message: 'Cannot cancel non-pending order' });
    }

    order.status = 'cancelled';
    await order.save();

    res.json(order);
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ message: 'Error cancelling order' });
  }
});

module.exports = router; 