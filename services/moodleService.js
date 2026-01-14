// services/moodleService.js
const axios = require('axios');
const config = require('../config/moodle');

class MoodleService {
  constructor() {
    this.baseUrl = config.moodleUrl;
    this.service = config.moodleService;
  }

  async getMoodleToken(username, password) {
    try {
      const response = await axios.get(`${this.baseUrl}/login/token.php`, {
        params: { username, password, service: this.service }
      });
      const { token, error, errorcode } = response.data;
      if (errorcode || !token) {
        throw new Error(error || 'Failed to get Moodle token');
      }
      return token;
    } catch (error) {
      if (error.response?.data?.error) {
        throw new Error(error.response.data.error);
      }
      throw error;
    }
  }

  async callMoodleAPI(token, functionName, params = {}) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/webservice/rest/server.php`,
        {
          params: {
            wstoken: token,
            wsfunction: functionName,
            moodlewsrestformat: 'json',
            ...params
          }
        }
      );
      if (response.data.exception) {
        throw new Error(response.data.message || 'Moodle API error');
      }
      return response.data;
    } catch (error) {
      if (error.response?.data?.message) {
        throw new Error(error.response.data.message);
      }
      throw error;
    }
  }

  async getSiteInfo(token) {
    return await this.callMoodleAPI(token, 'core_webservice_get_site_info');
  }

  async getUserCourses(token, userId) {
    return await this.callMoodleAPI(token, 'core_enrol_get_users_courses', {
      userid: userId
    });
  }

  async getCourseCompletion(token, courseId, userId) {
    return await this.callMoodleAPI(
      token,
      'core_completion_get_course_completion_status',
      { courseid: courseId, userid: userId }
    );
  }

  async getActivitiesCompletion(token, courseId, userId) {
    return await this.callMoodleAPI(
      token,
      'core_completion_get_activities_completion_status',
      { courseid: courseId, userid: userId }
    );
  }

  async getCourseContents(token, courseId) {
    return await this.callMoodleAPI(token, 'core_course_get_contents', {
      courseid: courseId
    });
  }

  // ✅ ADD THESE TWO NEW METHODS
  
  async getAllCourses(token) {
    return await this.callMoodleAPI(token, 'core_course_get_courses');
  }

  async getEnrolledUsers(token, courseId) {
    return await this.callMoodleAPI(token, 'core_enrol_get_enrolled_users', {
      courseid: courseId
    });
  }
}

module.exports = new MoodleService();