const mongoose = require('mongoose');
const { createClient } = require('redis');
const cloudinary = require('cloudinary').v2;
const winston = require('winston');

// ============================================
// Winston Logger Configuration
// ============================================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'nexbank-api' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// ============================================
// MongoDB Connection
// ============================================
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// ============================================
// Redis Client with In-Memory Fallback
// ============================================
let redisClient = null;
let useMemoryStore = false;
let redisConnectAttempted = false;
let redisConnectLogged = false;

// Lightweight in-memory store that mimics the Redis client API
const createMemoryStore = () => {
  const store = new Map();
  const expiry = new Map(); // key -> expireAt timestamp

  const isExpired = (key) => {
    if (!expiry.has(key)) return false;
    if (Date.now() >= expiry.get(key)) {
      store.delete(key);
      expiry.delete(key);
      return true;
    }
    return false;
  };

  // Periodic cleanup of expired keys every 30 seconds
  const cleanup = setInterval(() => {
    for (const [key] of expiry) isExpired(key);
  }, 30000);
  cleanup.unref?.();

  return {
    get: async (key) => { isExpired(key); return store.get(key) ?? null; },
    set: async (key, val) => { store.set(key, val); expiry.delete(key); return 'OK'; },
    setEx: async (key, seconds, val) => {
      store.set(key, val);
      expiry.set(key, Date.now() + seconds * 1000);
      return 'OK';
    },
    del: async (key) => { const had = store.has(key); store.delete(key); expiry.delete(key); return had ? 1 : 0; },
    incr: async (key) => { isExpired(key); const v = (parseInt(store.get(key)) || 0) + 1; store.set(key, String(v)); return v; },
    expire: async (key, seconds) => { if (store.has(key)) { expiry.set(key, Date.now() + seconds * 1000); return 1; } return 0; },
    ttl: async (key) => { if (!expiry.has(key)) return -1; const left = Math.max(0, Math.ceil((expiry.get(key) - Date.now()) / 1000)); if (left <= 0) { store.delete(key); expiry.delete(key); return -2; } return left; },
    exists: async (key) => { isExpired(key); return store.has(key) ? 1 : 0; },
    isConnected: false,
    isMemoryStore: true,
  };
};

let memoryStore = null;

const connectRedis = async () => {
  if (redisConnectAttempted) return redisClient || memoryStore;
  redisConnectAttempted = true;

  try {
    redisClient = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        connectTimeout: 4000,
        reconnectStrategy: (retries) => {
          if (retries > 5) {
            if (!redisConnectLogged) {
              logger.warn('Redis: max retries reached — falling back to in-memory store');
              redisConnectLogged = true;
            }
            return new Error('Redis max retries');
          }
          return Math.min(retries * 1000, 5000);
        },
      },
      password: process.env.REDIS_PASSWORD || undefined,
    });

    // Suppress noisy error events after first warning
    let firstError = true;
    redisClient.on('error', (err) => {
      if (firstError) {
        logger.warn(`Redis unavailable (${err.message || err.code || err}) — switching to in-memory store`);
        firstError = false;
      }
    });

    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connect timeout')), 5000)),
    ]);

    redisClient.isConnected = true;
    logger.info('✅ Redis connected');
    return redisClient;
  } catch (error) {
    if (!redisConnectLogged) {
      logger.warn(`⚠️  Redis unavailable — using in-memory store (${error.message})`);
      redisConnectLogged = true;
    }
    try { await redisClient?.disconnect?.(); } catch (_) { /* ignore */ }
    redisClient = null;
    memoryStore = createMemoryStore();
    useMemoryStore = true;
    return memoryStore;
  }
};

const getRedis = () => {
  if (redisClient && !useMemoryStore) return redisClient;
  if (memoryStore) return memoryStore;
  // Auto-create memory store if nothing initialised yet
  memoryStore = createMemoryStore();
  useMemoryStore = true;
  return memoryStore;
};

// ============================================
// Cloudinary Configuration
// ============================================
const configureCloudinary = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  logger.info('Cloudinary configured');
  return cloudinary;
};

