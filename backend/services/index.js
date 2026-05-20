const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const { logger, getRedis, encrypt } = require('../config');
const { Notification, AuditLog } = require('../models');

// ============================================
// EMAIL SERVICE
// ============================================
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

const emailTemplates = {
  emailVerify: ({ name, otp }) => ({
    subject: 'Verify Your Email - NexBank',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🏦 NexBank</h1>
        </div>
        <div style="padding: 40px 30px; background: white; margin: 20px; border-radius: 8px;">
          <h2 style="color: #333; margin-top: 0;">Hello ${name},</h2>
          <p style="color: #666; font-size: 16px;">Thank you for registering with NexBank. Please verify your email address.</p>
          <div style="background: #f0f2ff; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <p style="color: #666; margin: 0 0 10px;">Your verification code is:</p>
            <h1 style="color: #667eea; font-size: 36px; letter-spacing: 8px; margin: 0;">${otp}</h1>
            <p style="color: #999; font-size: 12px; margin-top: 10px;">Valid for 5 minutes</p>
          </div>
          <p style="color: #999; font-size: 14px;">If you didn't request this, please ignore this email.</p>
        </div>
        <div style="padding: 20px; text-align: center; color: #999; font-size: 12px;">
          <p>© 2025 NexBank. All rights reserved.</p>
        </div>
      </div>`
  }),

  otp: ({ name, otp }) => ({
    subject: 'Your OTP - NexBank',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🏦 NexBank</h1>
        </div>
        <div style="padding: 40px 30px; background: white; margin: 20px; border-radius: 8px;">
          <h2 style="color: #333;">Hello ${name},</h2>
          <p style="color: #666;">Here is your One-Time Password:</p>
          <div style="background: #f0f2ff; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="color: #667eea; font-size: 36px; letter-spacing: 8px; margin: 0;">${otp}</h1>
            <p style="color: #999; font-size: 12px; margin-top: 10px;">Valid for 5 minutes. Do not share.</p>
          </div>
        </div>
      </div>`
  }),

  resetPassword: ({ name, otp }) => ({
    subject: 'Password Reset - NexBank',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px;">🔐 Password Reset</h1>
        </div>
        <div style="padding: 40px 30px; background: white; margin: 20px; border-radius: 8px;">
          <h2 style="color: #333;">Hello ${name},</h2>
          <p style="color: #666;">We received a request to reset your password. Use the OTP below:</p>
          <div style="background: #fff5f5; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="color: #e53e3e; font-size: 36px; letter-spacing: 8px; margin: 0;">${otp}</h1>
            <p style="color: #999; font-size: 12px; margin-top: 10px;">Valid for 10 minutes</p>
          </div>
          <p style="color: #999; font-size: 14px;">If you didn't request this, your account is safe. Ignore this email.</p>
        </div>
      </div>`
  }),

  transactionAlert: ({ name, type, amount, balance, transactionId }) => ({
    subject: `${type === 'credit' ? 'Credit' : 'Debit'} Alert - NexBank`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${type === 'credit' ? '#48bb78' : '#e53e3e'}; padding: 30px; text-align: center; color: white;">
          <h1>${type === 'credit' ? '💰 Amount Credited' : '💸 Amount Debited'}</h1>
        </div>
        <div style="padding: 30px; background: white; border: 1px solid #e2e8f0; border-radius: 0 0 12px 12px;">
          <p>Hello ${name},</p>
          <p>Amount: <strong>₹${amount.toLocaleString()}</strong></p>
          <p>Balance: <strong>₹${balance.toLocaleString()}</strong></p>
          <p>TXN ID: ${transactionId}</p>
        </div>
      </div>`
  })
};

