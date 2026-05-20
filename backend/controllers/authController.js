const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const { v4: uuidv4 } = require('uuid');
const {
  User, Account, AuditLog, Notification, KYC, Card
} = require('../models');
const {
  logger, generateOTP, storeOTP, verifyOTP, checkOTPCooldown, setOTPCooldown,
  storeSession, trackLoginAttempt, resetLoginAttempts, trackIPSuspicion,
  generateAccountNumber, generateIFSC, generateUPIId, generateCardNumber, generateCVV, generateAccountPin,
  schemas, encrypt, decrypt, getRedis
} = require('../config');
const { sendEmail, sendSMS, createNotification, auditLog, generateTokens } = require('../services');

const emailFailureMessage = (result) => result?.response || result?.message || 'Email delivery failed';
const maskCardForResponse = (card) => {
  const obj = card.toObject ? card.toObject() : card;
  const last4 = obj.cardLast4 || (/^\d{16}$/.test(obj.cardNumber || '') ? obj.cardNumber.slice(-4) : '****');
  return { ...obj, cardNumber: `XXXX XXXX XXXX ${last4}` };
};

// ============================================
// SIGNUP — Always role: USER, auto-generate everything
// ============================================
exports.signup = async (req, res, next) => {
  try {
    logger.info('Signup req.body:', {
      ...req.body,
      password: req.body?.password ? '[REDACTED]' : undefined,
      confirmPassword: req.body?.confirmPassword ? '[REDACTED]' : undefined,
    });

    const { error } = schemas.signup.validate(req.body, { abortEarly: false });
    if (error) {
      logger.warn('Signup validation errors:', error.details.map(d => d.message));
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { firstName, lastName, email, phone, password, dateOfBirth, panNumber, aadhaarNumber, address, pinMode = 'AUTO', pin } = req.body;

    // HARD BLOCK: never allow role to be set from request
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }, { panNumber: panNumber.toUpperCase() }, { aadhaarNumber }]
    });
    if (existingUser) {
      const field = existingUser.email === email.toLowerCase() ? 'Email' : existingUser.phone === phone ? 'Phone' : existingUser.panNumber === panNumber.toUpperCase() ? 'PAN' : 'Aadhaar';
      logger.warn('Signup conflict:', { reason: `${field} already registered`, userId: existingUser._id });
      return res.status(409).json({ success: false, message: `${field} already registered` });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const accountPin = pinMode === 'CUSTOM' ? String(pin) : generateAccountPin(4);
    const hashedPin = await bcrypt.hash(accountPin, 10);
    const customerId = 'CUST' + Date.now().toString().slice(-8) + Math.random().toString(36).substring(2, 5).toUpperCase();

    // FORCE role: USER — never trust client input
    const user = await User.create({
      firstName, lastName, email: email.toLowerCase(), phone,
      password: hashedPassword, dateOfBirth, panNumber: panNumber.toUpperCase(),
      aadhaarNumber, address, isEmailVerified: false, isPhoneVerified: false,
      transactionPin: hashedPin,
      customerId,
      role: 'USER', // HARDCODED — cannot be overridden
    });

    // Generate Account Number (12 digits)
    const accountNumber = 'NXB' + Date.now().toString().slice(-7) + Math.floor(Math.random() * 9000 + 1000);
    const ifsc = generateIFSC();
    let upiId = generateUPIId(`${firstName}${lastName}`);
    let upiSuffix = 1;
    while (await Account.exists({ upiId })) {
      upiId = generateUPIId(`${firstName}${lastName}${upiSuffix}`);
      upiSuffix += 1;
    }

    const account = await Account.create({
      userId: user._id, accountNumber, accountType: 'SAVINGS', ifsc,
      balance: 0, status: 'ACTIVE', upiId,
      dailyLimit: 500000, monthlyLimit: 5000000, openedAt: new Date()
    });

    // Physical Debit Card
    const cardNumber = generateCardNumber();
    const cvv = generateCVV();
    const now = new Date();
    const expMonth = String(now.getMonth() + 1).padStart(2, '0');
    const expiryYear = String(now.getFullYear() + 5);

    await Card.create({
      userId: user._id, accountId: account._id,
      cardNumber: await bcrypt.hash(cardNumber, 10),
      encryptedCardNumber: encrypt(cardNumber),
      cardLast4: cardNumber.slice(-4),
      cardType: 'DEBIT', cardNetwork: 'VISA',
      cardHolderName: `${firstName.toUpperCase()} ${lastName.toUpperCase()}`,
      expiryMonth: expMonth, expiryYear,
      cvv: await bcrypt.hash(cvv, 10),
      encryptedCVV: encrypt(cvv),
      pin: hashedPin,
      isVirtual: false, status: 'ACTIVE',
      dailyLimit: 100000, monthlyLimit: 500000
    });

    // Virtual Card
    const vCardNumber = generateCardNumber();
    const vCvv = generateCVV();
    await Card.create({
      userId: user._id, accountId: account._id,
      cardNumber: await bcrypt.hash(vCardNumber, 10),
      encryptedCardNumber: encrypt(vCardNumber),
      cardLast4: vCardNumber.slice(-4),
      cardType: 'VIRTUAL', cardNetwork: 'VISA',
      cardHolderName: `${firstName.toUpperCase()} ${lastName.toUpperCase()}`,
      expiryMonth: expMonth, expiryYear: String(now.getFullYear() + 3),
      cvv: await bcrypt.hash(vCvv, 10),
      encryptedCVV: encrypt(vCvv),
      pin: hashedPin,
      isVirtual: true, status: 'ACTIVE',
      dailyLimit: 50000, monthlyLimit: 200000
    });

    await KYC.create({ userId: user._id, status: 'NOT_STARTED' });

    // Email OTP
    const emailOtp = generateOTP();
    logger.info('Signup email OTP generated:', { userId: user._id, email, otp: emailOtp });
    await storeOTP(`email_verify:${user._id}`, emailOtp, 120);
    const emailSent = await sendEmail(email, 'Verify Email - NexBank', 'emailVerify', { name: firstName, otp: emailOtp });
    if (emailSent.success) logger.info('Signup email OTP sent:', { userId: user._id, email });
    else logger.warn('Signup email OTP delivery failed:', { userId: user._id, email, error: emailFailureMessage(emailSent) });

    // Phone OTP
    const phoneOtp = generateOTP();
    logger.info('Signup phone OTP generated:', { userId: user._id, phone, otp: phoneOtp });
    await storeOTP(`phone_verify:${user._id}`, phoneOtp, 120);
    await sendSMS(phone, `NexBank OTP: ${phoneOtp}. Valid 2 min.`);

    const { accessToken, refreshToken } = generateTokens(user);
    const sessionId = uuidv4();
    await storeSession(user._id.toString(), sessionId, { device: req.headers['user-agent'], ip: req.ip, loginAt: new Date() });

    await auditLog(user._id, 'SIGNUP', 'AUTH', 'INFO', { email, phone, ip: req.ip }, req);
    await createNotification(user._id, 'Welcome!', `Account ${accountNumber} created. Set your PIN to start.`, 'SYSTEM', 'HIGH');

    res.status(201).json({
      success: true,
      message: emailSent.success ? 'Account created. Please verify your email.' : `Account created, but OTP email failed: ${emailFailureMessage(emailSent)}`,
      data: {
        user: { id: user._id, firstName, lastName, fullName: `${firstName} ${lastName}`, email, phone, customerId, isEmailVerified: false, role: 'USER' },
        account: { id: account._id, accountNumber, ifsc, upiId, accountType: 'SAVINGS', balance: 0 },
        pin: { mode: pinMode, generatedPin: pinMode === 'AUTO' ? accountPin : undefined },
        cards: [
          { cardType: 'DEBIT', cardNetwork: 'VISA', cardHolderName: `${firstName.toUpperCase()} ${lastName.toUpperCase()}`, cardNumber: `XXXX XXXX XXXX ${cardNumber.slice(-4)}`, fullCardNumber: cardNumber, cvv, expiryMonth: expMonth, expiryYear },
          { cardType: 'VIRTUAL', cardNetwork: 'VISA', cardHolderName: `${firstName.toUpperCase()} ${lastName.toUpperCase()}`, cardNumber: `XXXX XXXX XXXX ${vCardNumber.slice(-4)}`, fullCardNumber: vCardNumber, cvv: vCvv, expiryMonth: expMonth, expiryYear: String(now.getFullYear() + 3) },
        ],
        tokens: { accessToken, refreshToken },
        sessionId,
      }
    });
  } catch (error) {
    logger.error('Signup database/controller error:', {
      message: error.message,
      code: error.code,
      keyValue: error.keyValue,
      stack: error.stack,
    });
    next(error);
  }
};

