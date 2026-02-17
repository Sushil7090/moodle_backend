// services/activityBreakdownService.js
// Class-wise Video + PDF completion breakdown per course
const moodleService = require('./moodleService');

class ActivityBreakdownService {

  /* ─────────────────────────────────────────────
     HELPER: Detect activity type from name/module
  ───────────────────────────────────────────── */

  /**
   * Given a module name like "Class 3 : Video" or "Class 3 : PDF",
   * return { classLabel: "US Class-003", type: "video" | "pdf" | "other" }
   *
   * Moodle course structure (from screenshot):
   *   Section name : "US Class - 001"
   *   Module names : "Class 1 : Video", "Class 1 : PDF"
   */
  parseActivityInfo(moduleName, sectionName) {
    const name = (moduleName || '').toLowerCase();
    const section = (sectionName || '').toLowerCase();

    // Detect type
    let type = 'other';
    if (name.includes('video') || name.includes('vid')) type = 'video';
    else if (name.includes('pdf') || name.includes('document')) type = 'pdf';

    // Use section name as class label (e.g. "US Class - 001")
    const classLabel = sectionName || 'Unknown Class';

    return { classLabel, type };
  }

  /* ─────────────────────────────────────────────
     HELPER: Batch processor (avoid API flooding)
  ───────────────────────────────────────────── */

  async processInBatches(items, batchSize, processFn) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(processFn));
      results.push(...batchResults);
      if (i + batchSize < items.length) {
        await new Promise(r => setTimeout(r, 100)); // small delay between batches
      }
    }
    return results;
  }

  /* ─────────────────────────────────────────────
     CORE: Single course breakdown
  ───────────────────────────────────────────── */

  /**
   * For one course:
   * 1. Get course sections + modules (getCourseContents)
   * 2. Build a map: moduleId → { classLabel, type }
   * 3. Get enrolled students
   * 4. For each student, get activity completion
   * 5. Aggregate: per class → { video: Set<studentId>, pdf: Set<studentId> }
   */
  async getSingleCourseBreakdown(moodleToken, courseId, courseName) {
    console.log(`\n[COURSE] ${courseName} (ID: ${courseId})`);

    // ── Step 1: Course structure ──────────────────
    let sections = [];
    try {
      sections = await moodleService.getCourseContents(moodleToken, courseId);
    } catch (err) {
      console.warn(`   ⚠️  Could not fetch contents: ${err.message}`);
    }

    // ── Step 2: Build module map ──────────────────
    // moduleMap[moduleId] = { classLabel, type, moduleName }
    const moduleMap = {};
    // classOrder keeps insertion order for sorted output
    const classOrder = [];

    for (const section of sections) {
      const sectionName = section.name || 'Unknown Section';

      // Skip sections with no modules or that are "General / intro"
      if (!section.modules || section.modules.length === 0) continue;

      // Track section order
      if (!classOrder.includes(sectionName)) {
        classOrder.push(sectionName);
      }

      for (const mod of section.modules) {
        // ✅ FIX 1: Only map learning modules — skip forum, label, attendance, etc.
        const learningModules = ['resource', 'url', 'page', 'scorm', 'folder'];
        if (!learningModules.includes(mod.modname)) continue;

        const { classLabel, type } = this.parseActivityInfo(mod.name, sectionName);
        moduleMap[mod.id] = {
          classLabel,
          type,
          moduleName: mod.name,
          moduleId: mod.id,
          instance: mod.instance,   // ✅ FIX 2: Store instance for fallback match
          modname: mod.modname      // ✅ FIX 2: Store modname for filtering
        };
      }
    }

    console.log(`   📚 Sections found: ${classOrder.length}`);
    console.log(`   📦 Modules mapped: ${Object.keys(moduleMap).length}`);

    // ── Step 3: Enrolled students ─────────────────
    let students = [];
    try {
      students = await moodleService.getEnrolledUsers(moodleToken, courseId);
      // ✅ roles field Moodle API madhe by default yetch nahi
      // Teachers/admins automatically filter hotil — kyoki tyanchyakade
      // activity completion statuses nasatat (statuses.length === 0)
      console.log(`   👥 Total enrolled (all roles): ${students.length}`);
    } catch (err) {
      console.warn(`   ⚠️  Could not fetch students: ${err.message}`);
    }

    // ── Step 4: Per-class aggregation structure ───
    // classData[classLabel] = { video: Set<studentId>, pdf: Set<studentId>, other: Set<studentId> }
    const classData = {};

    const ensureClass = (label) => {
      if (!classData[label]) {
        classData[label] = {
          video: new Set(),
          pdf: new Set()
        };
      }
    };

    // Pre-populate all known classes (even if 0 completions)
    classOrder.forEach(ensureClass);

    // ── Step 5: Fetch completion for each student ─
    if (students.length > 0) {
      await this.processInBatches(students, 20, async (student) => {
        try {
          if (!student.id) return; // safety check

          const completion = await moodleService.getActivitiesCompletion(
            moodleToken, courseId, student.id
          );

          const statuses = completion.statuses || [];

          // ✅ FIX: Teachers/admins have no completion records → auto-skip
          if (statuses.length === 0) return;

          for (const status of statuses) {
            // state 1 = complete, state 2 = complete (pass)
            if (status.state !== 1 && status.state !== 2) continue;

            // ✅ FIX 4: cmid direct match first, then instance fallback
            let modInfo = moduleMap[status.cmid];

            // Fallback: match by instance id (fixes Moodle cmid mismatch bug)
            if (!modInfo && status.instance) {
              modInfo = Object.values(moduleMap).find(
                m => m.instance === status.instance
              );
            }

            if (!modInfo) continue;

            const { classLabel, type } = modInfo;
            ensureClass(classLabel);

            if (type === 'video') classData[classLabel].video.add(student.id);
            else if (type === 'pdf') classData[classLabel].pdf.add(student.id);
            // 'other' type → skip (not a video/pdf learning resource)
          }

        } catch (err) {
          console.warn(`   ⚠️  Error for ${student.fullname}: ${err.message}`);
        }
      });
    }

    // ── Step 6: Format output ─────────────────────
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
        bothCompleted: bothCount,     // students who did BOTH video + pdf
        eitherCompleted: eitherCount, // students who did at least one
        totalEnrolled: students.length
      };
    });

    // ✅ FIX: Unique learners across entire course
    // (1 student watched 10 videos → counts as 1 unique video learner, not 10)
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
        uniqueVideoLearners: uniqueVideoUsers.size,   // unique students who watched any video
        uniquePdfLearners: uniquePdfUsers.size,       // unique students who read any pdf
        totalClasses: classSummary.length
      },
      classes: classSummary
    };
  }

  /* ─────────────────────────────────────────────
     PUBLIC API: All courses
  ───────────────────────────────────────────── */

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

    // Grand summary across all courses
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
        note: 'Class-wise Video + PDF completion breakdown. Each class row shows how many students completed the Video and PDF for that class session.'
      }
    };
  }

  /* ─────────────────────────────────────────────
     PUBLIC API: Single course (for specific lookup)
  ───────────────────────────────────────────── */

  async getSingleCourseCompletionBreakdown(moodleToken, courseId, userId) {
    // Get course name first
    const courses = await moodleService.getUserCourses(moodleToken, userId);
    const course = courses.find(c => c.id === parseInt(courseId));
    const courseName = course ? course.fullname : `Course ${courseId}`;

    return await this.getSingleCourseBreakdown(moodleToken, courseId, courseName);
  }
}

module.exports = new ActivityBreakdownService();