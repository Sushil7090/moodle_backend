// services/activityBreakdownService.js - FIXED WITH ALL CRITICAL ISSUES RESOLVED
const moodleService = require('./moodleService');

class ActivityBreakdownService {

  /* ---------------- HELPER METHODS (FIXED) ---------------- */

  /**
   * ✅ FIXED: Dynamic activity-based ranges
   */
  getEmptyRanges() {
    return {
      '0': { count: 0, students: [], label: '0 activities completed' },
      'low': { count: 0, students: [], label: '1-25% completed' },
      'mid': { count: 0, students: [], label: '25-50% completed' },
      'high': { count: 0, students: [], label: '50-75% completed' },
      'veryhigh': { count: 0, students: [], label: '75-99% completed' },
      'full': { count: 0, students: [], label: 'All activities completed' }
    };
  }

  /**
   * ✅ FIXED: Dynamic range calculation based on course total
   * @param {number} completedCount - Activities completed by student
   * @param {number} courseTotal - Total activities in the course (max across all users)
   */
  getRangeKey(completedCount, courseTotal) {
    // No activities completed
    if (completedCount === 0) {
      return '0';
    }
    
    // ✅ FIXED: Check against COURSE total, not user's visible total
    if (completedCount >= courseTotal && courseTotal > 0) {
      return 'full';
    }
    
    // ✅ FIXED: Dynamic ranges based on percentage (for logic only)
    const percentComplete = courseTotal > 0 
      ? (completedCount / courseTotal) * 100 
      : 0;
    
    if (percentComplete < 25) return 'low';
    if (percentComplete < 50) return 'mid';
    if (percentComplete < 75) return 'high';
    return 'veryhigh';
  }

  /**
   * ✅ FIXED: Add student with course total reference
   */
  addToRange(ranges, completedCount, courseTotal, student) {
    const key = this.getRangeKey(completedCount, courseTotal);
    ranges[key].students.push(student);
    ranges[key].count++;
  }

  /* ---------------- BATCHING HELPER (FOR PERFORMANCE) ---------------- */

