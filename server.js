// server.js
const express = require('express');
const cors = require('cors');
const config = require('./config/moodle');

// Import routes
const authRoutes = require('./routes/auth');
const courseRoutes = require('./routes/courses');
const analyticsRoutes = require('./routes/analytics'); // ✅ NEW
// Add imports
const consistentAccessRoutes = require('./routes/consistentAccess');
const activityBreakdownRoutes = require('./routes/activityBreakdown');

// Initialize Express app
const app = express();

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (config.allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Moodle Backend API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    moodleUrl: config.moodleUrl,
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/analytics', analyticsRoutes); // ✅ NEW
// Register routes
app.use('/api/consistent-access', consistentAccessRoutes);
app.use('/api/activity-breakdown', activityBreakdownRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: config.nodeEnv === 'development' ? err.message : undefined
  });
});

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log('=================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${config.nodeEnv}`);
  console.log(`🔗 Moodle URL: ${config.moodleUrl}`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log('=================================');
});