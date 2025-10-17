const axios = require('axios');

async function testDeliveryLogin() {
  try {
    console.log('Testing delivery login...');
    const response = await axios.post('http://localhost:4000/api/delivery/login', {
      email: 'delivery@test.com',
      password: 'password123'
    });
    
    console.log('✅ Login successful!');
    console.log('Token:', response.data.token);
    console.log('User:', response.data.user);
  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message);
  }
}

testDeliveryLogin();
