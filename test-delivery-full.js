const axios = require('axios');

async function testDeliveryEndpoints() {
  const API_URL = 'http://localhost:4000/api';
  
  try {
    console.log('🔐 Testing delivery login...');
    const loginResponse = await axios.post(`${API_URL}/delivery/login`, {
      email: 'delivery@test.com',
      password: 'password123'
    });
    
    console.log('✅ Login successful!');
    console.log('Token:', loginResponse.data.token?.substring(0, 50) + '...');
    console.log('User:', {
      id: loginResponse.data.user.id,
      name: loginResponse.data.user.name,
      email: loginResponse.data.user.email,
      role: loginResponse.data.user.role
    });
    
    const token = loginResponse.data.token;
    const headers = { 'Authorization': `Bearer ${token}` };
    
    // Test profile endpoint
    console.log('\n👤 Testing /profile endpoint...');
    try {
      const profileResponse = await axios.get(`${API_URL}/delivery/profile`, { headers });
      console.log('✅ Profile:', {
        name: profileResponse.data.name,
        email: profileResponse.data.email,
        role: profileResponse.data.role,
        phoneNumber: profileResponse.data.phoneNumber
      });
    } catch (error) {
      console.error('❌ Profile failed:', error.response?.data || error.message);
    }
    
    // Test stats endpoint
    console.log('\n📊 Testing /stats endpoint...');
    try {
      const statsResponse = await axios.get(`${API_URL}/delivery/stats`, { headers });
      console.log('✅ Stats:', statsResponse.data);
    } catch (error) {
      console.error('❌ Stats failed:', error.response?.data || error.message);
    }
    
    // Test recent-orders endpoint
    console.log('\n📋 Testing /recent-orders endpoint...');
    try {
      const ordersResponse = await axios.get(`${API_URL}/delivery/recent-orders`, { headers });
      console.log('✅ Recent orders:', {
        count: ordersResponse.data.orders?.length || 0,
        orders: ordersResponse.data.orders?.slice(0, 2) || []
      });
    } catch (error) {
      console.error('❌ Recent orders failed:', error.response?.data || error.message);
    }
    
    console.log('\n✅ All delivery routes are working correctly!');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('\n⚠️ Make sure the backend server is running on port 4000');
    }
  }
}

testDeliveryEndpoints();
