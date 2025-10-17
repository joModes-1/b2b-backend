const axios = require('axios');

async function testAdminCreateDelivery() {
  const API_URL = 'http://localhost:4000/api';
  
  try {
    console.log('🚚 Testing Admin Delivery Personnel Creation...\n');
    
    // Create a new delivery person via admin endpoint
    console.log('📝 Creating new delivery person via admin endpoint...');
    const createResponse = await axios.post(`${API_URL}/admin/delivery-personnel`, {
      name: 'John Delivery',
      email: 'john.delivery@test.com',
      password: 'password123',
      phoneNumber: '+256700987654',
      vehicleType: 'motorcycle',
      vehicleNumber: 'UBD 456X',
      licenseNumber: 'DL-2024-002',
      zone: 'Kampala Central'
    });
    
    console.log('✅ Delivery person created:', {
      id: createResponse.data.deliveryPerson._id,
      name: createResponse.data.deliveryPerson.name,
      email: createResponse.data.deliveryPerson.email,
      role: createResponse.data.deliveryPerson.role,
      vehicleType: createResponse.data.deliveryPerson.deliveryInfo?.vehicleType
    });
    
    // Now test login with the new account
    console.log('\n🔐 Testing login with new delivery account...');
    const loginResponse = await axios.post(`${API_URL}/delivery/login`, {
      email: 'john.delivery@test.com',
      password: 'password123'
    });
    
    console.log('✅ Login successful!');
    console.log('User:', loginResponse.data.user);
    
    // Get list of all delivery personnel
    console.log('\n📋 Getting all delivery personnel...');
    const listResponse = await axios.get(`${API_URL}/admin/delivery-personnel`);
    console.log('✅ Total delivery personnel:', listResponse.data.deliveryPersonnel.length);
    listResponse.data.deliveryPersonnel.forEach(person => {
      console.log(`  - ${person.name} (${person.email}) - ${person.deliveryInfo?.vehicleType || 'N/A'}`);
    });
    
    console.log('\n✅ Admin delivery management system is working perfectly!');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testAdminCreateDelivery();
