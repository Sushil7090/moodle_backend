// services/activityBreakdownService.js
const moodleService = require('./moodleService');

class ActivityBreakdownService {

  /* ---------------- HELPER METHODS ---------------- */

  getEmptyRanges() {
    return {
      '0-20': { count: 0, students: [] },
      '21-40': { count: 0, students: [] },
      '41-60': { count: 0, students: [] },
      '61-80': { count: 0, students: [] },
      '81-100': { count: 0, students: [] }
    };
  }

  getRangeKey(percent) {
    if (percent <= 20) return '0-20';
    if (percent <= 40) return '21-40';
    if (percent <= 60) return '41-60';
    if (percent <= 80) return '61-80';
    return '81-100';
  }

  addToRange(ranges, percent, student) {
    const key = this.getRangeKey(percent);
    ranges[key].students.push(student);
    ranges[key].count++;
  }

  /* ---------------- BATCHING HELPER (FOR PERFORMANCE) ---------------- */

  /**
   * Process users in batches to avoid rate limits
   */
  async processUsersInBatches(users, batchSize, processFn) {
    const results = [];
    
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processFn));
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + batchSize < users.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }

  /* ---------------- MAIN LOGIC - SINGLE COURSE ---------------- */

  /**
   * ✅ FIXED: Get completion breakdown for a SINGLE course
   * Uses completion-enabled activities count (NOT total modules)
   */
  async getSingleCourseCompletionBreakdown(moodleToken, courseId, courseName) {
    console.log(`\n[COURSE] Processing: ${courseName} (ID: ${courseId})`);

    try {
      // Fetch enrolled users
      const users = await moodleService.getEnrolledUsers(moodleToken, courseId);

      console.log(`   📊 Enrolled: ${users.length} students`);

      // ✅ NEW: Fetch course groups
      let courseGroups = [];
      try {
        courseGroups = await moodleService.getCourseGroups(moodleToken, courseId);
        console.log(`   👥 Groups: ${courseGroups.length} found`);
      } catch (err) {
        console.warn(`   ⚠️  Could not fetch groups: ${err.message}`);
      }

      const ranges = this.getEmptyRanges();

      // Handle empty course
      if (!users || users.length === 0) {
        console.log(`   ⚠️  No students enrolled`);
        return {
          courseId,
          courseName,
          shortname: '',
          totalEnrolled: 0,
          totalActivitiesWithCompletion: 0,
          groups: courseGroups.map(g => ({ id: g.id, name: g.name })), // ✅ NEW
          completionRanges: ranges
        };
      }

      // ✅ FIX: Process users in batches (20 at a time) to avoid rate limits
      let totalActivitiesWithCompletion = 0;
      let completionCountsInitialized = false;

      await this.processUsersInBatches(
        users,
        20, // Batch size
        async (user) => {
          try {
            // Get completion status for this student
            const completion = await moodleService.getActivitiesCompletion(
              moodleToken,
              courseId,
              user.id
            );

            const statuses = completion.statuses || [];
            
            // ✅ FIX: Use completion-enabled activities count
            const completionEnabledActivities = statuses.length;
            
            // Store this count (should be same for all students)
            if (!completionCountsInitialized) {
              totalActivitiesWithCompletion = completionEnabledActivities;
              completionCountsInitialized = true;
            }

            // Count completed activities (state = 1 or 2)
            const completedCount = statuses.filter(
              status => status.state === 1 || status.state === 2
            ).length;

            // ✅ FIX: Calculate percentage based on completion-enabled activities
            const completionPercentage = completionEnabledActivities > 0
              ? Math.round((completedCount / completionEnabledActivities) * 100)
              : 0;

            // Create student data object
            const studentData = {
              id: user.id,
              name: user.fullname,
              email: user.email || '',
              username: user.username || '',
              completedActivities: completedCount,
              totalActivities: completionEnabledActivities,
              completionPercentage
            };

            // Add to appropriate range
            this.addToRange(ranges, completionPercentage, studentData);

            return true;

          } catch (err) {
            console.warn(`   ⚠️  Error for student ${user.fullname}: ${err.message}`);
            
            // Add student with 0% if API call fails
            this.addToRange(ranges, 0, {
              id: user.id,
              name: user.fullname,
              email: user.email || '',
              username: user.username || '',
              completedActivities: 0,
              totalActivities: totalActivitiesWithCompletion || 0,
              completionPercentage: 0,
              error: true
            });

            return false;
          }
        }
      );

      // Sort students within each range by completion % (highest first)
      Object.values(ranges).forEach(range => {
        range.students.sort(
          (a, b) => b.completionPercentage - a.completionPercentage
        );
      });

      console.log(`   📚 Activities with completion tracking: ${totalActivitiesWithCompletion}`);
      console.log(`   ✅ Breakdown complete:`);
      console.log(`      0-20%: ${ranges['0-20'].count} students`);
      console.log(`      21-40%: ${ranges['21-40'].count} students`);
      console.log(`      41-60%: ${ranges['41-60'].count} students`);
      console.log(`      61-80%: ${ranges['61-80'].count} students`);
      console.log(`      81-100%: ${ranges['81-100'].count} students`);

      return {
        courseId,
        courseName,
        totalEnrolled: users.length,
        totalActivitiesWithCompletion,
        groups: courseGroups.map(g => ({ id: g.id, name: g.name })), // ✅ NEW
        completionRanges: ranges
      };

    } catch (error) {
      console.error(`   ❌ Error processing course ${courseId}: ${error.message}`);
      throw error;
    }
  }

  /* ---------------- PUBLIC API - ALL COURSES ---------------- */

  /**
   * ✅ FIXED: Get activity completion breakdown for ALL enrolled courses
   */
  async getAllCoursesCompletionBreakdown(moodleToken, userId) {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 STARTING ACTIVITY BREAKDOWN FOR ALL COURSES');
    console.log('='.repeat(80));

    try {
      // Get all courses for this user
      const courses = await moodleService.getUserCourses(moodleToken, userId);
      
      console.log(`\n📚 Found ${courses.length} enrolled courses\n`);

      const results = [];
      let totalEnrolled = 0;
      
      // ✅ FIX: Count students with 60%+ completion as "completed"
      let totalCompleted60Plus = 0;
      let totalCompleted80Plus = 0;

      // Process each course sequentially
      for (let i = 0; i < courses.length; i++) {
        const course = courses[i];
        
        console.log(`[${i + 1}/${courses.length}] Processing: ${course.fullname}`);

        try {
          const breakdown = await this.getSingleCourseCompletionBreakdown(
            moodleToken,
            course.id,
            course.fullname
          );

          // Add course metadata
          breakdown.shortname = course.shortname || '';
          breakdown.summary = course.summary || '';
          breakdown.progress = course.progress || 0;

          results.push(breakdown);

          // Update totals
          totalEnrolled += breakdown.totalEnrolled;
          
          // ✅ FIX: Count 60%+ as "active/completed"
          totalCompleted60Plus += 
            breakdown.completionRanges['61-80'].count +
            breakdown.completionRanges['81-100'].count;
          
          totalCompleted80Plus += 
            breakdown.completionRanges['81-100'].count;

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
      console.log(`   Students with 60%+ completion: ${totalCompleted60Plus}`);
      console.log(`   Students with 80%+ completion: ${totalCompleted80Plus}`);
      console.log('='.repeat(80) + '\n');

      return {
        summary: {
          totalCourses: results.length,
          totalEnrolled,
          
          // ✅ FIX: Provide multiple completion metrics
          completed60Plus: totalCompleted60Plus,
          completed80Plus: totalCompleted80Plus,
          
          completionRate60Plus: totalEnrolled > 0 
            ? parseFloat(((totalCompleted60Plus / totalEnrolled) * 100).toFixed(2))
            : 0,
          
          completionRate80Plus: totalEnrolled > 0 
            ? parseFloat(((totalCompleted80Plus / totalEnrolled) * 100).toFixed(2))
            : 0
        },
        courses: results,
        metadata: {
          fetchedAt: new Date().toISOString(),
          fetchedBy: userId,
          batchSize: 20,
          note: 'Completion percentage based on completion-enabled activities only'
        }
      };

    } catch (error) {
      console.error('\n❌ ERROR in getAllCoursesCompletionBreakdown:', error.message);
      throw error;
    }
  }

  /* ---------------- OPTIONAL: GET SPECIFIC RANGE ---------------- */

  async getStudentsInCourseRange(moodleToken, courseId, rangeKey) {
    const validRanges = ['0-20', '21-40', '41-60', '61-80', '81-100'];
    
    if (!validRanges.includes(rangeKey)) {
      throw new Error('Invalid range key. Must be: 0-20, 21-40, 41-60, 61-80, or 81-100');
    }

    console.log(`\n[RANGE QUERY] Course ${courseId}, Range: ${rangeKey}%`);

    const breakdown = await this.getSingleCourseCompletionBreakdown(
      moodleToken,
      courseId,
      'Course ' + courseId
    );

    return {
      courseId: breakdown.courseId,
      courseName: breakdown.courseName,
      range: rangeKey,
      count: breakdown.completionRanges[rangeKey].count,
      students: breakdown.completionRanges[rangeKey].students,
      totalEnrolled: breakdown.totalEnrolled,
      totalActivitiesWithCompletion: breakdown.totalActivitiesWithCompletion
    };
  }
}

module.exports = new ActivityBreakdownService();