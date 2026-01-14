// utils/responseHandler.js

/**
 * Send success response
 */
const sendSuccess = (res, data, message = 'Success', statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

/**
 * Send error response
 */
const sendError = (res, message = 'Error', statusCode = 500, details = null) => {
  const response = {
    success: false,
    error: message
  };

  if (details && process.env.NODE_ENV === 'development') {
    response.details = details;
  }

  res.status(statusCode).json(response);
};

module.exports = {
  sendSuccess,
  sendError
};