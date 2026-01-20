// services/moodleService.js
const axios = require('axios');
const config = require('../config/moodle');

class MoodleService {
  constructor() {
    this.baseUrl = config.moodleUrl;
    this.service = config.moodleService;
  }

  /**
   * Get Moodle authentication token
   * IMPORTANT: This should be a POST request, not GET
   */
  async getMoodleToken(username, password) {
    try {
      // Extract base URL (remove /webservice/rest/server.php)
      const tokenUrl = this.baseUrl.replace('/webservice/rest/server.php', '/login/token.php');
      
      console.log(`[MOODLE] Token URL: ${tokenUrl}`);
      console.log(`[MOODLE] Username: ${username}`);
      console.log(`[MOODLE] Service: ${this.service}`);

      // ✅ FIXED: Use POST instead of GET
      const response = await axios.post(tokenUrl, null, {
        params: { 
          username, 
          password, 
          service: this.service 
        },
        timeout: 10000 // 10 second timeout
      });

      console.log(`[MOODLE] Token response:`, response.data);

      const { token, error, errorcode } = response.data;

      // Check for errors
      if (errorcode || error) {
        console.error(`[MOODLE ERROR] Code: ${errorcode}, Message: ${error}`);
        throw new Error(error || 'Failed to get Moodle token');
      }

      if (!token) {
        throw new Error('No token received from Moodle');
      }

      console.log(`[MOODLE] ✅ Token generated successfully`);
      return token;

    } catch (error) {
      console.error('[MOODLE ERROR] Token generation failed:', error.message);
      
      // Handle Axios errors
      if (error.response?.data?.error) {
        throw new Error(error.response.data.error);
      }
      
      // Handle network errors
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Moodle server. Please check MOODLE_URL in .env');
      }

      if (error.code === 'ETIMEDOUT') {
        throw new Error('Moodle server timeout. Please try again.');
      }

      throw error;
    }
  }

  /**
   * Call any Moodle Web Service API
   */
  async callMoodleAPI(token, functionName, params = {}) {
    try {
      console.log(`[MOODLE] Calling function: ${functionName}`);

      const response = await axios.get(this.baseUrl, {
        params: {
          wstoken: token,
          wsfunction: functionName,
          moodlewsrestformat: 'json',
          ...params
        },
        timeout: 15000 // 15 second timeout
      });

      // Check for Moodle errors
      if (response.data.exception) {
        console.error(`[MOODLE ERROR] ${functionName}:`, response.data.message);
        throw new Error(response.data.message || 'Moodle API error');
      }

      console.log(`[MOODLE] ✅ ${functionName} successful`);
      return response.data;

    } catch (error) {
      console.error(`[MOODLE ERROR] ${functionName} failed:`, error.message);

      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }

      throw error;
    }
  }

  /**
   * Get site and user information
   */
  async getSiteInfo(token) {
    return await this.callMoodleAPI(token, 'core_webservice_get_site_info');
  }

  /**
   * Get courses enrolled by user
   */
  async getUserCourses(token, userId) {
    return await this.callMoodleAPI(token, 'core_enrol_get_users_courses', {
      userid: userId
    });
  }

  /**
   * Get course completion status
   */
  async getCourseCompletion(token, courseId, userId) {
    return await this.callMoodleAPI(
      token,
      'core_completion_get_course_completion_status',
      { courseid: courseId, userid: userId }
    );
  }

  /**
   * Get activities completion status
   */
  async getActivitiesCompletion(token, courseId, userId) {
    return await this.callMoodleAPI(
      token,
      'core_completion_get_activities_completion_status',
      { courseid: courseId, userid: userId }
    );
  }
// services/moodleService.js च्या शेवटी add कर (line 192 नंतर)

/**
 * Get course groups (2025, 2026, etc.)
 */
async getCourseGroups(token, courseId) {
  return await this.callMoodleAPI(token, 'core_group_get_course_groups', {
    courseid: courseId
  });
}
  /**
   * Get course contents (sections, modules, etc)
   */
  async getCourseContents(token, courseId) {
    return await this.callMoodleAPI(token, 'core_course_get_contents', {
      courseid: courseId
    });
  }

  /**
   * Get all courses in the site
   */
  async getAllCourses(token) {
    return await this.callMoodleAPI(token, 'core_course_get_courses');
  }

  /**
   * Get enrolled users in a course
   */
  async getEnrolledUsers(token, courseId) {
    return await this.callMoodleAPI(token, 'core_enrol_get_enrolled_users', {
      courseid: courseId
    });
  }

  /**
   * Get user's grade items for a course
   */
  async getUserGrades(token, courseId, userId) {
    return await this.callMoodleAPI(token, 'gradereport_user_get_grade_items', {
      courseid: courseId,
      userid: userId
    });
  }

  /**
   * Get forum discussions
   */
  async getForumDiscussions(token, forumId) {
    return await this.callMoodleAPI(token, 'mod_forum_get_forum_discussions', {
      forumid: forumId
    });
  }

  /**
   * Get quiz attempts
   */
  async getQuizAttempts(token, quizId, userId) {
    return await this.callMoodleAPI(token, 'mod_quiz_get_user_attempts', {
      quizid: quizId,
      userid: userId
    });
  }
}

module.exports = new MoodleService();