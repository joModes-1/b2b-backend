const axios = require('axios');

async function testDeliveryLogin() {
  try {
    console.log('Testing delivery login on port 4001...');
    const response = await axios.post('http://localhost:4001/api/delivery/login', {
      email: 'delivery@test.com',
      password: 'password123'
    });
    
    console.log('✅ Login successful!');
    console.log('Token:', response.data.token);
    console.log('User:', response.data.user);
    
    // Now test the protected routes
    console.log('\n📊 Testing /stats endpoint...');
    try {
      const statsResponse = await axios.get('http://localhost:4001/api/delivery/stats', {
        headers: {
          'Authorization': `Bearer ${response.data.token}`
        }
      });
      console.log('✅ Stats:', statsResponse.data);
    } catch (statsError) {
      console.error('❌ Stats failed:', statsError.response?.data || statsError.message);
    }
    
    console.log('\n📋 Testing /recent-orders endpoint...');
    try {
      const ordersResponse = await axios.get('http://localhost:4001/api/delivery/recent-orders', {
        headers: {
          'Authorization': `Bearer ${response.data.token}`
        }
      });
      console.log('✅ Recent orders:', ordersResponse.data);
    } catch (ordersError) {
      console.error('❌ Recent orders failed:', ordersError.response?.data || ordersError.message);
    }
    
  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message);
  }
}

testDeliveryLogin();
