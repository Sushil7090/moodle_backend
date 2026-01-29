// routes/activityBreakdown.js - UPDATED FOR ACTIVITY COUNT BASED RANGES
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
 *       "fullyCompleted": 5,
 *       "completionRate": 8.93
 *     },
 *     "courses": [
 *       {
 *         "courseId": 2,
 *         "courseName": "Dharma Sastram",
 *         "shortname": "DS",
 *         "totalEnrolled": 13,
 *         "totalActivitiesWithCompletion": 12,
 *         "completionRanges": {
 *           "0": {
 *             "count": 5,
 *             "label": "0 activities completed",
 *             "students": [
 *               {
 *                 "id": 45,
 *                 "name": "Rahul Sharma",
 *                 "email": "rahul@example.com",
 *                 "completedActivities": 0,
 *                 "totalActivities": 12,
 *                 "displayText": "0/12 activities"
 *               },
 *               ...
 *             ]
 *           },
 *           "low": {
 *             "count": 8,
 *             "label": "1-25% completed",
 *             "students": [
 *               {
 *                 "id": 46,
 *                 "name": "Priya Patel",
 *                 "email": "priya@example.com",
 *                 "completedActivities": 2,
 *                 "totalActivities": 12,
 *                 "displayText": "2/12 activities"
 *               },
 *               ...
 *             ]
 *           },
 *           "mid": { "count": 4, "label": "25-50% completed", "students": [...] },
 *           "high": { "count": 2, "label": "50-75% completed", "students": [...] },
 *           "veryhigh": { "count": 1, "label": "75-99% completed", "students": [...] },
 *           "full": { "count": 1, "label": "All activities completed", "students": [...] }
 *         }
 *       },
 *       ...
 *     ],
 *     "metadata": {
 *       "fetchedAt": "2026-01-27T10:30:00.000Z",
 *       "fetchedBy": 2,
 *       "note": "Activity count based breakdown. Display shows X/Y activities."
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
 * Example: GET /api/activity-breakdown/5/range/low
 * 
 * Valid range keys:
 * - 0: No activities completed
 * - low: 1-25% completed
 * - mid: 25-50% completed
 * - high: 50-75% completed
 * - veryhigh: 75-99% completed
 * - full: All activities completed
 * 
 * Response Format:
 * {
 *   "success": true,
 *   "message": "Students in low range retrieved successfully",
 *   "data": {
 *     "courseId": 5,
 *     "courseName": "Dharma Sastram",
 *     "range": "low",
 *     "rangeLabel": "1-25% completed",
 *     "count": 8,
 *     "students": [
 *       {
 *         "id": 45,
 *         "name": "Rahul Sharma",
 *         "email": "rahul@example.com",
 *         "completedActivities": 2,
 *         "totalActivities": 12,
 *         "displayText": "2/12 activities"
 *       },
 *       ...
 *     ],
 *     "totalEnrolled": 13,
 *     "totalActivitiesWithCompletion": 12
 *   }
 * }
 */
router.get('/:courseId/range/:rangeKey', async (req, res) => {
  try {
    const { moodleToken } = req.user;
    const { courseId, rangeKey } = req.params;

    console.log(`\n[API REQUEST] Range Query - Course: ${courseId}, Range: ${rangeKey}`);

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

    console.log(`[API RESPONSE] Found ${data.count} students in "${rangeKey}" range`);

    sendSuccess(
      res,
      data,
      `Students in "${data.rangeLabel}" retrieved successfully`
    );

  } catch (error) {
    console.error('[API ERROR] Range Query:', error.message);
    
    // Handle specific errors
    if (error.message.includes('Invalid range')) {
      return sendError(
        res,
        'Invalid range key. Use: 0, low, mid, high, veryhigh, or full',
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