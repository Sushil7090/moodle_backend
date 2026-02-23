// services/activityBreakdownService.js
// Class-wise Video + PDF completion breakdown per course
const moodleService = require('./moodleService');

class ActivityBreakdownService {

  /* ─────────────────────────────────────────────
     HELPER: Detect activity type from name/module
  ───────────────────────────────────────────── */

  parseActivityInfo(moduleName, sectionName, modname = '') {
    const name = (moduleName || '').toLowerCase();
    const section = (sectionName || '').toLowerCase();
    const moduleType = (modname || '').toLowerCase();

    let type = 'other';

    // ✅ FIX: interactivevideo direct video
    if (moduleType === 'interactivevideo') {
      type = 'video';
    }
    else if (name.includes('video') || name.includes('vid')) {
      type = 'video';
    }
    else if (name.includes('pdf') || name.includes('document')) {
      type = 'pdf';
    }

    const classLabel = sectionName || 'Unknown Class';

    return { classLabel, type };
  }

  /* ───────────────────────────────────────────── */

  async processInBatches(items, batchSize, processFn) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processFn));
      results.push(...batchResults);
      if (i + batchSize < items.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    return results;
  }

  /* ───────────────────────────────────────────── */

  async getSingleCourseBreakdown(moodleToken, courseId, courseName) {
    console.log(`\n[COURSE] ${courseName} (ID: ${courseId})`);

    let sections = [];
    try {
      sections = await moodleService.getCourseContents(moodleToken, courseId);
    } catch (err) {
      console.warn(`   ⚠️  Could not fetch contents: ${err.message}`);
    }

    const moduleMap = {};
    const classOrder = [];

    for (const section of sections) {
      const sectionName = section.name || 'Unknown Section';
      if (!section.modules || section.modules.length === 0) continue;

      if (!classOrder.includes(sectionName)) {
        classOrder.push(sectionName);
      }

      for (const mod of section.modules) {

        // ✅ FIX 1: Added interactivevideo
        const learningModules = [
          'resource',
          'url',
          'page',
          'scorm',
          'folder',
          'interactivevideo'   // 🔥 IMPORTANT FIX
        ];

        if (!learningModules.includes(mod.modname)) continue;

        const { classLabel, type } = this.parseActivityInfo(
          mod.name,
          sectionName,
          mod.modname   // ✅ pass modname
        );

        moduleMap[mod.id] = {
          classLabel,
          type,
          moduleName: mod.name,
          moduleId: mod.id,
          instance: mod.instance,
          modname: mod.modname
        };
      }
    }

    console.log(`   📚 Sections found: ${classOrder.length}`);
    console.log(`   📦 Modules mapped: ${Object.keys(moduleMap).length}`);

    let students = [];
    try {
      students = await moodleService.getEnrolledUsers(moodleToken, courseId);
      console.log(`   👥 Total enrolled (all roles): ${students.length}`);
    } catch (err) {
      console.warn(`   ⚠️  Could not fetch students: ${err.message}`);
    }

    const classData = {};

    const ensureClass = (label) => {
      if (!classData[label]) {
        classData[label] = {
          video: new Set(),
          pdf: new Set()
        };
      }
    };

    classOrder.forEach(ensureClass);

    if (students.length > 0) {
      await this.processInBatches(students, 20, async (student) => {
        try {
          if (!student.id) return;

          const completion = await moodleService.getActivitiesCompletion(
            moodleToken, courseId, student.id
          );

          const statuses = completion.statuses || [];
          if (statuses.length === 0) return;

          for (const status of statuses) {

            if (status.state !== 1 && status.state !== 2) continue;

            let modInfo = moduleMap[status.cmid];

            // Fallback by instance
            if (!modInfo && status.instance) {
              modInfo = Object.values(moduleMap).find(
                m => m.instance === status.instance
              );
            }

            if (!modInfo) continue;

            const { classLabel, type } = modInfo;
            ensureClass(classLabel);

            if (type === 'video') {
              classData[classLabel].video.add(student.id);
            }
            else if (type === 'pdf') {
              classData[classLabel].pdf.add(student.id);
            }
          }

        } catch (err) {
          console.warn(`   ⚠️  Error for ${student.fullname}: ${err.message}`);
        }
      });
    }

    const classSummary = classOrder.map(label => {
      const data = classData[label] || { video: new Set(), pdf: new Set() };
      const videoCount = data.video.size;
      const pdfCount = data.pdf.size;
      const bothCount = [...data.video].filter(id => data.pdf.has(id)).length;
      const eitherCount = new Set([...data.video, ...data.pdf]).size;

      return {
        className: label,
        videoCompleted: videoCount,
        pdfCompleted: pdfCount,
        bothCompleted: bothCount,
        eitherCompleted: eitherCount,
        totalEnrolled: students.length
      };
    });

    // Unique learners across entire course
    const uniqueVideoUsers = new Set();
    const uniquePdfUsers = new Set();

    Object.values(classData).forEach(cls => {
      cls.video.forEach(id => uniqueVideoUsers.add(id));
      cls.pdf.forEach(id => uniquePdfUsers.add(id));
    });

    console.log(`   ✅ Done. ${classSummary.length} classes processed.`);
    console.log(`   🎥 Unique video learners: ${uniqueVideoUsers.size}`);
    console.log(`   📄 Unique PDF learners:   ${uniquePdfUsers.size}`);

    return {
      courseId,
      courseName,
      totalEnrolled: students.length,
      totalClasses: classSummary.length,
      summary: {
        uniqueVideoLearners: uniqueVideoUsers.size,
        uniquePdfLearners: uniquePdfUsers.size,
        totalClasses: classSummary.length
      },
      classes: classSummary
    };
  }

  /* ───────────────────────────────────────────── */

  async getAllCoursesCompletionBreakdown(moodleToken, userId) {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 CLASS-WISE VIDEO + PDF BREAKDOWN');
    console.log('='.repeat(70));

    const courses = await moodleService.getUserCourses(moodleToken, userId);
    console.log(`\n📚 Found ${courses.length} courses\n`);

    const results = [];

    for (let i = 0; i < courses.length; i++) {
      const course = courses[i];
      console.log(`[${i + 1}/${courses.length}] ${course.fullname}`);

      try {
        const breakdown = await this.getSingleCourseBreakdown(
          moodleToken,
          course.id,
          course.fullname
        );
        breakdown.shortname = course.shortname || '';
        results.push(breakdown);
      } catch (err) {
        console.warn(`   ⚠️  Skipping: ${err.message}`);
      }
    }

    const grandSummary = {
      totalCourses: results.length,
      totalEnrolled: results.reduce((s, c) => s + c.totalEnrolled, 0),
      totalUniqueVideoLearners: results.reduce((s, c) => s + c.summary.uniqueVideoLearners, 0),
      totalUniquePdfLearners: results.reduce((s, c) => s + c.summary.uniquePdfLearners, 0)
    };

    console.log('\n' + '='.repeat(70));
    console.log('✅ DONE');
    console.log(`   Courses: ${grandSummary.totalCourses}`);
    console.log(`   Unique Video Learners: ${grandSummary.totalUniqueVideoLearners}`);
    console.log(`   Unique PDF Learners:   ${grandSummary.totalUniquePdfLearners}`);
    console.log('='.repeat(70) + '\n');

    return {
      summary: grandSummary,
      courses: results,
      metadata: {
        fetchedAt: new Date().toISOString(),
        fetchedBy: userId,
        note: 'Class-wise Video + PDF completion breakdown.'
      }
    };
  }

  async getSingleCourseCompletionBreakdown(moodleToken, courseId, userId) {
    const courses = await moodleService.getUserCourses(moodleToken, userId);
    const course = courses.find(c => c.id === parseInt(courseId));
    const courseName = course ? course.fullname : `Course ${courseId}`;

    return await this.getSingleCourseBreakdown(moodleToken, courseId, courseName);
  }
}

module.exports = new ActivityBreakdownService();