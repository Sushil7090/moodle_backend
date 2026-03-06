// routes/reports.js
const express = require('express');
const moodleService = require('../services/moodleService');
const consistentAccessService = require('../services/consistentAccessService');
const { sendSuccess, sendError } = require('../utils/responseHandler');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

router.get('/generate', async (req, res) => {
  try {
    const { moodleToken, userId } = req.user;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return sendError(res, 'startDate and endDate required', 400);
    }

    const fromTs = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
    const toTs   = Math.floor(new Date(endDate   + 'T23:59:59Z').getTime() / 1000);
    const totalDays = Math.ceil((toTs - fromTs) / 86400);

    // All dates in range
    const allDates = [];
    const cur = new Date(startDate + 'T00:00:00Z');
    const endD = new Date(endDate + 'T23:59:59Z');
    while (cur <= endD) {
      allDates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }

    // ── STEP 1: Access Summary ──────────────────────────────────────────
    console.log('\n[REPORT] Step 1: Access Summary...');
    const accessData = await consistentAccessService.getConsistentAccessData(
      moodleToken, userId, 'custom', startDate, endDate
    );

    const accessSummary = {
      totalUsers:      accessData.summary.totalUniqueUsers,
      activeUsers:     accessData.summary.uniqueLoggedInUsers,
      consistentUsers: accessData.summary.consistentUsers,
      totalLogins:     accessData.summary.totalCourseAccessEvents
    };

    // ── STEP 2: Courses + date-wise active students ─────────────────────
    console.log('\n[REPORT] Step 2: Fetching courses + completion data...');
    const courses = await moodleService.getUserCourses(moodleToken, userId);

    // date-wise unique students Set
    const dateWiseStudents = {};
    allDates.forEach(d => { dateWiseStudents[d] = new Set(); });

    const coursesOverview = [];
    const activityBreakdown = [];

    for (const course of courses) {
      console.log(`\n[REPORT] Processing course: ${course.fullname}`);

      // Enrolled users
      let students = [];
      try {
        students = await moodleService.getEnrolledUsers(moodleToken, course.id);
      } catch(e) {
        console.warn(`[REPORT] getEnrolledUsers failed for ${course.id}:`, e.message);
      }

      // Course contents (sections/modules)
      let sections = [];
      try {
        sections = await moodleService.getCourseContents(moodleToken, course.id);
      } catch(e) {
        console.warn(`[REPORT] getCourseContents failed for ${course.id}:`, e.message);
      }

      // Build module map
      const moduleMap = {};
      const classOrder = [];

      for (const section of sections) {
        const sectionName = section.name || 'Unknown';
        if (!classOrder.includes(sectionName)) classOrder.push(sectionName);

        for (const mod of (section.modules || [])) {
          const learningModules = ['resource','url','page','scorm','folder','interactivevideo'];
          if (!learningModules.includes(mod.modname)) continue;

          const name = (mod.name || '').toLowerCase();
          const modtype = (mod.modname || '').toLowerCase();
          let type = 'other';
          if (modtype === 'interactivevideo' || name.includes('video')) type = 'video';
          else if (name.includes('pdf') || name.includes('document')) type = 'pdf';

          moduleMap[mod.id] = { classLabel: sectionName, type };
        }
      }

      // Per-class data
      const classData = {};
      classOrder.forEach(label => {
        classData[label] = { video: new Set(), pdf: new Set() };
      });

      let totalCompleted = 0;

      // Process students in batches of 20
      for (let i = 0; i < students.length; i += 20) {
        const batch = students.slice(i, i + 20);
        await Promise.all(batch.map(async (student) => {
          if (!student.id) return;
          try {
            const completion = await moodleService.getActivitiesCompletion(
              moodleToken, course.id, student.id
            );

            for (const status of (completion.statuses || [])) {
              // ✅ Date-wise active students — timecompleted use kara
              if (status.timecompleted && status.timecompleted > 0) {
                const completedDate = new Date(status.timecompleted * 1000)
                  .toISOString().split('T')[0];
                if (dateWiseStudents[completedDate]) {
                  dateWiseStudents[completedDate].add(student.id);
                }
              }

              if (status.state !== 1 && status.state !== 2) continue;

              const modInfo = moduleMap[status.cmid];
              if (!modInfo) continue;

              const { classLabel, type } = modInfo;
              if (!classData[classLabel]) {
                classData[classLabel] = { video: new Set(), pdf: new Set() };
              }

              if (type === 'video') classData[classLabel].video.add(student.id);
              else if (type === 'pdf') classData[classLabel].pdf.add(student.id);
            }
          } catch(e) {}
        }));
        // Small delay between batches
        if (i + 20 < students.length) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      // Course overview progress
      const totalActivities = Object.values(moduleMap).length;
      const progress = totalActivities > 0
        ? parseFloat(((totalCompleted / (students.length * totalActivities)) * 100).toFixed(1))
        : 0;

      coursesOverview.push({
        courseId:   course.id,
        courseName: course.fullname,
        shortname:  course.shortname || '',
        progress:   isNaN(progress) ? 0 : progress
      });

      // Activity breakdown — class-wise
      const classes = classOrder.map(label => {
        const d = classData[label] || { video: new Set(), pdf: new Set() };
        const videoCount = d.video.size;
        const pdfCount   = d.pdf.size;
        const bothCount  = [...d.video].filter(id => d.pdf.has(id)).length;
        const eitherCount = new Set([...d.video, ...d.pdf]).size;
        const rate = students.length > 0
          ? Math.round((eitherCount / students.length) * 100) : 0;

        return {
          className:       label,
          videoCompleted:  videoCount,
          pdfCompleted:    pdfCount,
          bothCompleted:   bothCount,
          eitherCompleted: eitherCount,
          totalEnrolled:   students.length,
          completionRate:  rate
        };
      });

      activityBreakdown.push({
        courseId:      course.id,
        courseName:    course.fullname,
        shortname:     course.shortname || '',
        totalEnrolled: students.length,
        totalClasses:  classes.length,
        classes
      });
    }

    // ── STEP 3: loginConsistency — date-wise from timecompleted ────────
    const loginConsistency = allDates.map(date => ({
      date,
      criteria: date,
      count: dateWiseStudents[date].size
    }));

    // ── RESPONSE ────────────────────────────────────────────────────────
    sendSuccess(res, {
      dateRange: {
        fromDate:  startDate,
        toDate:    endDate,
        from:      fromTs,
        to:        toTs,
        totalDays
      },
      accessSummary,
      loginConsistency,
      coursesOverview,
      activityBreakdown,
      generatedAt: new Date().toISOString()
    }, 'Report generated successfully');

  } catch (error) {
    console.error('[REPORT ERROR]', error.message);
    sendError(res, 'Failed to generate report', 500, error.message);
  }
});

module.exports = router;