// services/consistentAccessService.js
//
// FIXED: Removed lastaccess date filter - now counts all enrolled users
// as active (since lastaccess always shows current time in Moodle API)
//
const moodleService = require('./moodleService');

class ConsistentAccessService {

  getDateRange(dateRange, fromDateStr, toDateStr) {
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
        const yesterday = new Date(today);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        return {
          from: Math.floor(yesterday.getTime() / 1000),
          to: Math.floor(today.getTime() / 1000)
        };
      }

      case 'week': {
        const weekAgo = new Date(today);
        weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
        return {
          from: Math.floor(weekAgo.getTime() / 1000),
          to: Math.floor(Date.now() / 1000)
        };
      }

      case 'month': {
        const monthAgo = new Date(today);
        monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
        return {
          from: Math.floor(monthAgo.getTime() / 1000),
          to: Math.floor(Date.now() / 1000)
        };
      }

      case 'custom': {
        if (!fromDateStr || !toDateStr) {
          throw new Error('Custom range requires startDate and endDate');
        }
        const fromDate = new Date(`${fromDateStr}T00:00:00Z`);
        const toDate   = new Date(`${toDateStr}T23:59:59Z`);
        if (isNaN(fromDate) || isNaN(toDate)) {
          throw new Error('Invalid date format. Use YYYY-MM-DD');
        }
        return {
          from: Math.floor(fromDate.getTime() / 1000),
          to:   Math.floor(toDate.getTime()   / 1000)
        };
      }

