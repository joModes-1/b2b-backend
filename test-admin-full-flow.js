const axios = require('axios');

async function testFullAdminDeliveryFlow() {
  const API_URL = 'http://localhost:4000/api';
  
  try {
    console.log('🧪 Testing Complete Admin -> Delivery Login Flow\n');
    
    // Generate unique email for this test
    const testEmail = `delivery.test.${Date.now()}@test.com`;
    const testPassword = 'TestPass123!';
    
    // Step 1: Create account via admin
    console.log('1️⃣ Creating delivery account via admin endpoint...');
    console.log(`   Email: ${testEmail}`);
    console.log(`   Password: ${testPassword}`);
    
    const createResponse = await axios.post(`${API_URL}/admin/delivery-personnel`, {
      name: 'Test Driver',
      email: testEmail,
      password: testPassword,
      phoneNumber: `+2567${Date.now().toString().slice(-8)}`,
      vehicleType: 'motorcycle',
      vehicleNumber: 'TEST 123',
      licenseNumber: 'DL-TEST-001',
      zone: 'Test Zone'
    });
    
    if (createResponse.data.success) {
      console.log('✅ Account created successfully');
      console.log('   ID:', createResponse.data.deliveryPerson._id);
      console.log('   Role:', createResponse.data.deliveryPerson.role);
    }
    
    // Step 2: Login with the created account
    console.log('\n2️⃣ Attempting login with created account...');
    
    try {
      const loginResponse = await axios.post(`${API_URL}/delivery/login`, {
        email: testEmail,
        password: testPassword
      });
      
      console.log('✅ Login successful!');
      console.log('   Token received:', loginResponse.data.token ? 'Yes' : 'No');
      console.log('   User data:', loginResponse.data.user);
      
      // Step 3: Test protected endpoints
      const token = loginResponse.data.token;
      const headers = { 'Authorization': `Bearer ${token}` };
      
      console.log('\n3️⃣ Testing protected endpoints...');
      
      // Test stats
      const statsResponse = await axios.get(`${API_URL}/delivery/stats`, { headers });
      console.log('✅ Stats endpoint working:', statsResponse.data);
      
      // Test profile
      const profileResponse = await axios.get(`${API_URL}/delivery/profile`, { headers });
      console.log('✅ Profile endpoint working:', {
        name: profileResponse.data.name,
        email: profileResponse.data.email,
        role: profileResponse.data.role
      });
      
      console.log('\n🎉 SUCCESS! Admin-created accounts can login and access protected routes!');
      
    } catch (loginError) {
      console.error('❌ Login failed:', loginError.response?.data || loginError.message);
      console.log('\n⚠️ Debug info:');
      console.log('   - Check if password is being hashed in admin route');
      console.log('   - Check if User model has password field');
      console.log('   - Check bcrypt comparison in login route');
    }
    
  } catch (error) {
    console.error('❌ Error in test:', error.response?.data || error.message);
  }
}

// Run the test
testFullAdminDeliveryFlow();
