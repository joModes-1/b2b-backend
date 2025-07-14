const Invoice = require('../models/Invoice');
const { sendEmail } = require('../utils/emailService');
const paymentService = require('../services/paymentService');

// Create a new invoice
exports.createInvoice = async (req, res) => {
  try {
    const {
      order,
      buyer,
      items,
      tax,
      discount,
      dueDate,
      notes,
      billingAddress
    } = req.body;

    // Calculate totals
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const totalAmount = subtotal + (tax || 0) - (discount || 0);

    const invoice = new Invoice({
      order,
      buyer,
      vendor: req.user._id,
      items: items.map(item => ({
        ...item,
        subtotal: item.quantity * item.unitPrice
      })),
      subtotal,
      tax,
      discount,
      totalAmount,
      dueDate,
      notes,
      billingAddress
    });

    await invoice.save();

    // Send email notification to buyer
    await sendEmail(
      invoice.buyer.email,
      'New Invoice Received',
      `You have received a new invoice (${invoice.invoiceNumber}) for $${totalAmount}`
    );

    res.status(201).json(invoice);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all invoices for vendor
exports.getVendorInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find({ vendor: req.user._id })
      .populate('buyer', 'name email')
      .populate('order')
      .sort({ createdAt: -1 });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all invoices for buyer
exports.getBuyerInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find({ buyer: req.user._id })
      .populate('seller', 'name email')
      .populate('order')
      .sort({ createdAt: -1 });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get single invoice
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('buyer', 'name email')
      .populate('seller', 'name email')
      .populate('order')
      .populate('items.listing');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Verify user is either buyer or vendor
    if (invoice.buyer._id.toString() !== req.user._id.toString() &&
        invoice.vendor._id.toString() !== req.user._id.toString() &&
        !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(invoice);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update invoice
exports.updateInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Verify vendor ownership
    if (invoice.vendor.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Only allow updates if invoice is in draft status
    if (invoice.status !== 'draft') {
      return res.status(400).json({ message: 'Cannot update sent invoice' });
    }

    const updates = req.body;
    if (updates.items) {
      // Recalculate totals
      updates.subtotal = updates.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      updates.totalAmount = updates.subtotal + (updates.tax || 0) - (updates.discount || 0);
    }

    const updatedInvoice = await Invoice.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    );

    res.json(updatedInvoice);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Send invoice (change status from draft to sent)
exports.sendInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('buyer', 'email')
      .populate('seller', 'name');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Verify vendor ownership
    if (invoice.vendor._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    invoice.status = 'sent';
    await invoice.save();

    // Send email notification
    await sendEmail(
      invoice.buyer.email,
      `Invoice ${invoice.invoiceNumber} from ${invoice.vendor.name}`,
      `You have received an invoice for $${invoice.totalAmount}. Due date: ${invoice.dueDate}`
    );

    res.json(invoice);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Initiate payment
exports.initiatePayment = async (req, res) => {
  try {
    const { paymentMethod } = req.body;
    const invoice = await Invoice.findById(req.params.id)
      .populate('buyer', 'email name phone');

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    // Verify buyer is making the payment
    if (invoice.buyer._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    let paymentData;
    switch (paymentMethod) {
      case 'stripe':
        paymentData = await paymentService.createStripeSession(invoice);
        break;
      case 'paypal':
        paymentData = await paymentService.createPayPalOrder(invoice);
        break;
      case 'flutterwave':
        paymentData = await paymentService.createFlutterwavePayment(invoice, invoice.buyer);
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
exports.verifyPayment = async (req, res) => {
  try {
    const { paymentMethod, transactionId } = req.body;
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

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
      invoice.status = 'paid';
      invoice.paymentMethod = paymentMethod;
      invoice.paymentDetails = {
        transactionId: paymentVerification.transactionId,
        provider: paymentMethod,
        amount: paymentVerification.amount,
        currency: paymentVerification.currency,
        paidAt: new Date()
      };
      await invoice.save();

      // Send email notifications
      await sendEmail(
        invoice.buyer.email,
        'Payment Confirmation',
        `Your payment for invoice ${invoice.invoiceNumber} has been confirmed.`
      );

      await sendEmail(
        invoice.vendor.email,
        'Payment Received',
        `Payment received for invoice ${invoice.invoiceNumber}`
      );

      res.json({ success: true, invoice });
    } else {
      res.status(400).json({ message: 'Payment verification failed' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
}; 