  async processUsersInBatches(users, batchSize, processFn) {
    const results = [];
    
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processFn));
      results.push(...batchResults);
      
      if (i + batchSize < users.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  /* ---------------- MAIN LOGIC - SINGLE COURSE ---------------- */

  /**
   * ✅ FIXED: Get completion breakdown with all issues resolved
   */
  async getSingleCourseCompletionBreakdown(moodleToken, courseId, courseName) {
    console.log(`\n[COURSE] Processing: ${courseName} (ID: ${courseId})`);

    try {
      const users = await moodleService.getEnrolledUsers(moodleToken, courseId);

      console.log(`   📊 Enrolled: ${users.length} students`);

      const ranges = this.getEmptyRanges();

      if (!users || users.length === 0) {
        console.log(`   ⚠️  No students enrolled`);
        return {
          courseId,
          courseName,
          shortname: '',
          totalEnrolled: 0,
          totalActivitiesWithCompletion: 0,
          completionRanges: ranges
        };
      }

      // ✅ FIXED: Track MAXIMUM activities across ALL users
      let totalActivitiesWithCompletion = 0;
      const userCompletionData = [];

      // First pass: collect all data and find max activities
      await this.processUsersInBatches(
        users,
        20,
        async (user) => {
          try {
            const completion = await moodleService.getActivitiesCompletion(
              moodleToken,
              courseId,
              user.id
            );

            const statuses = completion.statuses || [];
            const userVisibleActivities = statuses.length;
            
            // ✅ FIXED: Track maximum activities seen
            totalActivitiesWithCompletion = Math.max(
              totalActivitiesWithCompletion,
              userVisibleActivities
            );

            const completedCount = statuses.filter(
              status => status.state === 1 || status.state === 2
            ).length;

            userCompletionData.push({
              user,
              completedCount,
              userVisibleActivities
            });

            return true;

          } catch (err) {
            console.warn(`   ⚠️  Error for student ${user.fullname}: ${err.message}`);
            
            userCompletionData.push({
              user,
              completedCount: 0,
              userVisibleActivities: 0,
              error: true
            });

            return false;
          }
        }
      );

      console.log(`   📚 Maximum activities with completion tracking: ${totalActivitiesWithCompletion}`);

      // Second pass: categorize users using COURSE total
      userCompletionData.forEach(({ user, completedCount, userVisibleActivities, error }) => {
        const completionPercentage = totalActivitiesWithCompletion > 0
          ? Math.round((completedCount / totalActivitiesWithCompletion) * 100)
          : 0;

        const studentData = {
          id: user.id,
          name: user.fullname,
          email: user.email || '',
          username: user.username || '',
          completedActivities: completedCount,
          totalActivities: totalActivitiesWithCompletion, // ✅ Use course total
          userVisibleActivities, // ✅ NEW: Track what user actually sees
          completionPercentage,
          displayText: `${completedCount}/${totalActivitiesWithCompletion} activities`,
          error: error || false
        };

        // ✅ FIXED: Use COURSE total for range calculation
        this.addToRange(ranges, completedCount, totalActivitiesWithCompletion, studentData);
      });

      // Sort students within each range by completion count (highest first)
      Object.values(ranges).forEach(range => {
        range.students.sort(
          (a, b) => b.completedActivities - a.completedActivities
        );
      });

      console.log(`   ✅ Breakdown complete:`);
      console.log(`      0 completed: ${ranges['0'].count} students`);
      console.log(`      Low (1-25%): ${ranges['low'].count} students`);
      console.log(`      Mid (25-50%): ${ranges['mid'].count} students`);
      console.log(`      High (50-75%): ${ranges['high'].count} students`);
      console.log(`      Very High (75-99%): ${ranges['veryhigh'].count} students`);
      console.log(`      All completed: ${ranges['full'].count} students`);

      return {
        courseId,
        courseName,
        totalEnrolled: users.length,
        totalActivitiesWithCompletion,
        completionRanges: ranges
      };

    } catch (error) {
      console.error(`   ❌ Error processing course ${courseId}: ${error.message}`);
      throw error;
    }
  }

  /* ---------------- PUBLIC API - ALL COURSES ---------------- */

  /**
   * ✅ Get activity completion breakdown for ALL enrolled courses
   */
  async getAllCoursesCompletionBreakdown(moodleToken, userId) {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 STARTING ACTIVITY BREAKDOWN (Dynamic Activity Count Based)');
    console.log('='.repeat(80));

    try {
      const courses = await moodleService.getUserCourses(moodleToken, userId);
      
      console.log(`\n📚 Found ${courses.length} enrolled courses\n`);

      const results = [];
      let totalEnrolled = 0;
      let totalFullyCompleted = 0;

      for (let i = 0; i < courses.length; i++) {
        const course = courses[i];
        
        console.log(`[${i + 1}/${courses.length}] Processing: ${course.fullname}`);

        try {
          const breakdown = await this.getSingleCourseCompletionBreakdown(
            moodleToken,
            course.id,
            course.fullname
          );

          breakdown.shortname = course.shortname || '';
          breakdown.summary = course.summary || '';
          breakdown.progress = course.progress || 0;

          results.push(breakdown);

          totalEnrolled += breakdown.totalEnrolled;
          totalFullyCompleted += breakdown.completionRanges['full'].count;

        } catch (error) {
          console.warn(`   ⚠️  Skipping course ${course.fullname}: ${error.message}`);
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log('✅ ACTIVITY BREAKDOWN COMPLETE');
      console.log('='.repeat(80));
      console.log(`📊 Summary:`);
      console.log(`   Total Courses Processed: ${results.length}`);
      console.log(`   Total Students Enrolled: ${totalEnrolled}`);
      console.log(`   Fully Completed: ${totalFullyCompleted}`);
      console.log('='.repeat(80) + '\n');

      return {
        summary: {
          totalCourses: results.length,
          totalEnrolled,
          fullyCompleted: totalFullyCompleted,
          completionRate: totalEnrolled > 0 
            ? parseFloat(((totalFullyCompleted / totalEnrolled) * 100).toFixed(2))
            : 0
        },
        courses: results,
        metadata: {
          fetchedAt: new Date().toISOString(),
          fetchedBy: userId,
          batchSize: 20,
          note: 'Dynamic activity count based breakdown. Display shows "X/Y activities", ranges determined by completion percentage for logic only.'
        }
      };

    } catch (error) {
      console.error('\n❌ ERROR in getAllCoursesCompletionBreakdown:', error.message);
      throw error;
    }
  }

  /* ---------------- OPTIONAL: GET SPECIFIC RANGE ---------------- */

  async getStudentsInCourseRange(moodleToken, courseId, rangeKey) {
    const validRanges = ['0', 'low', 'mid', 'high', 'veryhigh', 'full'];
    
    if (!validRanges.includes(rangeKey)) {
      throw new Error('Invalid range key. Must be: 0, low, mid, high, veryhigh, or full');
    }

    console.log(`\n[RANGE QUERY] Course ${courseId}, Range: ${rangeKey}`);

    const breakdown = await this.getSingleCourseCompletionBreakdown(
      moodleToken,
      courseId,
      'Course ' + courseId
    );

    return {
      courseId: breakdown.courseId,
      courseName: breakdown.courseName,
      range: rangeKey,
      rangeLabel: breakdown.completionRanges[rangeKey].label,
      count: breakdown.completionRanges[rangeKey].count,
      students: breakdown.completionRanges[rangeKey].students,
      totalEnrolled: breakdown.totalEnrolled,
      totalActivitiesWithCompletion: breakdown.totalActivitiesWithCompletion
    };
  }
}

module.exports = new ActivityBreakdownService();