const jwt = require('jsonwebtoken');
const { logger, getRedis } = require('../config');
const { User } = require('../models');
const rateLimit = require('express-rate-limit');

// ============================================
// JWT AUTHENTICATION — Verifies token AND extracts role from JWT payload
// ============================================
const authenticate = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Role is embedded in JWT — cannot be tampered without the secret
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,       // comes from JWT, not client
      is2FAEnabled: decoded.is2FAEnabled,
      isKYCVerified: decoded.isKYCVerified,
    };

    // Verify user still exists and is active in database
    const user = await User.findById(decoded.userId).select('isActive isFrozen role');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account deactivated.' });
    }
    if (user.isFrozen) {
      return res.status(403).json({ success: false, message: 'Account frozen. Contact support.' });
    }
    // If role changed in DB since token was issued, reject
    if (user.role !== decoded.role) {
      return res.status(401).json({ success: false, message: 'Role updated. Please login again.' });
    }

    req.userDoc = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired.' });
    }
    logger.error('Auth middleware error:', error);
    next(error);
  }
};

// ============================================
// ADMIN ONLY — Checks JWT role is ADMIN or SUPER_ADMIN
// ============================================
const authorizeAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Access denied. Admin privileges required.' });
  }
  next();
};

// ============================================
// SUPER ADMIN ONLY
// ============================================
const authorizeSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, message: 'Super admin access required.' });
  }
  next();
};

// ============================================
// USER ONLY — Prevents admin from accessing user routes
// ============================================
const authorizeUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (req.user.role !== 'USER') {
    return res.status(403).json({ success: false, message: 'Admin accounts must use the admin portal.' });
  }
  next();
};

// ============================================
// ROLE-BASED — Generic checker
// ============================================
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions.' });
    }
    next();
  };
};

// ============================================
// RATE LIMITERS
// ============================================
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { success: false, message: 'Too many attempts. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  message: { success: false, message: 'Too many OTP requests.' },
});

const transferLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Transfer limit reached.' },
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many admin requests.' },
});

// ============================================
// VALIDATION
// ============================================
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const errors = error.details.map(d => d.message);
      return res.status(400).json({ success: false, message: 'Validation error', errors });
    }
    req.body = value;
    next();
  };
};

// ============================================
// ERROR HANDLING
// ============================================
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
  });

  if (err.name === 'CastError') {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({ success: false, message: `Duplicate value for ${field}` });
  }
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ success: false, message: 'Validation Error', errors: messages });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ success: false, message: 'File upload error' });
  }

  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    success: false,
    message: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

const notFound = (req, res, next) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
};

// ============================================
// REQUEST LOGGER
// ============================================
const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms - ${req.ip}`);
  });
  next();
};

// ============================================
// SECURITY HEADERS
// ============================================
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
};

// ============================================
// SANITIZE INPUT
// ============================================
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') return obj.replace(/<[^>]*>/g, '').trim();
    if (typeof obj === 'object' && obj !== null) {
      Object.keys(obj).forEach(key => { obj[key] = sanitize(obj[key]); });
    }
    return obj;
  };
  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);
  next();
};

module.exports = {
  authenticate,
  authorizeAdmin,
  authorizeSuperAdmin,
  authorizeUser,
  authorize,
  validate,
  generalLimiter,
  authLimiter,
  otpLimiter,
  transferLimiter,
  adminLimiter,
  errorHandler,
  notFound,
  requestLogger,
  securityHeaders,
  sanitizeInput,
};
