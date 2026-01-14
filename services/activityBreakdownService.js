const moodleService = require('./moodleService');

class ActivityBreakdownService {

  /**
   * Get activity type breakdown
   */
  getActivityTypeBreakdown(activities) {
    const typeBreakdown = {};

    activities.forEach(activity => {
      const type = activity.modname;

      if (!typeBreakdown[type]) {
        typeBreakdown[type] = {
          total: 0,
          completed: 0,
          incomplete: 0
        };
      }

      typeBreakdown[type].total++;
      if (activity.completed) {
        typeBreakdown[type].completed++;
      } else {
        typeBreakdown[type].incomplete++;
      }
    });

    return Object.entries(typeBreakdown).map(([type, stats]) => ({
      type,
      total: stats.total,
      completed: stats.completed,
      incomplete: stats.incomplete,
      completionPercentage:
        stats.total > 0
          ? Math.round((stats.completed / stats.total) * 100)
          : 0
    }));
  }

  /**
   * Build activity breakdown for a SINGLE course
   * (Internal reusable method)
   */
  async buildCourseActivityBreakdown(moodleToken, userId, course) {

    const courseContents =
      await moodleService.getCourseContents(moodleToken, course.id);

    const activitiesCompletion =
      await moodleService.getActivitiesCompletion(
        moodleToken,
        course.id,
        userId
      );

    const completionMap = {};
    if (activitiesCompletion.statuses) {
      activitiesCompletion.statuses.forEach(status => {
        completionMap[status.cmid] = status;
      });
    }

    const sections = courseContents.map(section => {
      const activities = section.modules.map(module => {
        const completion = completionMap[module.id] || {};

        return {
          id: module.id,
          name: module.name,
          modname: module.modname,
          modplural: module.modplural,
          url: module.url,
          completed: completion.state === 1,
          completionState: completion.state || 0,
          timecompleted: completion.timecompleted || null,
          overrideby: completion.overrideby || null,
          visible: module.visible === 1,
          uservisible: module.uservisible,
          availabilityinfo: module.availabilityinfo || '',
          indent: module.indent || 0
        };
      });

      const completedCount = activities.filter(a => a.completed).length;

      return {
        sectionId: section.id,
        sectionName: section.name,
        sectionSummary: section.summary || '',
        activities,
        statistics: {
          total: activities.length,
          completed: completedCount,
          incomplete: activities.length - completedCount,
          completionPercentage:
            activities.length > 0
              ? Math.round((completedCount / activities.length) * 100)
              : 0
        }
      };
    });

    const allActivities = sections.flatMap(s => s.activities);
    const completedActivities =
      allActivities.filter(a => a.completed).length;

    const overallStatistics = {
      totalActivities: allActivities.length,
      completedActivities,
      incompleteActivities: allActivities.length - completedActivities,
      overallCompletion:
        allActivities.length > 0
          ? Math.round((completedActivities / allActivities.length) * 100)
          : 0,
      activityTypes: this.getActivityTypeBreakdown(allActivities)
    };

    return {
      course: {
        id: course.id,
        fullname: course.fullname,
        shortname: course.shortname,
        progress: course.progress || 0
      },
      overallStatistics,
      sections,
      metadata: {
        totalSections: sections.length
      }
    };
  }

  /**
   * PUBLIC API
   * Get activity breakdown for ALL enrolled courses
   */
  async getAllCoursesActivityBreakdown(moodleToken, userId) {

    const courses =
      await moodleService.getUserCourses(moodleToken, userId);

    const results = [];

    for (const course of courses) {
      try {
        const breakdown =
          await this.buildCourseActivityBreakdown(
            moodleToken,
            userId,
            course
          );

        results.push(breakdown);

      } catch (error) {
        console.warn(
          `[ACTIVITY BREAKDOWN] Skipping course ${course.id}: ${error.message}`
        );
      }
    }

    return {
      totalCourses: results.length,
      courses: results,
      fetchedAt: new Date().toISOString()
    };
  }
}

module.exports = new ActivityBreakdownService();
