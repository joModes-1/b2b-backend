const nodemailer = require('nodemailer');

// Create a transporter using environment variables
const allowSelfSigned = process.env.SMTP_ALLOW_SELF_SIGNED === 'true';
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  // Allow opting-in to self-signed certs for local/dev environments behind proxies
  ...(allowSelfSigned ? { tls: { rejectUnauthorized: false } } : {})
});

// Send email function
exports.sendEmail = async (to, subject, body) => {
  try {
    const mailOptions = {
      from: process.env.SMTP_FROM,
      to,
      subject,
      text: body
    };

    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully to:', to);
  } catch (error) {
    console.error('Error sending email:', error);
    // Don't throw the error to prevent it from breaking the main flow
    // Just log it for monitoring
  }
}; 