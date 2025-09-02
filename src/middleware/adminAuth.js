const { verifyToken } = require('./auth');

// No-op admin middleware: allow everyone to pass through
const isAdmin = (req, res, next) => {
  // Intentionally bypass token verification and role checks
  return next();
};

module.exports = { isAdmin };