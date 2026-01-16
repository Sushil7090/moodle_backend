// routes/activityBreakdown.js
const express = require('express');
const activityBreakdownService = require('../services/activityBreakdownService');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

/**
 * ✨ MAIN API ✨
 * GET /api/activity-breakdown
 *
 * Returns COMPLETE activity breakdown for ALL courses
 * Includes ALL student details in ALL completion ranges
 * 
 * Response Format:
 * {
 *   "success": true,
 *   "message": "Activity breakdown retrieved successfully",
 *   "data": {
 *     "summary": {
 *       "totalCourses": 9,
 *       "totalEnrolled": 56,
 *       "totalCompleted": 0,
 *       "completionRate": 0
 *     },
 *     "courses": [
 *       {
 *         "courseId": 2,
 *         "courseName": "Dharma Sastram",
 *         "shortname": "DS",
 *         "totalEnrolled": 13,
 *         "totalActivities": 45,
 *         "completionRanges": {
 *           "0-20": {
 *             "count": 12,
 *             "students": [
 *               {
 *                 "id": 45,
 *                 "name": "Rahul Sharma",
 *                 "email": "rahul@example.com",
 *                 "completedActivities": 5,
 *                 "totalActivities": 45,
 *                 "completionPercentage": 11
 *               },
 *               ...
 *             ]
 *           },
 *           "21-40": { "count": 1, "students": [...] },
 *           "41-60": { "count": 0, "students": [] },
 *           "61-80": { "count": 0, "students": [] },
 *           "81-100": { "count": 0, "students": [] }
 *         }
 *       },
 *       ...
 *     ],
 *     "metadata": {
 *       "fetchedAt": "2026-01-16T10:30:00.000Z",
 *       "fetchedBy": 123
 *     }
 *   }
 * }
 */
router.get('/', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;

    console.log(`\n[API REQUEST] Activity Breakdown for user ${userId}`);

    // Fetch complete breakdown with all data
    const data = await activityBreakdownService.getAllCoursesCompletionBreakdown(
      moodleToken,
      userId
    );

    console.log(`[API RESPONSE] Returning data for ${data.courses.length} courses`);

    sendSuccess(
      res,
      data,
      'Activity breakdown retrieved successfully'
    );

  } catch (error) {
    console.error('[API ERROR] Activity Breakdown:', error.message);
    sendError(
      res,
      'Failed to fetch activity breakdown',
      500,
      error.message
    );
  }
});

/**
 * ✨ OPTIONAL API ✨
 * GET /api/activity-breakdown/:courseId/range/:rangeKey
 *
 * Get students in a SPECIFIC completion range for a SPECIFIC course
 * Useful for lazy loading or when you only need one range
 *
 * Example: GET /api/activity-breakdown/5/range/0-20
 * 
 * Response Format:
 * {
 *   "success": true,
 *   "message": "Students in 0-20% range retrieved successfully",
 *   "data": {
 *     "courseId": 5,
 *     "courseName": "Dharma Sastram",
 *     "range": "0-20",
 *     "count": 12,
 *     "students": [
 *       {
 *         "id": 45,
 *         "name": "Rahul Sharma",
 *         "email": "rahul@example.com",
 *         "completedActivities": 5,
 *         "totalActivities": 45,
 *         "completionPercentage": 11
 *       },
 *       ...
 *     ],
 *     "totalEnrolled": 13,
 *     "totalActivities": 45
 *   }
 * }
 */
router.get('/:courseId/range/:rangeKey', async (req, res) => {
  try {
    const { moodleToken } = req.user;
    const { courseId, rangeKey } = req.params;

    console.log(`\n[API REQUEST] Range Query - Course: ${courseId}, Range: ${rangeKey}%`);

    // Validate courseId
    const courseIdNum = parseInt(courseId);
    if (isNaN(courseIdNum) || courseIdNum <= 0) {
      return sendError(res, 'Invalid course ID', 400);
    }

    // Fetch specific range data
    const data = await activityBreakdownService.getStudentsInCourseRange(
      moodleToken,
      courseIdNum,
      rangeKey
    );

    console.log(`[API RESPONSE] Found ${data.count} students in ${rangeKey}% range`);

    sendSuccess(
      res,
      data,
      `Students in ${rangeKey}% range retrieved successfully`
    );

  } catch (error) {
    console.error('[API ERROR] Range Query:', error.message);
    
    // Handle specific errors
    if (error.message.includes('Invalid range')) {
      return sendError(
        res,
        'Invalid range key. Use: 0-20, 21-40, 41-60, 61-80, or 81-100',
        400
      );
    }
    
    sendError(
      res,
      'Failed to fetch range data',
      500,
      error.message
    );
  }
});

module.exports = router;