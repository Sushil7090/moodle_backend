// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const moodleService = require('../services/moodleService');
const config = require('../config/moodle');
const { sendSuccess, sendError } = require('../utils/responseHandler');

const router = express.Router();

/**
 * POST /api/auth/login
 * Login with Moodle credentials
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validation
    if (!username || !password) {
      return sendError(res, 'Username and password are required', 400);
    }

    console.log(`[LOGIN] Attempting login for user: ${username}`);

    // Step 1: Get Moodle token
    const moodleToken = await moodleService.getMoodleToken(username, password);
    console.log(`[LOGIN] Moodle token received for user: ${username}`);

    // Step 2: Get user info from Moodle
    const userInfo = await moodleService.getSiteInfo(moodleToken);
    console.log(`[LOGIN] User info received: ${userInfo.fullname}`);

    // Step 3: Create JWT token
    const jwtToken = jwt.sign(
      {
        userId: userInfo.userid,
        username: userInfo.username,
        moodleToken: moodleToken
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiry }
    );

    // Step 4: Send response
    sendSuccess(
      res,
      {
        token: jwtToken,
        user: {
          id: userInfo.userid,
          username: userInfo.username,
          fullname: userInfo.fullname,
          email: userInfo.email,
          firstname: userInfo.firstname,
          lastname: userInfo.lastname
        }
      },
      'Login successful',
      200
    );

    console.log(`[LOGIN] Login successful for user: ${username}`);
  } catch (error) {
    console.error(`[LOGIN ERROR] ${error.message}`);

    // Handle specific error types
    if (error.message.includes('invalidlogin')) {
      return sendError(res, 'Invalid username or password', 401);
    }

    if (error.message.includes('connect')) {
      return sendError(
        res,
        'Cannot connect to Moodle server. Please check configuration.',
        503
      );
    }

    sendError(res, 'Login failed', 500, error.message);
  }
});

/**
 * POST /api/auth/logout
 * Logout (client-side token removal)
 */
router.post('/logout', (req, res) => {
  sendSuccess(res, null, 'Logout successful');
});

/**
 * GET /api/auth/verify
 * Verify JWT token validity
 */
router.get('/verify', (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, 'No token provided', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwtSecret);

    sendSuccess(
      res,
      {
        valid: true,
        userId: decoded.userId,
        username: decoded.username
      },
      'Token is valid'
    );
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return sendError(res, 'Token expired', 401);
    }
    sendError(res, 'Invalid token', 401);
  }
});

module.exports = router;