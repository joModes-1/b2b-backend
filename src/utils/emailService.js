const nodemailer = require('nodemailer');

// Create a default transporter using environment variables
const allowSelfSigned = process.env.SMTP_ALLOW_SELF_SIGNED === 'true';
const defaultTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  ...(allowSelfSigned ? { tls: { rejectUnauthorized: false } } : {}),
});

/**
 * Send an email.
 * @param {string|string[]} to - Recipient email or list.
 * @param {string} subject - Subject line.
 * @param {string} body - Plain text body (keep simple to avoid spam flags). 
 * @param {Object} [options] - Optional overrides.
 * @param {string} [options.from] - Override the From header. Defaults to process.env.SMTP_FROM.
 * @param {string} [options.replyTo] - Optional Reply-To header.
 * @param {Object} [options.smtp] - Optional SMTP config to use a different transporter for this message only.
 */
exports.sendEmail = async (to, subject, body, options = {}) => {
  try {
    const mailOptions = {
      from: options.from || process.env.SMTP_FROM,
      to,
      subject,
      text: body,
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    };

    // If per-message SMTP overrides are provided (e.g., multi-tenant), use a transient transporter
    if (options.smtp) {
      const tempTransporter = nodemailer.createTransport({
        host: options.smtp.host,
        port: options.smtp.port,
        secure: !!options.smtp.secure,
        auth: options.smtp.auth,
        ...(options.smtp.tls ? { tls: options.smtp.tls } : {}),
      });
      await tempTransporter.sendMail(mailOptions);
    } else {
      await defaultTransporter.sendMail(mailOptions);
    }

    console.log('Email sent successfully to:', to);
  } catch (error) {
    console.error('Error sending email:', error);
    // Intentionally do not throw to avoid interrupting primary flows
  }
};
 