// ============================================
// USER LOGIN — Only allows role: USER
// ============================================
exports.login = async (req, res, next) => {
  try {
    const { error } = schemas.login.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { email, password, deviceId, deviceInfo } = req.body;
    const ip = req.ip;

    // Rate check is loose — real lockout happens on the user record itself
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +loginAttempts +lockUntil');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    // BLOCK admin login through user portal
    if (['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Admin accounts must use the admin portal.' });
    }

    if (user.isLocked) return res.status(423).json({ success: false, message: 'Account locked. Try again after 30 minutes.' });
    if (!user.isActive) return res.status(403).json({ success: false, message: 'Account deactivated.' });
    if (user.isFrozen) return res.status(403).json({ success: false, message: 'Account frozen.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await user.incLoginAttempts();
      // Only track in Redis after actual failure
      await trackLoginAttempt(ip, email);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    await resetLoginAttempts(ip, email);
    await User.updateOne({ _id: user._id }, { loginAttempts: 0, $unset: { lockUntil: 1 } });

    if (user.is2FAEnabled) {
      const tempToken = jwt.sign({ userId: user._id, requires2FA: true }, process.env.JWT_SECRET, { expiresIn: '5m' });
      return res.json({ success: true, requires2FA: true, tempToken, message: 'Enter 2FA code' });
    }

    const loginOtp = generateOTP();
    logger.info('Login OTP generated:', { userId: user._id, email: user.email, otp: loginOtp });
    await storeOTP(`login_verify:${user._id}`, loginOtp, 120);
    const loginOtpEmail = await sendEmail(user.email, 'Login OTP - NexBank', 'otp', { name: user.firstName, otp: loginOtp });
    if (loginOtpEmail.success) logger.info('Login OTP email sent:', { userId: user._id, email: user.email });
    else logger.warn('Login OTP delivery failed:', { userId: user._id, email: user.email, error: emailFailureMessage(loginOtpEmail) });

    const { accessToken, refreshToken } = generateTokens(user);
    const sessionId = uuidv4();
    await storeSession(user._id.toString(), sessionId, { device: req.headers['user-agent'], ip, loginAt: new Date() });
    await User.updateOne({ _id: user._id }, { lastLogin: new Date(), lastLoginIP: ip, refreshToken: encrypt(refreshToken) });

    const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 };
    res.cookie('refreshToken', refreshToken, cookieOpts);
    res.cookie('sessionId', sessionId, cookieOpts);

    await auditLog(user._id, 'LOGIN_SUCCESS', 'AUTH', 'INFO', { ip, sessionId }, req);

    const fullUser = await User.findById(user._id).select('-password -loginAttempts -lockUntil -twoFASecret -refreshToken');
    const account = await Account.findOne({ userId: user._id });
    const cards = await Card.find({ userId: user._id, status: { $ne: 'CANCELLED' } }).select('-cvv -pin');
    const kyc = await KYC.findOne({ userId: user._id });

    res.json({
      success: true,
      message: loginOtpEmail.success ? 'Login successful. OTP sent to your email.' : `Login successful, but OTP email failed: ${emailFailureMessage(loginOtpEmail)}`,
      data: { user: fullUser, account, cards: cards.map(maskCardForResponse), kyc: kyc ? { status: kyc.status, level: kyc.level } : { status: 'NOT_STARTED', level: 0 }, tokens: { accessToken, refreshToken }, sessionId, loginOtpSent: loginOtpEmail.success }
    });
  } catch (error) { logger.error('Login error:', error); next(error); }
};

