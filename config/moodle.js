// config/moodle.js
require('dotenv').config();

module.exports = {
  moodleUrl: process.env.MOODLE_URL,
  moodleService: process.env.MOODLE_SERVICE || 'moodle_mobile_app',
  moodleToken: process.env.MOODLE_TOKEN, // ← ADD THIS LINE
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiry: process.env.JWT_EXPIRY || '24h',
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
};