const sendEmail = async (to, subject, templateName, data) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
      const message = 'Email sender not configured: SMTP_USER or SMTP_PASSWORD missing';
      logger.warn(message, { to, subject: subject || templateName });
      return { success: false, message };
    }

    const template = emailTemplates[templateName];
    if (!template) {
      // Use subject and data directly
      await emailTransporter.sendMail({
        from: process.env.EMAIL_FROM || 'NexBank <noreply@nexbank.com>',
        to,
        subject,
        html: typeof data === 'string' ? data : JSON.stringify(data)
      });
      logger.info(`Email sent to ${to}: ${subject}`);
      return { success: true, message: 'Email sent' };
    }

    const { subject: tmplSubject, html } = template(data);
    await emailTransporter.sendMail({
      from: process.env.EMAIL_FROM || 'NexBank <noreply@nexbank.com>',
      to,
      subject: subject || tmplSubject,
      html
    });

    logger.info(`Email sent to ${to}: ${subject || tmplSubject}`);
    return { success: true, message: 'Email sent' };
  } catch (error) {
    logger.error('Email delivery failed:', error);
    return {
      success: false,
      message: error.message,
      code: error.code,
      response: error.response,
    };
  }
};

// ============================================
// SMS SERVICE
// ============================================
const sendSMS = async (phone, message) => {
  try {
    // Twilio integration (placeholder - configure when needed)
    if (process.env.TWILIO_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require('twilio');
      const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE,
        to: phone
      });
      logger.info(`SMS sent to ${phone}`);
    } else {
      logger.info(`SMS (simulated) to ${phone}: ${message}`);
    }
  } catch (error) {
    logger.error('SMS send error:', error);
  }
};

// ============================================
// NOTIFICATION SERVICE
// ============================================
const createNotification = async (userId, title, message, type = 'SYSTEM', priority = 'MEDIUM', data = null) => {
  try {
    const notification = await Notification.create({
      userId,
      title,
      message,
      type,
      priority,
      data,
      sentVia: { inApp: true }
    });

    // Emit socket event
    if (global.io) {
      global.io.to(`user:${userId}`).emit('notification', {
        id: notification._id,
        title,
        message,
        type,
        priority,
        createdAt: notification.createdAt
      });
    }

    // Send email for HIGH/URGENT
    if (['HIGH', 'URGENT'].includes(priority)) {
      const User = require('../models').User;
      const user = await User.findById(userId);
      if (user && user.notificationPreferences?.email) {
        sendEmail(user.email, title, 'otp', { name: user.firstName, otp: message });
      }
    }

    return notification;
  } catch (error) {
    logger.error('Create notification error:', error);
  }
};

// ============================================
// AUDIT LOG SERVICE
// ============================================
const auditLog = async (userId, action, category, severity, details, req) => {
  try {
    await AuditLog.create({
      userId,
      action,
      category,
      severity,
      details,
      ipAddress: req?.ip || req?.headers?.['x-forwarded-for'],
      userAgent: req?.headers?.['user-agent'],
      resource: req?.path,
      method: req?.method
    });
  } catch (error) {
    logger.error('Audit log error:', error);
  }
};

// ============================================
// TOKEN GENERATION
// ============================================
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    {
      userId: user._id,
      email: user.email,
      role: user.role,
      is2FAEnabled: user.is2FAEnabled
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '15m' }
  );

  const refreshToken = jwt.sign(
    { userId: user._id, tokenVersion: Date.now() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );

  return { accessToken, refreshToken };
};

// ============================================
// PUSH NOTIFICATION SERVICE
// ============================================
const sendPushNotification = async (userId, title, body, data = {}) => {
  try {
    const User = require('../models').User;
    const user = await User.findById(userId);
    if (!user || !user.deviceTokens?.length) return;

    // Firebase Cloud Messaging placeholder
    logger.info(`Push notification to ${userId}: ${title}`);
  } catch (error) {
    logger.error('Push notification error:', error);
  }
};

module.exports = {
  sendEmail,
  sendSMS,
  createNotification,
  auditLog,
  generateTokens,
  sendPushNotification
};
