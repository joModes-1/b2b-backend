const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const authRoutes = require('./src/routes/authRoutes');
const productRoutes = require('./src/routes/productRoutes');
const orderRoutes = require('./src/routes/orderRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');
const qrRoutes = require('./src/routes/qrRoutes');
const locationRoutes = require('./src/routes/locationRoutes');
const webhookRoutes = require('./src/routes/webhookRoutes');
const payoutRoutes = require('./src/routes/payoutRoutes');
const driverRoutes = require('./src/routes/driverRoutes');
const miniShopRoutes = require('./src/routes/miniShopRoutes');
const reviewRoutes = require('./src/routes/reviewRoutes');
const searchRoutes = require('./src/routes/searchRoutes');
const transactionRoutes = require('./src/routes/transactionRoutes');
const refundRoutes = require('./src/routes/refundRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');

dotenv.config();

const app = express();

// Root route for health check
app.get('/', (req, res) => {
  res.json({ message: 'Server started successfully. Welcome to the B2B Platform API.' });
});

// Middleware
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:19006', // Expo Web dev server
    'http://127.0.0.1:19006', // Alternate loopback
    'http://10.0.2.2:3000', // Android emulator
    'http://10.0.2.2:19006', // Android emulator Expo Web
    "https://ujii.netlify.app"
  ], // Explicitly allow frontend origin
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // Allow cookies, if you use them
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.use(express.json());

// Stripe webhook endpoint needs raw body
app.use('/api/orders/stripe-webhook', express.raw({ type: 'application/json' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/minishop', miniShopRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/refunds', refundRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/dashboard', dashboardRoutes);

// 404 catch-all for unknown routes
app.use((req, res, next) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    // Start server
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  // Close server & exit process
  process.exit(1);
}); 