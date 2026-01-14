// routes/consistentAccess.js
const express = require('express');
const consistentAccessService = require('../services/consistentAccessService');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

/**
 * GET /api/consistent-access
 * 
 * Query Parameters:
 * - dateRange: 'today' | 'yesterday' | 'week' | 'month' | 'custom'
 * - startDate: 'YYYY-MM-DD' (required for custom)
 * - endDate: 'YYYY-MM-DD' (required for custom)
 * 
 * Returns: Users who logged in continuously in the date range
 */
router.get('/', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;
    const { dateRange = 'yesterday', startDate, endDate } = req.query;

    console.log(`[CONSISTENT ACCESS] Fetching for range: ${dateRange}`);

    const data = await consistentAccessService.getConsistentAccessData(
      moodleToken,
      userId,
      dateRange,
      startDate,
      endDate
    );

    sendSuccess(res, data, 'Consistent access data retrieved successfully');

  } catch (error) {
    console.error('[CONSISTENT ACCESS ERROR]', error.message);
    sendError(res, 'Failed to fetch consistent access data', 500, error.message);
  }
});

module.exports = router;