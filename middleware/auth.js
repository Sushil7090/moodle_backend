// middleware/auth.js
const jwt = require('jsonwebtoken');
const config = require('../config/moodle');
const { sendError } = require('../utils/responseHandler');

/**
 * Verify JWT token and extract user data
 */
const verifyToken = (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'No token provided', 401);
    }

    const token = authHeader.split(' ')[1];

    // Verify and decode token
    const decoded = jwt.verify(token, config.jwtSecret);

    // Attach user data to request
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      moodleToken: decoded.moodleToken
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return sendError(res, 'Token expired', 401);
    }
    return sendError(res, 'Invalid token', 401);
  }
};

module.exports = {
  verifyToken
};