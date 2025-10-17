require('dotenv').config();
const admin = require('./src/config/firebaseAdmin');

async function testFirebaseUserCreation() {
  console.log('Testing Firebase user creation...\n');
  
  const testData = {
    email: `test${Date.now()}@example.com`,
    password: 'Test123456',
    phoneNumber: `+25670${Math.floor(Math.random() * 10000000)}`,
    displayName: 'Test User'
  };
  
  console.log('Test data:', testData);
  console.log('Field lengths:');
  console.log('- email:', testData.email.length);
  console.log('- password:', testData.password.length);
  console.log('- phoneNumber:', testData.phoneNumber.length);
  console.log('- displayName:', testData.displayName.length);
  
  try {
    const user = await admin.auth().createUser(testData);
    console.log('\nSuccess! Created user:', user.uid);
    
    // Clean up
    await admin.auth().deleteUser(user.uid);
    console.log('Cleaned up test user');
  } catch (error) {
    console.error('\nError creating user:');
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    if (error.errorInfo) {
      console.error('Error Info:', JSON.stringify(error.errorInfo, null, 2));
    }
  }
  
  process.exit(0);
}

testFirebaseUserCreation();
