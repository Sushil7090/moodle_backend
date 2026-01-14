const express = require('express');
const activityBreakdownService = require('../services/activityBreakdownService');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication middleware
router.use(verifyToken);

/**
 * GET /api/activity-breakdown
 *
 * Returns activity breakdown for ALL enrolled courses
 */
router.get('/', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;

    console.log('[ACTIVITY BREAKDOWN] Fetching for all courses');

    const data =
      await activityBreakdownService.getAllCoursesActivityBreakdown(
        moodleToken,
        userId
      );

    sendSuccess(res, data, 'Activity breakdown retrieved successfully');

  } catch (error) {
    console.error('[ACTIVITY BREAKDOWN ERROR]', error.message);
    sendError(res, 'Failed to fetch activity breakdown', 500, error.message);
  }
});

module.exports = router;