// ============================================
// Multer Configuration for File Uploads
// ============================================
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'jpeg,jpg,png,pdf').split(',');
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type .${ext} not allowed. Allowed: ${allowedTypes.join(', ')}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024,
  }
});

// ============================================
// Encryption Utilities
// ============================================
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!!';
const IV_LENGTH = parseInt(process.env.AES_IV_LENGTH) || 16;

const encrypt = (text) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
};

const decrypt = (text) => {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
};

// ============================================
// OTP Generation & Redis Operations
// ============================================
const generateOTP = (length = parseInt(process.env.OTP_LENGTH) || 6) => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

const storeOTP = async (key, otp, expiry = parseInt(process.env.OTP_EXPIRY) || 300) => {
  const redis = getRedis();
  const data = JSON.stringify({
    otp,
    attempts: 0,
    createdAt: Date.now()
  });
  await redis.setEx(`otp:${key}`, expiry, data);
};

const verifyOTP = async (key, inputOTP) => {
  const redis = getRedis();
  const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS) || 3;
  const data = await redis.get(`otp:${key}`);

  if (!data) return { valid: false, reason: 'OTP expired or not found' };

  const parsed = JSON.parse(data);
  parsed.attempts += 1;

  if (parsed.attempts > maxAttempts) {
    await redis.del(`otp:${key}`);
    return { valid: false, reason: 'Max attempts exceeded' };
  }

  if (parsed.otp !== inputOTP) {
    await redis.setEx(`otp:${key}`, await redis.ttl(`otp:${key}`), JSON.stringify(parsed));
    return { valid: false, reason: 'Invalid OTP', attemptsLeft: maxAttempts - parsed.attempts };
  }

  await redis.del(`otp:${key}`);
  return { valid: true };
};

const checkOTPCooldown = async (key) => {
  const redis = getRedis();
  const cooldown = await redis.get(`otp_cooldown:${key}`);
  return cooldown ? parseInt(cooldown) : 0;
};

const setOTPCooldown = async (key, seconds = parseInt(process.env.OTP_COOLDOWN) || 60) => {
  const redis = getRedis();
  await redis.setEx(`otp_cooldown:${key}`, seconds, String(seconds));
};

// ============================================
// Session Management
// ============================================
const storeSession = async (userId, sessionId, deviceInfo, ttl = 86400) => {
  const redis = getRedis();
  const key = `session:${userId}:${sessionId}`;
  await redis.setEx(key, ttl, JSON.stringify({
    ...deviceInfo,
    lastActivity: Date.now()
  }));

  // Track user sessions
  const sessionsKey = `user_sessions:${userId}`;
  const sessions = await redis.get(sessionsKey);
  const sessionList = sessions ? JSON.parse(sessions) : [];

  const maxSessions = parseInt(process.env.SESSION_MAX_PER_USER) || 5;
  if (sessionList.length >= maxSessions) {
    const oldSessionId = sessionList.shift();
    await redis.del(`session:${userId}:${oldSessionId}`);
  }
  sessionList.push(sessionId);
  await redis.setEx(sessionsKey, ttl, JSON.stringify(sessionList));
};

const getActiveSessions = async (userId) => {
  const redis = getRedis();
  const sessionsKey = `user_sessions:${userId}`;
  const sessions = await redis.get(sessionsKey);
  if (!sessions) return [];

  const sessionList = JSON.parse(sessions);
  const activeSessions = [];

  for (const sid of sessionList) {
    const data = await redis.get(`session:${userId}:${sid}`);
    if (data) {
      activeSessions.push({ sessionId: sid, ...JSON.parse(data) });
    }
  }
  return activeSessions;
};

const destroySession = async (userId, sessionId) => {
  const redis = getRedis();
  await redis.del(`session:${userId}:${sessionId}`);

  const sessionsKey = `user_sessions:${userId}`;
  const sessions = await redis.get(sessionsKey);
  if (sessions) {
    const sessionList = JSON.parse(sessions).filter(s => s !== sessionId);
    await redis.set(sessionsKey, JSON.stringify(sessionList));
  }
};

