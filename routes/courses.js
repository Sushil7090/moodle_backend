// routes/courses.js
const express = require('express');
const moodleService = require('../services/moodleService');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication middleware to all routes
router.use(verifyToken);

/**
 * GET /api/courses
 * Get all user's courses with completion data
 */
router.get('/', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;

    console.log(`[COURSES] Fetching courses for user ID: ${userId}`);

    // Fetch user's courses from Moodle
    const courses = await moodleService.getUserCourses(moodleToken, userId);

    // Get completion data for each course
    const coursesWithCompletion = await Promise.all(
      courses.map(async (course) => {
        try {
          const completion = await moodleService.getCourseCompletion(
            moodleToken,
            course.id,
            userId
          );

          return {
            id: course.id,
            fullname: course.fullname,
            shortname: course.shortname,
            summary: course.summary || '',
            categoryname: course.categoryname || '',
            progress: course.progress || 0,
            completed: completion.completionstatus?.completed || false,
            timecreated: course.timecreated,
            timemodified: course.timemodified
          };
        } catch (error) {
          console.error(
            `[COURSES] Error getting completion for course ${course.id}:`,
            error.message
          );
          // Return course without completion data
          return {
            id: course.id,
            fullname: course.fullname,
            shortname: course.shortname,
            summary: course.summary || '',
            categoryname: course.categoryname || '',
            progress: course.progress || 0,
            completed: false,
            timecreated: course.timecreated,
            timemodified: course.timemodified
          };
        }
      })
    );

    console.log(`[COURSES] Found ${coursesWithCompletion.length} courses`);

    sendSuccess(res, { courses: coursesWithCompletion }, 'Courses retrieved successfully');
  } catch (error) {
    console.error('[COURSES ERROR]', error.message);
    sendError(res, 'Failed to fetch courses', 500, error.message);
  }
});

/**
 * GET /api/courses/:id
 * Get specific course details
 */
router.get('/:id', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;
    const courseId = req.params.id;

    console.log(`[COURSE DETAILS] Fetching course ${courseId} for user ${userId}`);

    // Fetch course data in parallel
    const [completion, activities, contents] = await Promise.all([
      moodleService.getCourseCompletion(moodleToken, courseId, userId),
      moodleService.getActivitiesCompletion(moodleToken, courseId, userId),
      moodleService.getCourseContents(moodleToken, courseId)
    ]);

    sendSuccess(
      res,
      {
        courseId,
        completion,
        activities,
        contents
      },
      'Course details retrieved successfully'
    );
  } catch (error) {
    console.error('[COURSE DETAILS ERROR]', error.message);
    sendError(res, 'Failed to fetch course details', 500, error.message);
  }
});

/**
 * GET /api/courses/:id/completion
 * Get detailed completion data for a course
 */
router.get('/:id/completion', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;
    const courseId = req.params.id;

    const activities = await moodleService.getActivitiesCompletion(
      moodleToken,
      courseId,
      userId
    );

    sendSuccess(res, { activities }, 'Course completion retrieved successfully');
  } catch (error) {
    console.error('[COURSE COMPLETION ERROR]', error.message);
    sendError(res, 'Failed to fetch course completion', 500, error.message);
  }
});

module.exports = router;