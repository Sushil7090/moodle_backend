// routes/activityBreakdown.js
const express = require('express');
const activityBreakdownService = require('../services/activityBreakdownService');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

/**
 * GET /api/activity-breakdown
 *
 * Returns class-wise Video + PDF completion for ALL courses.
 *
 * Response example:
 * {
 *   "success": true,
 *   "data": {
 *     "summary": {
 *       "totalCourses": 5,
 *       "totalEnrolled": 480,
 *       "totalVideoCompletions": 1200,
 *       "totalPdfCompletions": 980
 *     },
 *     "courses": [
 *       {
 *         "courseId": 2,
 *         "courseName": "Upasana Sastram",
 *         "shortname": "US",
 *         "totalEnrolled": 479,
 *         "totalClasses": 8,
 *         "summary": {
 *           "totalVideoCompletions": 340,
 *           "totalPdfCompletions": 290,
 *           "totalClasses": 8
 *         },
 *         "classes": [
 *           {
 *             "className": "US Class - 001",
 *             "videoCompleted": 85,
 *             "pdfCompleted": 72,
 *             "bothCompleted": 68,
 *             "eitherCompleted": 89,
 *             "totalEnrolled": 479
 *           },
 *           {
 *             "className": "US Class - 002",
 *             "videoCompleted": 60,
 *             "pdfCompleted": 55,
 *             "bothCompleted": 50,
 *             "eitherCompleted": 65,
 *             "totalEnrolled": 479
 *           }
 *         ]
 *       }
 *     ],
 *     "metadata": {
 *       "fetchedAt": "2026-02-16T10:00:00.000Z",
 *       "fetchedBy": 2
 *     }
 *   }
 * }
 */
router.get('/', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;
    console.log(`\n[API] Activity Breakdown → user ${userId}`);

    const data = await activityBreakdownService.getAllCoursesCompletionBreakdown(
      moodleToken,
      userId
    );

    sendSuccess(res, data, 'Activity breakdown retrieved successfully');
  } catch (error) {
    console.error('[API ERROR] Activity Breakdown:', error.message);
    sendError(res, 'Failed to fetch activity breakdown', 500, error.message);
  }
});

/**
 * GET /api/activity-breakdown/:courseId
 *
 * Returns class-wise breakdown for ONE specific course.
 */
router.get('/:courseId', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;
    const courseId = parseInt(req.params.courseId);

    if (isNaN(courseId) || courseId <= 0) {
      return sendError(res, 'Invalid course ID', 400);
    }

    console.log(`\n[API] Single Course Breakdown → courseId ${courseId}`);

    const data = await activityBreakdownService.getSingleCourseCompletionBreakdown(
      moodleToken,
      courseId,
      userId
    );

    sendSuccess(res, data, `Breakdown for "${data.courseName}" retrieved successfully`);
  } catch (error) {
    console.error('[API ERROR] Single Course Breakdown:', error.message);
    sendError(res, 'Failed to fetch course breakdown', 500, error.message);
  }
});

module.exports = router;