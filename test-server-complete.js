// Load environment variables first
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    
    // Load delivery routes after DB connection
    try {
      const deliveryRoutes = require('./routes/deliveryRoutes');
      app.use('/api/delivery', deliveryRoutes);
      
      console.log('✅ Delivery routes loaded successfully!');
      
      // List all routes
      console.log('\n📋 Available delivery routes:');
      deliveryRoutes.stack.forEach(layer => {
        if (layer.route) {
          const path = layer.route.path;
          const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
          console.log(`  ${methods} /api/delivery${path}`);
        }
      });
      
      // Start server
      const PORT = 4001;
      app.listen(PORT, () => {
        console.log(`\n🚀 Test server running on port ${PORT}`);
        console.log('\n🧪 Test with:');
        console.log('  node test-login-4001.js');
        console.log('\nPress Ctrl+C to stop the test server');
      });
      
    } catch(error) {
      console.error('❌ Error loading delivery routes:', error.message);
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// Error handler
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