// ============================================
// ADMIN LOGIN — Only allows role: ADMIN or SUPER_ADMIN
// ============================================
exports.adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });

    const ip = req.ip;

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password +loginAttempts +lockUntil');
    if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // ONLY allow admin roles
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Not an admin account.' });
    }

    if (user.isLocked) return res.status(423).json({ success: false, message: 'Account locked.' });
    if (!user.isActive) return res.status(403).json({ success: false, message: 'Account deactivated.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await user.incLoginAttempts();
      await trackLoginAttempt(ip, `admin:${email}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    await resetLoginAttempts(ip, `admin:${email}`);
    await User.updateOne({ _id: user._id }, { loginAttempts: 0, $unset: { lockUntil: 1 }, lastLogin: new Date(), lastLoginIP: ip });

    const { accessToken, refreshToken } = generateTokens(user);
    const sessionId = uuidv4();
    await storeSession(user._id.toString(), sessionId, { device: req.headers['user-agent'], ip, loginAt: new Date(), isAdmin: true });
    await User.updateOne({ _id: user._id }, { refreshToken: encrypt(refreshToken) });

    const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 };
    res.cookie('refreshToken', refreshToken, cookieOpts);
    res.cookie('sessionId', sessionId, cookieOpts);

    await auditLog(user._id, 'ADMIN_LOGIN', 'AUTH', 'INFO', { ip }, req);

    const fullUser = await User.findById(user._id).select('-password -loginAttempts -lockUntil -twoFASecret -refreshToken');

    res.json({
      success: true,
      message: 'Admin login successful',
      data: { user: fullUser, tokens: { accessToken, refreshToken }, sessionId }
    });
  } catch (error) { logger.error('Admin login error:', error); next(error); }
};

// ============================================
// LOGOUT
// ============================================
exports.logout = async (req, res, next) => {
  try {
    const sessionId = req.cookies?.sessionId || req.body?.sessionId;
    if (sessionId && req.user) {
      try { const { destroySession } = require('../config'); await destroySession(req.user.id, sessionId); } catch (e) {}
    }
    if (req.user) {
      await User.updateOne({ _id: req.user.id }, { $unset: { refreshToken: 1 } });
      await auditLog(req.user.id, 'LOGOUT', 'AUTH', 'INFO', { sessionId }, req);
    }
    res.clearCookie('refreshToken');
    res.clearCookie('sessionId');
    res.json({ success: true, message: 'Logged out' });
  } catch (error) { next(error); }
};

// ============================================
// REFRESH TOKEN
// ============================================
exports.refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) return res.status(401).json({ success: false, message: 'No refresh token' });
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.userId).select('+refreshToken');
    if (!user) return res.status(401).json({ success: false, message: 'User not found' });
    let storedToken;
    try { storedToken = decrypt(user.refreshToken); } catch { return res.status(401).json({ success: false, message: 'Invalid token' }); }
    if (storedToken !== token) return res.status(401).json({ success: false, message: 'Token mismatch' });
    const { accessToken, refreshToken: newRT } = generateTokens(user);
    await User.updateOne({ _id: user._id }, { refreshToken: encrypt(newRT) });
    const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 };
    res.cookie('refreshToken', newRT, cookieOpts);
    res.json({ success: true, data: { accessToken, refreshToken: newRT } });
  } catch (error) { next(error); }
};

// ============================================
// EMAIL / PHONE OTP VERIFICATION
// ============================================
exports.verifyEmail = async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ success: false, message: 'OTP required' });
    const result = await verifyOTP(`email_verify:${req.user.id}`, otp);
    if (!result.valid) return res.status(400).json({ success: false, message: result.reason, attemptsLeft: result.attemptsLeft });
    await User.updateOne({ _id: req.user.id }, { isEmailVerified: true });
    await auditLog(req.user.id, 'EMAIL_VERIFIED', 'AUTH', 'INFO', null, req);
    res.json({ success: true, message: 'Email verified' });
  } catch (error) { next(error); }
};

exports.verifyPhone = async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ success: false, message: 'OTP required' });
    const result = await verifyOTP(`phone_verify:${req.user.id}`, otp);
    if (!result.valid) return res.status(400).json({ success: false, message: result.reason, attemptsLeft: result.attemptsLeft });
    await User.updateOne({ _id: req.user.id }, { isPhoneVerified: true });
    await auditLog(req.user.id, 'PHONE_VERIFIED', 'AUTH', 'INFO', null, req);
    res.json({ success: true, message: 'Phone verified' });
  } catch (error) { next(error); }
};

exports.resendOTP = async (req, res, next) => {
  try {
    const { type } = req.body;
    if (!['email', 'phone'].includes(type)) return res.status(400).json({ success: false, message: 'Invalid type' });
    const cooldown = await checkOTPCooldown(`${type}_verify:${req.user.id}`);
    if (cooldown > 0) return res.status(429).json({ success: false, message: `Wait ${cooldown}s`, cooldown });
    const user = await User.findById(req.user.id);
    const otp = generateOTP();
    logger.info('Resend OTP generated:', { userId: user._id, type, otp });
    await storeOTP(`${type}_verify:${user._id}`, otp, 120);
    await setOTPCooldown(`${type}_verify:${user._id}`, 30);
    if (type === 'email') {
      const sent = await sendEmail(user.email, 'OTP - NexBank', 'otp', { name: user.firstName, otp });
      if (!sent.success) return res.status(502).json({ success: false, message: `OTP email failed: ${emailFailureMessage(sent)}` });
      logger.info('Resend OTP email sent:', { userId: user._id, email: user.email });
    } else await sendSMS(user.phone, `NexBank OTP: ${otp}. Valid 2 min.`);
    res.json({ success: true, message: `OTP sent to ${type}` });
  } catch (error) { next(error); }
};

// ============================================
// FORGOT / RESET PASSWORD
// ============================================
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email required' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ success: true, message: 'If account exists, OTP sent.' });
    const otp = generateOTP();
    logger.info('Password reset OTP generated:', { userId: user._id, email: user.email, otp });
    await storeOTP(`reset_password:${user._id}`, otp, 120);
    const sent = await sendEmail(user.email, 'Reset OTP - NexBank', 'resetPassword', { name: user.firstName, otp });
    if (!sent.success) return res.status(502).json({ success: false, message: `Reset OTP email failed: ${emailFailureMessage(sent)}` });
    logger.info('Password reset OTP email sent:', { userId: user._id, email: user.email });
    res.json({ success: true, message: 'OTP sent.', userId: user._id });
  } catch (error) { next(error); }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { userId, otp, newPassword, confirmPassword } = req.body;
    if (!userId || !otp || !newPassword || !confirmPassword) return res.status(400).json({ success: false, message: 'All fields required' });
    if (newPassword !== confirmPassword) return res.status(400).json({ success: false, message: 'Passwords don\'t match' });
    const result = await verifyOTP(`reset_password:${userId}`, otp);
    if (!result.valid) return res.status(400).json({ success: false, message: result.reason });
    await User.updateOne({ _id: userId }, { password: await bcrypt.hash(newPassword, 12) });
    await auditLog(userId, 'PASSWORD_RESET', 'AUTH', 'INFO', null, req);
    res.json({ success: true, message: 'Password reset' });
  } catch (error) { next(error); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword) return res.status(400).json({ success: false, message: 'All fields required' });
    if (newPassword !== confirmPassword) return res.status(400).json({ success: false, message: 'Passwords don\'t match' });
    const user = await User.findById(req.user.id).select('+password');
    if (!(await bcrypt.compare(currentPassword, user.password))) return res.status(401).json({ success: false, message: 'Current password incorrect' });
    await User.updateOne({ _id: req.user.id }, { password: await bcrypt.hash(newPassword, 12) });
    await auditLog(req.user.id, 'PASSWORD_CHANGED', 'SECURITY', 'INFO', null, req);
    res.json({ success: true, message: 'Password changed' });
  } catch (error) { next(error); }
};

// ============================================
// TRANSACTION PIN — Set / Verify / Change / Reset via OTP
// ============================================
exports.setTransactionPin = async (req, res, next) => {
  try {
    const { pin, confirmPin } = req.body;
    if (!pin || !confirmPin) return res.status(400).json({ success: false, message: 'PIN required' });
    if (pin !== confirmPin) return res.status(400).json({ success: false, message: 'PINs don\'t match' });
    if (!/^\d{4}$|^\d{6}$/.test(pin)) return res.status(400).json({ success: false, message: 'PIN must be 4 or 6 digits' });
    await User.updateOne({ _id: req.user.id }, { transactionPin: await bcrypt.hash(pin, 10), loginAttempts: 0 });
    await auditLog(req.user.id, 'PIN_SET', 'SECURITY', 'INFO', null, req);
    res.json({ success: true, message: 'Transaction PIN set successfully' });
  } catch (error) { next(error); }
};

exports.verifyPin = async (req, res, next) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ success: false, message: 'PIN required' });
    const user = await User.findById(req.user.id).select('+transactionPin +loginAttempts');
    if (!user.transactionPin) return res.status(400).json({ success: false, message: 'PIN not set. Go to Settings.' });
    if (user.loginAttempts >= 5) return res.status(423).json({ success: false, message: 'PIN locked. Reset via OTP.' });
    const isMatch = await bcrypt.compare(String(pin), user.transactionPin);
    if (!isMatch) {
      await User.updateOne({ _id: req.user.id }, { $inc: { loginAttempts: 1 } });
      const updated = await User.findById(req.user.id).select('+loginAttempts');
      return res.status(401).json({ success: false, message: 'Incorrect PIN', attemptsLeft: 5 - updated.loginAttempts });
    }
    await User.updateOne({ _id: req.user.id }, { loginAttempts: 0 });
    res.json({ success: true, message: 'PIN verified' });
  } catch (error) { next(error); }
};

exports.changePin = async (req, res, next) => {
  try {
    const { currentPin, newPin, confirmPin } = req.body;
    if (!currentPin || !newPin || !confirmPin) return res.status(400).json({ success: false, message: 'All fields required' });
    if (newPin !== confirmPin) return res.status(400).json({ success: false, message: 'New PINs don\'t match' });
    if (!/^\d{4}$|^\d{6}$/.test(newPin)) return res.status(400).json({ success: false, message: 'PIN must be 4 or 6 digits' });
    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user.transactionPin) return res.status(400).json({ success: false, message: 'PIN not set yet' });
    const isMatch = await bcrypt.compare(String(currentPin), user.transactionPin);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Current PIN incorrect' });
    await User.updateOne({ _id: req.user.id }, { transactionPin: await bcrypt.hash(newPin, 10), loginAttempts: 0 });
    await auditLog(req.user.id, 'PIN_CHANGED', 'SECURITY', 'INFO', null, req);
    res.json({ success: true, message: 'PIN changed successfully' });
  } catch (error) { next(error); }
};

// Reset PIN via OTP
exports.requestPinReset = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const otp = generateOTP();
    logger.info('PIN reset OTP generated:', { userId: user._id, email: user.email, otp });
    await storeOTP(`pin_reset:${user._id}`, otp, 120);
    const sent = await sendEmail(user.email, 'PIN Reset OTP - NexBank', 'otp', { name: user.firstName, otp });
    if (!sent.success) return res.status(502).json({ success: false, message: `PIN reset OTP email failed: ${emailFailureMessage(sent)}` });
    logger.info('PIN reset OTP email sent:', { userId: user._id, email: user.email });
    await sendSMS(user.phone, `NexBank PIN reset OTP: ${otp}. Valid 2 min.`);
    res.json({ success: true, message: 'OTP sent to email/phone' });
  } catch (error) { next(error); }
};

exports.resetPinWithOTP = async (req, res, next) => {
  try {
    const { otp, newPin, confirmPin } = req.body;
    if (!otp || !newPin || !confirmPin) return res.status(400).json({ success: false, message: 'All fields required' });
    if (newPin !== confirmPin) return res.status(400).json({ success: false, message: 'PINs don\'t match' });
    if (!/^\d{4}$|^\d{6}$/.test(newPin)) return res.status(400).json({ success: false, message: 'PIN must be 4 or 6 digits' });
    const result = await verifyOTP(`pin_reset:${req.user.id}`, otp);
    if (!result.valid) return res.status(400).json({ success: false, message: result.reason });
    await User.updateOne({ _id: req.user.id }, { transactionPin: await bcrypt.hash(newPin, 10), loginAttempts: 0 });
    await auditLog(req.user.id, 'PIN_RESET_OTP', 'SECURITY', 'INFO', null, req);
    res.json({ success: true, message: 'PIN reset successfully' });
  } catch (error) { next(error); }
};

// ============================================
// TRANSFER OTP
// ============================================
exports.generateTransferOTP = async (req, res, next) => {
  try {
    const otp = generateOTP();
    logger.info('Transfer OTP generated:', { userId: req.user.id, otp });
    await storeOTP(`transfer_otp:${req.user.id}`, otp, 120);
    const user = await User.findById(req.user.id);
    const sent = await sendEmail(user.email, 'Transfer OTP - NexBank', 'otp', { name: user.firstName, otp });
    if (!sent.success) return res.status(502).json({ success: false, message: `Transfer OTP email failed: ${emailFailureMessage(sent)}` });
    logger.info('Transfer OTP email sent:', { userId: user._id, email: user.email });
    await sendSMS(user.phone, `NexBank transfer OTP: ${otp}. Valid 2 min.`);
    res.json({ success: true, message: 'OTP sent' });
  } catch (error) { next(error); }
};

exports.verifyTransferOTP = async (req, res, next) => {
  try {
    const { otp } = req.body;
    if (!otp) return res.status(400).json({ success: false, message: 'OTP required' });
    const result = await verifyOTP(`transfer_otp:${req.user.id}`, otp);
    if (!result.valid) return res.status(400).json({ success: false, message: result.reason, attemptsLeft: result.attemptsLeft });
    res.json({ success: true, message: 'OTP verified' });
  } catch (error) { next(error); }
};

// ============================================
// 2FA
// ============================================
exports.enable2FA = async (req, res, next) => {
  try {
    const secret = authenticator.generateSecret();
    await User.updateOne({ _id: req.user.id }, { twoFASecret: secret });
    const otpauth = authenticator.keyuri(req.user.email, 'NexBank', secret);
    const QRCode = require('qrcode');
    const qrImage = await QRCode.toDataURL(otpauth);
    res.json({ success: true, data: { secret, qrImage } });
  } catch (error) { next(error); }
};

exports.confirm2FA = async (req, res, next) => {
  try {
    const { code } = req.body;
    const user = await User.findById(req.user.id).select('+twoFASecret');
    if (!user.twoFASecret) return res.status(400).json({ success: false, message: '2FA not initiated' });
    if (!authenticator.verify({ token: code, secret: user.twoFASecret })) return res.status(401).json({ success: false, message: 'Invalid code' });
    await User.updateOne({ _id: user._id }, { is2FAEnabled: true });
    await auditLog(user._id, '2FA_ENABLED', 'SECURITY', 'INFO', null, req);
    res.json({ success: true, message: '2FA enabled' });
  } catch (error) { next(error); }
};

exports.verify2FA = async (req, res, next) => {
  try {
    const { tempToken, code } = req.body;
    const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
    if (!decoded.requires2FA) return res.status(400).json({ success: false, message: 'Invalid token' });
    const user = await User.findById(decoded.userId).select('+twoFASecret');
    if (!authenticator.verify({ token: code, secret: user.twoFASecret })) return res.status(401).json({ success: false, message: 'Invalid code' });
    const { accessToken, refreshToken } = generateTokens(user);
    const sessionId = uuidv4();
    await storeSession(user._id.toString(), sessionId, { device: req.headers['user-agent'], ip: req.ip });
    await User.updateOne({ _id: user._id }, { lastLogin: new Date(), lastLoginIP: req.ip, refreshToken: encrypt(refreshToken) });
    const fullUser = await User.findById(user._id).select('-password');
    const account = await Account.findOne({ userId: user._id });
    res.json({ success: true, data: { user: fullUser, account, tokens: { accessToken, refreshToken }, sessionId } });
  } catch (error) { next(error); }
};

// ============================================
// PROFILE & SESSIONS
// ============================================
exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password -loginAttempts -lockUntil -twoFASecret -transactionPin -refreshToken');
    const account = await Account.findOne({ userId: user._id });
    const cards = await Card.find({ userId: user._id, status: { $ne: 'CANCELLED' } }).select('-cvv -pin');
    const kyc = await KYC.findOne({ userId: user._id });
    res.json({ success: true, data: { user, account, cards: cards.map(maskCardForResponse), kyc: kyc ? { status: kyc.status, level: kyc.level } : { status: 'NOT_STARTED', level: 0 } } });
  } catch (error) { next(error); }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const allowed = ['firstName', 'lastName', 'gender', 'address', 'preferredLanguage', 'theme', 'notificationPreferences'];
    const updates = {};
    Object.keys(req.body).forEach(k => { if (allowed.includes(k)) updates[k] = req.body[k]; });
    await User.updateOne({ _id: req.user.id }, { $set: updates });
    const user = await User.findById(req.user.id).select('-password');
    res.json({ success: true, message: 'Profile updated', data: user });
  } catch (error) { next(error); }
};

exports.getActiveSessions = async (req, res, next) => {
  try { const { getActiveSessions } = require('../config'); res.json({ success: true, data: await getActiveSessions(req.user.id) }); } catch (e) { next(e); }
};

exports.destroySession = async (req, res, next) => {
  try { const { destroySession } = require('../config'); await destroySession(req.user.id, req.params.sessionId); res.json({ success: true, message: 'Session terminated' }); } catch (e) { next(e); }
};

exports.getLoginHistory = async (req, res, next) => {
  try { res.json({ success: true, data: await AuditLog.find({ userId: req.user.id, action: { $in: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'ADMIN_LOGIN'] } }).sort({ createdAt: -1 }).limit(50) }); } catch (e) { next(e); }
};