// ============================================
// IP & Suspicious Activity Tracking
// ============================================
const trackLoginAttempt = async (ip, email) => {
  const redis = getRedis();
  const key = `login_attempts:${ip}:${email}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, 900); // 15 min window
  return attempts;
};

const resetLoginAttempts = async (ip, email) => {
  const redis = getRedis();
  await redis.del(`login_attempts:${ip}:${email}`);
};

const trackIPSuspicion = async (ip) => {
  const redis = getRedis();
  const key = `suspicious_ip:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  return count;
};

// ============================================
// Account Number Generator
// ============================================
const generateAccountNumber = () => {
  const prefix = process.env.IFSC_PREFIX || 'NXB0';
  const random = Math.floor(Math.random() * 9000000000) + 1000000000;
  return `${prefix}${random}`;
};

const generateIFSC = (branch = '0001') => {
  return `${process.env.IFSC_PREFIX || 'NXB0'}${branch}`;
};

const generateCardNumber = () => {
  const prefixes = ['4', '5', '6']; // Visa, Mastercard, Discover
  let cardNum = prefixes[Math.floor(Math.random() * prefixes.length)];
  for (let i = 0; i < 15; i++) {
    cardNum += Math.floor(Math.random() * 10);
  }
  return cardNum;
};

const generateCVV = () => {
  return String(Math.floor(Math.random() * 900) + 100);
};

const generateAccountPin = (length = 4) => {
  const size = [4, 6].includes(Number(length)) ? Number(length) : 4;
  let pin = '';
  for (let i = 0; i < size; i++) pin += Math.floor(Math.random() * 10);
  return pin;
};

