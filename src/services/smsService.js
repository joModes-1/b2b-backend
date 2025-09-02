const Africastalking = require('africastalking')({
  apiKey: process.env.AFRICAS_TALKING_API_KEY,
  username: process.env.AFRICAS_TALKING_USERNAME,
});

const IS_TEST_MODE = process.env.TEST_MODE === 'true';
const sms = IS_TEST_MODE ? null : Africastalking.SMS;

async function sendSMS(to, message) {
  // Validate phone number format: must start with '+' and have 10-15 digits
  if (!/^\+\d{10,15}$/.test(to)) {
    throw new Error('Phone number must be in international format, e.g. +2547xxxxxxx');
  }
  // In TEST_MODE, do not call external provider
  if (IS_TEST_MODE) {
    console.log('[TEST_MODE] Mock send SMS to:', to, 'message:', message);
    return { status: 'mocked', to, message };
  }
  try {
    console.log('Sending SMS to:', to, 'with message:', message);
    // Use environment variable for Sender ID. Set SMS_SENDER_ID in your .env file to an approved numeric or alphanumeric value.
    const senderId = process.env.SMS_SENDER_ID || '';
    const result = await sms.send({
      to: [to],
      message: message,
      from: senderId // Sender ID must be approved by your SMS provider
    });
    console.log('SMS sent:', result);
    return result;
  } catch (err) {
    console.error('SMS failed:', err);
    throw err;
  }
}

function generateVerificationCode() {
  // Generate a 6-digit random number
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationCode(phoneNumber) {
  const code = generateVerificationCode();
  const message = `Your verification code is: ${code}. It will expire in 10 minutes.`;
  
  await sendSMS(phoneNumber, message);
  return code;
}

module.exports = {
  sendSMS,
  generateVerificationCode,
  sendVerificationCode
};
