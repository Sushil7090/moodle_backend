// services/consistentAccessService.js
// 
// NOTE: This service does NOT track authentication logins.
// Login metrics are handled in routes/analytics.js using Moodle login logs.
// This service tracks course access and learning activity consistency only.
//
const moodleService = require('./moodleService');

class ConsistentAccessService {
  /**
   * Get date range in Unix timestamps
   */
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
        const toDate = new Date(`${toDateStr}T23:59:59Z`);

        if (isNaN(fromDate) || isNaN(toDate)) {
          throw new Error('Invalid date format. Use YYYY-MM-DD');
        }

        return {
          from: Math.floor(fromDate.getTime() / 1000),
          to: Math.floor(toDate.getTime() / 1000)
        };
      }

      default:
        return this.getDateRange('yesterday');
    }
  }

  /**
   * ✅ UPDATED: Get consistent access data with UNIQUE USERS tracking
   */
  async getConsistentAccessData(moodleToken, userId, dateRange, startDate, endDate) {
    try {
      // Get date range
      const range = this.getDateRange(dateRange, startDate, endDate);

      // Calculate days in range
      const daysInRange = Math.ceil((range.to - range.from) / (24 * 60 * 60));

      console.log(`[CONSISTENT ACCESS] Fetching data for ${daysInRange} days`);
      console.log(`[CONSISTENT ACCESS] From: ${new Date(range.from * 1000).toISOString()}`);
      console.log(`[CONSISTENT ACCESS] To: ${new Date(range.to * 1000).toISOString()}`);

      // Get all site users
      let allUsers = [];
      // NOTE: Login events NOT tracked here - see routes/analytics.js for real login data
      
      try {
        const siteInfo = await moodleService.getSiteInfo(moodleToken);
        
        // Get all courses
        const courses = await moodleService.getUserCourses(moodleToken, siteInfo.userid);
        
        console.log(`[CONSISTENT ACCESS] Found ${courses.length} courses`);

        // For each course, get enrolled users with their last access
        const userAccessMap = new Map();

        for (const course of courses) {
          try {
            // Get course enrolled users
            const enrolledUsers = await moodleService.getEnrolledUsers(moodleToken, course.id);
            
            enrolledUsers.forEach(user => {
              if (!userAccessMap.has(user.id)) {
                userAccessMap.set(user.id, {
                  userId: user.id,
                  username: user.username || 'Unknown',
                  fullname: user.fullname || 'Unknown User',
                  email: user.email || '',
                  lastaccess: user.lastaccess || 0,
                  courses: []
                  // NOTE: loginCount removed - not tracking authentication logins
                });
              }
              
              // Add course info
              userAccessMap.get(user.id).courses.push({
                courseId: course.id,
                courseName: course.fullname,
                lastaccess: user.lastaccess || 0
              });
            });
          } catch (error) {
            console.warn(`[CONSISTENT ACCESS] Could not fetch users for course ${course.id}:`, error.message);
          }
        }

        allUsers = Array.from(userAccessMap.values());
        
        console.log(`[CONSISTENT ACCESS] Total unique users found: ${allUsers.length}`);

      } catch (error) {
        console.error('[CONSISTENT ACCESS] Error fetching users:', error.message);
        return this.generateEmptyResponse(range, daysInRange);
      }

      // Filter users who accessed within the date range
      const activeUsers = allUsers.filter(user => {
        return user.lastaccess >= range.from && user.lastaccess <= range.to;
      });

      console.log(`[CONSISTENT ACCESS] Unique active users in range: ${activeUsers.length}`);

      // Calculate consistency metrics
      const userLoginDays = {};

      activeUsers.forEach(user => {
        // Estimate activity days based on enrolled courses
        const estimatedDays = Math.min(
          user.courses.length,
          daysInRange
        );

        userLoginDays[user.userId] = {
          userId: user.userId,
          username: user.username,
          fullname: user.fullname,
          email: user.email,
          uniqueDays: estimatedDays,
          totalLogins: user.courses.length, // Course access count (NOT auth logins)
          lastaccess: user.lastaccess,
          courses: user.courses
        };
      });

      // Calculate consistency
      const consistentUsers = Object.values(userLoginDays)
        .map(user => ({
          userId: user.userId,
          username: user.username,
          fullname: user.fullname,
          email: user.email,
          uniqueDays: user.uniqueDays,
          totalLogins: user.totalLogins,
          consistency: Math.round((user.uniqueDays / daysInRange) * 100),
          lastAccess: new Date(user.lastaccess * 1000).toISOString(),
          courses: user.courses
        }))
        .sort((a, b) => b.consistency - a.consistency);

      // Calculate day-wise breakdown
      const dayWiseBreakdown = {};
      
      consistentUsers.forEach(user => {
        const daysCount = user.uniqueDays;
        if (!dayWiseBreakdown[daysCount]) {
          dayWiseBreakdown[daysCount] = 0;
        }
        dayWiseBreakdown[daysCount]++;
      });

      // Create array for all days
      const dayWiseArray = [];
      for (let days = daysInRange; days >= 1; days--) {
        dayWiseArray.push({
          days: days,
          criteria: `No. of students who logged in ${days} day${days > 1 ? 's' : ''}`,
          count: dayWiseBreakdown[days] || 0
        });
      }

      // ✅ Calculate course access events (NOT authentication logins)
      const totalCourseAccessEvents = consistentUsers.reduce((sum, u) => sum + u.totalLogins, 0);

      console.log(`[CONSISTENT ACCESS] Summary:`);
      console.log(`   Total Users: ${allUsers.length}`);
      console.log(`   Unique Active Users: ${activeUsers.length}`);
      console.log(`   Total Course Access Events: ${totalCourseAccessEvents}`);
      console.log(`   Consistent Users: ${consistentUsers.length}`);

      return {
        dateRange: {
          type: dateRange,
          from: range.from,
          to: range.to,
          fromDate: new Date(range.from * 1000).toISOString().split('T')[0],
          toDate: new Date(range.to * 1000).toISOString().split('T')[0],
          totalDays: daysInRange
        },
        summary: {
          totalUniqueUsers: allUsers.length,              // All users in system
          uniqueLoggedInUsers: activeUsers.length,        // Unique users with activity
          activeUsers: activeUsers.length,                // Keep for backward compatibility
          consistentUsers: consistentUsers.length,        // Users with high consistency
          totalCourseAccessEvents: totalCourseAccessEvents, // Course access count (NOT login events)
          
          // ✅ Metrics breakdown (course activity, NOT authentication)
          metrics: {
            totalCourseAccess: totalCourseAccessEvents,   // Course access events
            uniqueUsers: activeUsers.length,              // Unique active users
            averageAccessPerUser: activeUsers.length > 0 
              ? Math.round(totalCourseAccessEvents / activeUsers.length * 10) / 10 
              : 0
          }
        },
        dayWiseBreakdown: dayWiseArray,
        users: consistentUsers,
        note: "Data based on course enrollments and last access times. Metrics show course activity patterns, not authentication login events. For real login data, see analytics dashboard."
      };

    } catch (error) {
      console.error('[CONSISTENT ACCESS ERROR]', error.message);
      throw error;
    }
  }

  /**
   * Generate empty response structure
   */
  generateEmptyResponse(range, daysInRange) {
    const dayWiseArray = [];
    for (let days = daysInRange; days >= 1; days--) {
      dayWiseArray.push({
        days: days,
        criteria: `No. of students who logged in ${days} day${days > 1 ? 's' : ''}`,
        count: 0
      });
    }

    return {
      dateRange: {
        type: 'custom',
        from: range.from,
        to: range.to,
        fromDate: new Date(range.from * 1000).toISOString().split('T')[0],
        toDate: new Date(range.to * 1000).toISOString().split('T')[0],
        totalDays: daysInRange
      },
      summary: {
        totalUniqueUsers: 0,
        uniqueLoggedInUsers: 0,
        activeUsers: 0,
        consistentUsers: 0,
        totalCourseAccessEvents: 0,
        metrics: {
          totalCourseAccess: 0,
          uniqueUsers: 0,
          averageAccessPerUser: 0
        }
      },
      dayWiseBreakdown: dayWiseArray,
      users: [],
      note: "No data available for this date range"
    };
  }
}

module.exports = new ConsistentAccessService();