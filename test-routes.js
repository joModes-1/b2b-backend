try {
  const routes = require('./routes/deliveryRoutes');
  const express = require('express');
  
  console.log('✅ Routes module loaded successfully');
  console.log('Type of routes:', typeof routes);
  console.log('Routes is Router?', routes.name === 'router');
  
  // List all routes
  console.log('\n📋 Available routes:');
  routes.stack.forEach(layer => {
    if (layer.route) {
      const path = layer.route.path;
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      console.log(`  ${methods} /api/delivery${path}`);
    }
  });
  
  console.log('\n✅ All routes are properly defined!');
  
} catch(e) {
  console.error('❌ Error loading routes:', e.message);
  console.error(e.stack);
}
