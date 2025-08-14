const mongoose = require('mongoose');

const invoiceItemSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  description: String,
  subtotal: {
    type: Number,
    required: true
  }
});

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  items: [invoiceItemSchema],
  subtotal: {
    type: Number,
    required: true
  },
  tax: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
    default: 'draft'
  },
  dueDate: {
    type: Date,
    required: true
  },
  notes: String,
  paymentMethod: {
    type: String,
    enum: ['stripe', 'paypal', 'flutterwave', 'pesapal', 'bank_transfer', 'other'],
  },
  paymentDetails: {
    transactionId: String,
    provider: String,
    amount: Number,
    currency: String,
    paidAt: Date
  },
  billingAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  }
}, {
  timestamps: true
});

// Add indexes for frequent queries
invoiceSchema.index({ seller: 1, status: 1 });
invoiceSchema.index({ buyer: 1, status: 1 });
invoiceSchema.index({ invoiceNumber: 1 });
invoiceSchema.index({ dueDate: 1, status: 1 });

// Auto-generate invoice number
invoiceSchema.pre('save', async function(next) {
  if (this.isNew) {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    
    // Get the count of invoices for the current month
    const count = await mongoose.model('Invoice').countDocuments({
      createdAt: {
        $gte: new Date(date.getFullYear(), date.getMonth(), 1),
        $lt: new Date(date.getFullYear(), date.getMonth() + 1, 1)
      }
    });

    // Format: INV-YY-MM-XXXX (e.g., INV-23-01-0001)
    this.invoiceNumber = `INV-${year}-${month}-${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema); 