const generateTransactionId = () => {
  return `TXN${Date.now()}${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
};

const generateUPIId = (name) => {
  const clean = name.toLowerCase().replace(/[^a-z]/g, '');
  return `${clean}@nexbank`;
};

// ============================================
// Validation Helpers
// ============================================
const Joi = require('joi');

const schemas = {
  signup: Joi.object({
    firstName: Joi.string().min(2).max(50).required(),
    lastName: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().pattern(/^[+]?[\d\s-]{10,15}$/).required(),
    password: Joi.string().min(8).max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
      .message('Password must contain uppercase, lowercase, number and special character'),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required(),
    pinMode: Joi.string().valid('AUTO', 'CUSTOM').default('AUTO'),
    pin: Joi.when('pinMode', {
      is: 'CUSTOM',
      then: Joi.string().pattern(/^\d{4}$|^\d{6}$/).required(),
      otherwise: Joi.string().pattern(/^\d{4}$|^\d{6}$/).optional()
    }),
    confirmPin: Joi.when('pinMode', {
      is: 'CUSTOM',
      then: Joi.string().valid(Joi.ref('pin')).required(),
      otherwise: Joi.string().valid(Joi.ref('pin')).optional()
    }),
    dateOfBirth: Joi.date().required(),
    panNumber: Joi.string().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).required(),
    aadhaarNumber: Joi.string().pattern(/^\d{12}$/).required(),
    address: Joi.object({
      street: Joi.string().required(),
      city: Joi.string().required(),
      state: Joi.string().required(),
      pincode: Joi.string().pattern(/^\d{6}$/).required(),
      country: Joi.string().default('India')
    }).required()
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    deviceId: Joi.string().optional(),
    deviceInfo: Joi.object({
      browser: Joi.string().optional(),
      os: Joi.string().optional(),
      ip: Joi.string().optional(),
      location: Joi.string().optional()
    }).optional()
  }),

  transfer: Joi.object({
    toAccount: Joi.string().required(),
    amount: Joi.number().positive().precision(2).required(),
    type: Joi.string().valid('IMPS', 'RTGS', 'NEFT', 'UPI', 'INTERNAL').required(),
    description: Joi.string().max(200).optional(),
    pin: Joi.string().pattern(/^\d{4}$|^\d{6}$/).required()
  }),

  deposit: Joi.object({
    amount: Joi.number().positive().precision(2).required(),
    method: Joi.string().valid('CASH', 'CHEQUE', 'ONLINE', 'NEFT').required(),
    description: Joi.string().max(200).optional()
  }),

  beneficiary: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    accountNumber: Joi.string().required(),
    ifsc: Joi.string().required(),
    bank: Joi.string().required(),
    nickname: Joi.string().max(50).optional(),
    type: Joi.string().valid('IMPS', 'RTGS', 'NEFT', 'UPI').default('IMPS')
  }),

  upiCreate: Joi.object({
    upiId: Joi.string().pattern(/^[a-zA-Z0-9._-]{3,30}@[a-zA-Z0-9.-]{2,30}$/).optional()
  }),

  upiSend: Joi.object({
    upiId: Joi.string().pattern(/^[a-zA-Z0-9._-]{3,30}@[a-zA-Z0-9.-]{2,30}$/).required(),
    amount: Joi.number().positive().precision(2).required(),
    pin: Joi.string().pattern(/^\d{4}$|^\d{6}$/).required(),
    note: Joi.string().max(200).optional()
  }),

  upiReceive: Joi.object({
    amount: Joi.number().positive().precision(2).required(),
    fromUpiId: Joi.string().pattern(/^[a-zA-Z0-9._-]{3,30}@[a-zA-Z0-9.-]{2,30}$/).optional(),
    note: Joi.string().max(200).optional()
  }),

  loanApply: Joi.object({
    type: Joi.string().valid('PERSONAL', 'HOME', 'CAR', 'EDUCATION', 'BUSINESS').required(),
    amount: Joi.number().positive().required(),
    tenure: Joi.number().integer().min(6).max(360).required(),
    interestRate: Joi.number().positive().optional()
  }),

  billPayment: Joi.object({
    category: Joi.string().valid('ELECTRICITY', 'WATER', 'GAS', 'INTERNET', 'MOBILE', 'DTH', 'INSURANCE').required(),
    provider: Joi.string().required(),
    consumerNumber: Joi.string().required(),
    amount: Joi.number().positive().required(),
    pin: Joi.string().pattern(/^\d{4}$|^\d{6}$/).required()
  }),

  fdCreate: Joi.object({
    amount: Joi.number().positive().min(1000).required(),
    plan: Joi.string().valid('6M', '1Y', '3Y', '5Y').optional(),
    tenure: Joi.number().integer().min(7).max(3650).optional(),
    interestRate: Joi.number().positive().optional()
  }),

  kycUpload: Joi.object({
    documentType: Joi.string().valid('PAN', 'AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID').required()
  })
};

// ============================================
// EMI Calculator
// ============================================
const calculateEMI = (principal, annualRate, tenureMonths) => {
  const monthlyRate = annualRate / 12 / 100;
  if (monthlyRate === 0) return principal / tenureMonths;
  const emi = principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths) /
    (Math.pow(1 + monthlyRate, tenureMonths) - 1);
  return Math.round(emi * 100) / 100;
};

// ============================================
// Interest Calculator for FD/RD
// ============================================
const calculateFD = (principal, annualRate, days) => {
  const amount = principal * Math.pow(1 + annualRate / 400, 4 * (days / 365));
  const interest = amount - principal;
  return {
    maturityAmount: Math.round(amount * 100) / 100,
    interestEarned: Math.round(interest * 100) / 100
  };
};

const calculateRD = (monthlyInstallment, annualRate, months) => {
  const monthlyRate = annualRate / 12 / 100;
  let amount = 0;
  for (let i = 0; i < months; i++) {
    amount += monthlyInstallment * Math.pow(1 + monthlyRate, months - i);
  }
  return {
    maturityAmount: Math.round(amount * 100) / 100,
    totalDeposited: monthlyInstallment * months,
    interestEarned: Math.round((amount - monthlyInstallment * months) * 100) / 100
  };
};

module.exports = {
  logger,
  connectDB,
  connectRedis,
  getRedis,
  configureCloudinary,
  upload,
  encrypt,
  decrypt,
  generateOTP,
  storeOTP,
  verifyOTP,
  checkOTPCooldown,
  setOTPCooldown,
  storeSession,
  getActiveSessions,
  destroySession,
  trackLoginAttempt,
  resetLoginAttempts,
  trackIPSuspicion,
  generateAccountNumber,
  generateIFSC,
  generateCardNumber,
  generateCVV,
  generateAccountPin,
  generateTransactionId,
  generateUPIId,
  schemas,
  calculateEMI,
  calculateFD,
  calculateRD
};
