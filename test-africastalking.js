// Minimal script to test Africa's Talking SMS credentials
require('dotenv').config();
const axios = require('axios');

const username = process.env.AFRICAS_TALKING_USERNAME;
const apiKey = process.env.AFRICAS_TALKING_API_KEY;

const testPhone = '+256706965418'; // Use your own test number if desired
const message = 'Africa\'s Talking API key test!';

async function testAfricasTalking() {
  try {
    const res = await axios.post(
      'https://api.sandbox.africastalking.com/version1/messaging',
      new URLSearchParams({
        username,
        to: testPhone,
        message,
        from: 'MyB2B',
        bulkSMSMode: 1
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          apikey: apiKey
        }
      }
    );
    console.log('Africa\'s Talking response:', res.data);
  } catch (err) {
    if (err.response) {
      console.error('Africa\'s Talking error:', err.response.status, err.response.data);
    } else {
      console.error('Request error:', err.message);
    }
  }
}

testAfricasTalking();
