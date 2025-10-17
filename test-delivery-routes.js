// Load environment variables first
require('dotenv').config();

const express = require('express');
const app = express();

// Middleware
app.use(express.json());

// Try to load delivery routes
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
  
  // Test server
  const PORT = 4001; // Different port to avoid conflict
  app.listen(PORT, () => {
    console.log(`\n🚀 Test server running on port ${PORT}`);
    console.log('Try these commands to test:');
    console.log(`  curl -X POST http://localhost:${PORT}/api/delivery/login -H "Content-Type: application/json" -d "{\\"email\\":\\"delivery@test.com\\",\\"password\\":\\"password123\\"}"`);
    console.log('\nPress Ctrl+C to stop the test server');
  });
  
} catch(error) {
  console.error('❌ Error loading delivery routes:', error.message);
  console.error('\nFull error:', error);
}
