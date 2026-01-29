// routes/analytics.js - MINIMAL FIX FOR UNIQUE USERS
const express = require('express');
const moodleService = require('../services/moodleService');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

/**
 * Helper: Get date range timestamps (UTC-safe)
 */
function getDateRange(dateRange, fromDateStr, toDateStr) {
  const now = new Date();
  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));

  switch (dateRange) {
    case 'today':
      return {
        from: Math.floor(today.getTime() / 1000),
        to: Math.floor(Date.now() / 1000)
      };

    case 'yesterday': {
      const y = new Date(today);
      y.setUTCDate(y.getUTCDate() - 1);
      return {
        from: Math.floor(y.getTime() / 1000),
        to: Math.floor(today.getTime() / 1000)
      };
    }

    case 'week': {
      const w = new Date(today);
      w.setUTCDate(w.getUTCDate() - 7);
      return {
        from: Math.floor(w.getTime() / 1000),
        to: Math.floor(Date.now() / 1000)
      };
    }

    case 'custom': {
      if (!fromDateStr || !toDateStr) {
        throw new Error('Custom range requires startDate and endDate');
      }

      const fromDate = new Date(`${fromDateStr}T00:00:00Z`);
      const toDate = new Date(`${toDateStr}T23:59:59Z`);

      if (isNaN(fromDate) || isNaN(toDate)) {
        throw new Error('Invalid date format (YYYY-MM-DD)');
      }

      return {
        from: Math.floor(fromDate.getTime() / 1000),
        to: Math.floor(toDate.getTime() / 1000)
      };
    }

    default:
      return getDateRange('yesterday');
  }
}

/**
 * GET /api/analytics/dashboard
 * ✅ FIXED: Now correctly tracks total logins AND unique users
 */
router.get('/dashboard', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;

    const {
      dateRange = 'yesterday',
      from,
      to,
      startDate,
      endDate
    } = req.query;

    // ✅ Support both frontend & backend param names
    const finalFrom = from || startDate;
    const finalTo = to || endDate;

    const range = getDateRange(dateRange, finalFrom, finalTo);

    // 1️⃣ Get user courses
    const courses = await moodleService.getUserCourses(moodleToken, userId);

    // 2️⃣ ✅ FIXED: Get REAL login data (not course access)
    let totalLogins = 0;
    let uniqueUsers = 0;
    
    try {
      const loginLogs = await moodleService.getLoginLogs(
        moodleToken,
        range.from,
        range.to
      );
      
      // ✅ Total login events (including repeated logins)
      totalLogins = loginLogs.length;
      
      // ✅ Unique users (deduplicated)
      uniqueUsers = new Set(loginLogs.map(l => l.userid)).size;
      
      console.log(`[ANALYTICS] Total Logins: ${totalLogins}, Unique Users: ${uniqueUsers}`);
      
    } catch (error) {
      console.warn('[ANALYTICS] Login logs unavailable:', error.message);
      totalLogins = 0;
      uniqueUsers = 0;
    }

    // 3️⃣ REAL Enrollments
    let enrollments = [];
    try {
      enrollments = await moodleService.getUserEnrollments(
        moodleToken,
        userId
      );
    } catch {
      enrollments = courses.map(c => ({ timecreated: c.timecreated }));
    }

    const newEnrollments = enrollments.filter(e =>
      e.timecreated >= range.from && e.timecreated <= range.to
    ).length;

    // 4️⃣ Completion Rate
    const completionResults = await Promise.all(
      courses.map(c =>
        moodleService
          .getCourseCompletion(moodleToken, c.id, userId)
          .catch(() => null)
      )
    );

    const completedCourses = completionResults.filter(
      c => c?.completionstatus?.completed
    ).length;

    const completionRate = courses.length
      ? Math.round((completedCourses / courses.length) * 100)
      : 0;

    // 5️⃣ Daily Activity
    const dailyActivity = await getDailyActivity(
      moodleToken,
      userId,
      courses,
      range.from,
      range.to
    );

    // ✅ FIXED RESPONSE
    sendSuccess(res, {
      overview: {
        totalLogins,      // ✅ Total login events
        uniqueUsers,      // ✅ Unique users
        newEnrollments,
        completionRate
      },
      dailyActivity,
      courses: courses.map((c, i) => ({
        id: c.id,
        name: c.fullname,
        progress: c.progress || 0,
        completed: completionResults[i]?.completionstatus?.completed || false,
        enrolledDate: c.timecreated
      })),
      dateRange: {
        type: dateRange,
        from: range.from,
        to: range.to,
        fromDate: new Date(range.from * 1000).toISOString().split('T')[0],
        toDate: new Date(range.to * 1000).toISOString().split('T')[0]
      }
    }, 'Dashboard data retrieved successfully');

  } catch (error) {
    console.error('[DASHBOARD ERROR]', error.message);
    sendError(res, 'Failed to load dashboard', 500, error.message);
  }
});

/**
 * Helper: Daily Activity
 */
async function getDailyActivity(moodleToken, userId, courses, from, to) {
  const activity = {};

  courses.forEach(c => {
    if (c.timecreated >= from && c.timecreated <= to) {
      const d = new Date(c.timecreated * 1000).toISOString().split('T')[0];
      activity[d] ??= { enrollments: 0, completions: 0, activeUsers: 0 };
      activity[d].enrollments++;
      activity[d].activeUsers = 1;
    }
  });

  const completions = await Promise.all(
    courses.map(c =>
      moodleService
        .getCourseCompletion(moodleToken, c.id, userId)
        .catch(() => null)
    )
  );

  completions.forEach(c => {
    const t = c?.completionstatus?.timecompleted;
    if (t && t >= from && t <= to) {
      const d = new Date(t * 1000).toISOString().split('T')[0];
      activity[d] ??= { enrollments: 0, completions: 0, activeUsers: 0 };
      activity[d].completions++;
    }
  });

  return Object.entries(activity).map(([date, v]) => ({
    date,
    activeUsers: v.activeUsers,
    enrollments: v.enrollments,
    completions: v.completions
  }));
}

module.exports = router;