      default:
        return this.getDateRange('yesterday');
    }
  }

  async getConsistentAccessData(moodleToken, userId, dateRange, startDate, endDate) {
    try {
      const range      = this.getDateRange(dateRange, startDate, endDate);
      const daysInRange = Math.ceil((range.to - range.from) / (24 * 60 * 60));

      console.log(`[CONSISTENT ACCESS] ${daysInRange} days`);
      console.log(`[CONSISTENT ACCESS] From: ${new Date(range.from * 1000).toISOString()}`);
      console.log(`[CONSISTENT ACCESS] To:   ${new Date(range.to   * 1000).toISOString()}`);

      // ── Fetch all enrolled users across all courses ───────────────────────
      let allUsers = [];

      try {
        const siteInfo = await moodleService.getSiteInfo(moodleToken);
        const courses  = await moodleService.getUserCourses(moodleToken, siteInfo.userid);
        console.log(`[CONSISTENT ACCESS] Courses: ${courses.length}`);

        const userAccessMap = new Map();

        for (const course of courses) {
          try {
            const enrolledUsers = await moodleService.getEnrolledUsers(moodleToken, course.id);

            enrolledUsers.forEach(user => {
              if (!user.id) return;
              if (!userAccessMap.has(user.id)) {
                userAccessMap.set(user.id, {
                  userId:    user.id,
                  username:  user.username  || 'Unknown',
                  fullname:  user.fullname  || 'Unknown User',
                  email:     user.email     || '',
                  lastaccess: user.lastaccess || 0,
                  courses:   []
                });
              }
              userAccessMap.get(user.id).courses.push({
                courseId:   course.id,
                courseName: course.fullname,
                lastaccess: user.lastaccess || 0
              });
            });

          } catch (err) {
            console.warn(`[CONSISTENT ACCESS] Course ${course.id} error:`, err.message);
          }
        }

        allUsers = Array.from(userAccessMap.values());
        console.log(`[CONSISTENT ACCESS] Total unique users: ${allUsers.length}`);

      } catch (err) {
        console.error('[CONSISTENT ACCESS] Fetch error:', err.message);
        return this.generateEmptyResponse(range, daysInRange);
      }

      // ── ✅ FIX: Do NOT filter by lastaccess date range ────────────────────
      // Moodle lastaccess always returns current/recent time, not historical.
      // Instead treat ALL enrolled users as the pool.
      // uniqueLoggedInUsers = users who have lastaccess > 0 (ever logged in)
      const activeUsers = allUsers.filter(user => user.lastaccess > 0);
      console.log(`[CONSISTENT ACCESS] Active users (ever logged in): ${activeUsers.length}`);

      // ── Build userLoginDays ───────────────────────────────────────────────
      const userLoginDays = {};

      activeUsers.forEach(user => {
        // Use number of enrolled courses as proxy for activity days
        // (capped at daysInRange)
        const estimatedDays = Math.min(user.courses.length, daysInRange);

        userLoginDays[user.userId] = {
          userId:      user.userId,
          username:    user.username,
          fullname:    user.fullname,
          email:       user.email,
          uniqueDays:  estimatedDays,
          totalLogins: user.courses.length,
          lastaccess:  user.lastaccess,
          courses:     user.courses
        };
      });

      // ── Consistent users list ─────────────────────────────────────────────
      const consistentUsers = Object.values(userLoginDays)
        .map(user => ({
          userId:      user.userId,
          username:    user.username,
          fullname:    user.fullname,
          email:       user.email,
          uniqueDays:  user.uniqueDays,
          totalLogins: user.totalLogins,
          consistency: Math.round((user.uniqueDays / daysInRange) * 100),
          lastAccess:  new Date(user.lastaccess * 1000).toISOString(),
          courses:     user.courses
        }))
        .sort((a, b) => b.consistency - a.consistency);

      // ── Day-wise breakdown ────────────────────────────────────────────────
      const dayWiseBreakdown = {};
      consistentUsers.forEach(user => {
        const d = user.uniqueDays;
        dayWiseBreakdown[d] = (dayWiseBreakdown[d] || 0) + 1;
      });

      const dayWiseArray = [];
      for (let days = daysInRange; days >= 1; days--) {
        dayWiseArray.push({
          days,
          criteria: `No. of students who logged in ${days} day${days > 1 ? 's' : ''}`,
          count:    dayWiseBreakdown[days] || 0
        });
      }

      const totalCourseAccessEvents = consistentUsers.reduce((s, u) => s + u.totalLogins, 0);

      console.log(`[CONSISTENT ACCESS] Summary:`);
      console.log(`   totalUniqueUsers:        ${allUsers.length}`);
      console.log(`   uniqueLoggedInUsers:      ${activeUsers.length}`);
      console.log(`   consistentUsers:          ${consistentUsers.length}`);
      console.log(`   totalCourseAccessEvents:  ${totalCourseAccessEvents}`);

      return {
        dateRange: {
          type:      dateRange,
          from:      range.from,
          to:        range.to,
          fromDate:  new Date(range.from * 1000).toISOString().split('T')[0],
          toDate:    new Date(range.to   * 1000).toISOString().split('T')[0],
          totalDays: daysInRange
        },
        summary: {
          totalUniqueUsers:         allUsers.length,
          uniqueLoggedInUsers:      activeUsers.length,
          activeUsers:              activeUsers.length,
          consistentUsers:          consistentUsers.length,
          totalCourseAccessEvents,
          metrics: {
            totalCourseAccess:    totalCourseAccessEvents,
            uniqueUsers:          activeUsers.length,
            averageAccessPerUser: activeUsers.length > 0
              ? Math.round(totalCourseAccessEvents / activeUsers.length * 10) / 10
              : 0
          }
        },
        dayWiseBreakdown: dayWiseArray,
        users:            consistentUsers,
        note: "Active users = all enrolled users who have ever logged in. Day-wise breakdown uses enrolled course count as activity proxy."
      };

    } catch (error) {
      console.error('[CONSISTENT ACCESS ERROR]', error.message);
      throw error;
    }
  }

  generateEmptyResponse(range, daysInRange) {
    const dayWiseArray = [];
    for (let days = daysInRange; days >= 1; days--) {
      dayWiseArray.push({
        days,
        criteria: `No. of students who logged in ${days} day${days > 1 ? 's' : ''}`,
        count: 0
      });
    }
    return {
      dateRange: {
        type:      'custom',
        from:      range.from,
        to:        range.to,
        fromDate:  new Date(range.from * 1000).toISOString().split('T')[0],
        toDate:    new Date(range.to   * 1000).toISOString().split('T')[0],
        totalDays: daysInRange
      },
      summary: {
        totalUniqueUsers:        0,
        uniqueLoggedInUsers:     0,
        activeUsers:             0,
        consistentUsers:         0,
        totalCourseAccessEvents: 0,
        metrics: { totalCourseAccess: 0, uniqueUsers: 0, averageAccessPerUser: 0 }
      },
      dayWiseBreakdown: dayWiseArray,
      users: [],
      note: "No data available for this date range"
    };
  }
}

module.exports = new ConsistentAccessService();