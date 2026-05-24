require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const expressMongoSanitize = require('express-mongo-sanitize');
const path = require('path');

const { logger, connectDB, connectRedis, configureCloudinary, getAuthConfig } = require('./config');
const { errorHandler, notFound, requestLogger, securityHeaders, sanitizeInput, generalLimiter } = require('./middleware');
const routes = require('./routes');

const defaultClientUrl = 'https://nexbank-frontend.onrender.com';
const allowedOrigins = Array.from(new Set([
  process.env.CLIENT_URL || defaultClientUrl,
  defaultClientUrl,
  'http://localhost:3000',
  'http://localhost:5173'
]));

// Initialize Express
const app = express();
const server = http.createServer(app);

// ============================================
// SOCKET.IO CONFIGURATION
// ============================================
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

global.io = io;

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));

    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.join(`user:${decoded.userId}`);
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.userId}`);
  
  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.userId}`);
  });

  socket.on('join_admin', () => {
    socket.join('admin_room');
  });
});

// ============================================
// MIDDLEWARE SETUP
// ============================================

// Security
app.use(helmet());
app.use(securityHeaders);

// CORS
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-csrf-token']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookies
app.use(cookieParser());

// Compression
app.use(compression());

// Sanitize
app.use(expressMongoSanitize());
app.use(sanitizeInput);

// Logging
app.use(requestLogger);

// Rate limiting
app.use('/api', generalLimiter);

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================
// API ROUTES
// ============================================
app.use('/api', routes);

// ============================================
// ERROR HANDLING
// ============================================
app.use(notFound);
app.use(errorHandler);

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    if (!process.env.CLIENT_URL) {
      logger.warn(`CLIENT_URL not set. Defaulting to ${defaultClientUrl}`);
    }

    getAuthConfig();

    // Connect to MongoDB
    await connectDB();

    // Connect to Redis (graceful fallback to in-memory store)
    try {
      await connectRedis();
    } catch (redisErr) {
      logger.warn(`Redis init warning: ${redisErr.message}. Continuing with in-memory store.`);
    }

    // Configure Cloudinary (non-blocking — don't crash if keys missing)
    try {
      configureCloudinary();
    } catch (cloudErr) {
      logger.warn(`Cloudinary init warning: ${cloudErr.message}`);
    }

    // Start cron jobs (wrap so import failure doesn't crash server)
    try {
      const crons = require('./jobs');
      logger.info('Cron jobs initialized');
    } catch (cronErr) {
      logger.warn(`Cron jobs skipped: ${cronErr.message}`);
    }

    server.listen(PORT, () => {
      logger.info(`🚀 NexBank API Server running on port ${PORT}`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 API: http://localhost:${PORT}/api`);
      logger.info(`🔌 Socket.io: http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  server.close(() => process.exit(1));
});

startServer();

module.exports = { app, server, io };
