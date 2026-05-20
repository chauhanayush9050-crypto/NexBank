const {
  User, Account, Transaction, KYC, Loan, AuditLog,
  SupportTicket, Notification, Card, Bill
} = require('../models');
const { logger, auditLog } = require('../config');
const { createNotification } = require('../services');

// ============================================
// GET ALL USERS
// ============================================
exports.getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status, kycStatus, sort = 'createdAt', order = 'desc' } = req.query;

    const filter = {};
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search } }
      ];
    }
    if (status === 'active') filter.isActive = true;
    if (status === 'frozen') filter.isFrozen = true;
    if (status === 'inactive') filter.isActive = false;
    if (kycStatus) filter.isKYCVerified = kycStatus === 'verified';

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-password -loginAttempts -lockUntil -twoFASecret -transactionPin -refreshToken')
      .sort({ [sort]: order === 'desc' ? -1 : 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Get account info for each user
    const userIds = users.map(u => u._id);
    const accounts = await Account.find({ userId: { $in: userIds } });
    const accountMap = {};
    accounts.forEach(acc => { accountMap[acc.userId.toString()] = acc; });

    const usersWithAccounts = users.map(user => ({
      ...user.toObject(),
      account: accountMap[user._id.toString()] || null
    }));

    res.json({
      success: true,
      data: {
        users: usersWithAccounts,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    logger.error('Get all users error:', error);
    next(error);
  }
};

// ============================================
// GET USER BY ID
// ============================================
exports.getUserById = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -loginAttempts -lockUntil -twoFASecret -transactionPin -refreshToken');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const account = await Account.findOne({ userId: user._id });
    const kyc = await KYC.findOne({ userId: user._id });
    const transactions = await Transaction.find({
      $or: [{ fromUserId: user._id }, { toUserId: user._id }]
    }).sort({ createdAt: -1 }).limit(20);
    const loans = await Loan.find({ userId: user._id });
    const cards = await Card.find({ userId: user._id });

    res.json({
      success: true,
      data: { user, account, kyc, transactions, loans, cards }
    });
  } catch (error) {
    logger.error('Get user by ID error:', error);
    next(error);
  }
};

// ============================================
// FREEZE ACCOUNT
// ============================================
exports.freezeAccount = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await User.updateOne({ _id: user._id }, { isFrozen: true });
    await Account.updateOne({ userId: user._id }, { status: 'FROZEN' });

    await createNotification(user._id, 'Account Frozen', `Your account has been frozen. Reason: ${reason || 'Administrative action'}. Contact support for assistance.`, 'SECURITY', 'URGENT');
    await auditLog(req.user.id, 'ACCOUNT_FROZEN', 'ADMIN', 'CRITICAL', { targetUserId: user._id, reason }, req);

    logger.info(`Account frozen: ${user.email} by admin ${req.user.id}`);

    res.json({ success: true, message: 'Account frozen successfully' });
  } catch (error) {
    logger.error('Freeze account error:', error);
    next(error);
  }
};

// ============================================
// UNFREEZE ACCOUNT
// ============================================
exports.unfreezeAccount = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await User.updateOne({ _id: user._id }, { isFrozen: false });
    await Account.updateOne({ userId: user._id }, { status: 'ACTIVE' });

    await createNotification(user._id, 'Account Unfrozen', 'Your account has been unfrozen and is now active.', 'SECURITY', 'HIGH');
    await auditLog(req.user.id, 'ACCOUNT_UNFROZEN', 'ADMIN', 'INFO', { targetUserId: user._id }, req);

    res.json({ success: true, message: 'Account unfrozen successfully' });
  } catch (error) {
    logger.error('Unfreeze account error:', error);
    next(error);
  }
};

// ============================================
// KYC MANAGEMENT
// ============================================
exports.getPendingKYC = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const filter = { status: { $in: ['PENDING', 'SUBMITTED', 'IN_REVIEW'] } };

    const total = await KYC.countDocuments(filter);
    const kycs = await KYC.find(filter)
      .populate('userId', 'firstName lastName email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: { kycs, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    logger.error('Get pending KYC error:', error);
    next(error);
  }
};

exports.approveKYC = async (req, res, next) => {
  try {
    const { remarks } = req.body;
    const kyc = await KYC.findById(req.params.id);
    if (!kyc) return res.status(404).json({ success: false, message: 'KYC record not found' });

    kyc.status = 'APPROVED';
    kyc.level = 3;
    kyc.reviewedBy = req.user.id;
    kyc.reviewedAt = new Date();
    kyc.remarks = remarks;
    kyc.panVerified = true;
    kyc.aadhaarVerified = true;
    kyc.addressVerified = true;
    await kyc.save();

    await User.updateOne({ _id: kyc.userId }, { isKYCVerified: true, kycLevel: 3 });
    await createNotification(kyc.userId, 'KYC Approved', 'Your KYC verification has been approved. Full access enabled.', 'KYC', 'HIGH');
    await auditLog(req.user.id, 'KYC_APPROVED', 'ADMIN', 'INFO', { targetUserId: kyc.userId }, req);

    res.json({ success: true, message: 'KYC approved successfully' });
  } catch (error) {
    logger.error('Approve KYC error:', error);
    next(error);
  }
};

exports.rejectKYC = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Rejection reason required' });

    const kyc = await KYC.findById(req.params.id);
    if (!kyc) return res.status(404).json({ success: false, message: 'KYC record not found' });

    kyc.status = 'REJECTED';
    kyc.reviewedBy = req.user.id;
    kyc.reviewedAt = new Date();
    kyc.rejectionReason = reason;
    await kyc.save();

    await createNotification(kyc.userId, 'KYC Rejected', `Your KYC was rejected. Reason: ${reason}. Please resubmit.`, 'KYC', 'HIGH');
    await auditLog(req.user.id, 'KYC_REJECTED', 'ADMIN', 'WARN', { targetUserId: kyc.userId, reason }, req);

    res.json({ success: true, message: 'KYC rejected' });
  } catch (error) {
    logger.error('Reject KYC error:', error);
    next(error);
  }
};

// ============================================
// GET ALL TRANSACTIONS
// ============================================
exports.getAllTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, type, channel, minAmount, maxAmount, startDate, endDate, search } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (channel) filter.channel = channel;
    if (minAmount || maxAmount) {
      filter.amount = {};
      if (minAmount) filter.amount.$gte = Number(minAmount);
      if (maxAmount) filter.amount.$lte = Number(maxAmount);
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    if (search) {
      filter.$or = [
        { transactionId: { $regex: search, $options: 'i' } },
        { fromAccount: { $regex: search, $options: 'i' } },
        { toAccount: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await Transaction.countDocuments(filter);
    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        transactions,
        pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
      }
    });
  } catch (error) {
    logger.error('Get all transactions error:', error);
    next(error);
  }
};

// ============================================
// FRAUD MONITORING
// ============================================
exports.getFraudAlerts = async (req, res, next) => {
  try {
    // High-value transactions
    const highValue = await Transaction.find({
      amount: { $gte: 200000 },
      status: 'COMPLETED',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).sort({ amount: -1 }).limit(50);

    // Multiple failed transactions
    const failedTransactions = await Transaction.find({
      status: 'FAILED',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).sort({ createdAt: -1 }).limit(50);

    // Suspicious patterns - multiple transactions from same account
    const suspiciousAccounts = await Transaction.aggregate([
      {
        $match: {
          status: 'COMPLETED',
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      },
      {
        $group: {
          _id: '$fromAccount',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $match: { count: { $gte: 10 } } },
      { $sort: { totalAmount: -1 } },
      { $limit: 20 }
    ]);

    // Login anomalies
    const loginAnomalies = await AuditLog.find({
      action: { $in: ['LOGIN_FAILED', 'LOGIN_BLOCKED_RATE_LIMIT', 'LOGIN_BLOCKED_LOCKED'] },
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }).sort({ createdAt: -1 }).limit(50);

    res.json({
      success: true,
      data: {
        highValueTransactions: highValue,
        failedTransactions,
        suspiciousAccounts,
        loginAnomalies,
        summary: {
          highValueCount: highValue.length,
          failedCount: failedTransactions.length,
          suspiciousCount: suspiciousAccounts.length,
          anomalyCount: loginAnomalies.length
        }
      }
    });
  } catch (error) {
    logger.error('Fraud monitoring error:', error);
    next(error);
  }
};

// ============================================
// PLATFORM ANALYTICS
// ============================================
exports.getAnalytics = async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'USER' });
    const activeUsers = await User.countDocuments({ role: 'USER', isActive: true });
    const frozenAccounts = await User.countDocuments({ role: 'USER', isFrozen: true });
    const kycPending = await KYC.countDocuments({ status: { $in: ['PENDING', 'SUBMITTED'] } });
    const kycApproved = await KYC.countDocuments({ status: 'APPROVED' });

    const totalTransactions = await Transaction.countDocuments({ status: 'COMPLETED' });
    const totalVolume = await Transaction.aggregate([
      { $match: { status: 'COMPLETED' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const todayTransactions = await Transaction.countDocuments({
      status: 'COMPLETED',
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });

    const todayVolume = await Transaction.aggregate([
      { $match: { status: 'COMPLETED', createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    // Last 30 days trend
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyTrend = await Transaction.aggregate([
      { $match: { status: 'COMPLETED', createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          volume: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // User registration trend
    const registrationTrend = await User.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const activeLoans = await Loan.countDocuments({ status: 'ACTIVE' });
    const totalLoanAmount = await Loan.aggregate([
      { $match: { status: 'ACTIVE' } },
      { $group: { _id: null, total: { $sum: '$principal' } } }
    ]);

    const openTickets = await SupportTicket.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } });

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, active: activeUsers, frozen: frozenAccounts },
        kyc: { pending: kycPending, approved: kycApproved },
        transactions: {
          total: totalTransactions,
          totalVolume: totalVolume[0]?.total || 0,
          today: todayTransactions,
          todayVolume: todayVolume[0]?.total || 0
        },
        loans: { active: activeLoans, totalAmount: totalLoanAmount[0]?.total || 0 },
        support: { openTickets },
        dailyTrend,
        registrationTrend
      }
    });
  } catch (error) {
    logger.error('Analytics error:', error);
    next(error);
  }
};

// ============================================
// AUDIT LOGS
// ============================================
exports.getAuditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, category, action, userId, severity, startDate, endDate } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (action) filter.action = { $regex: action, $options: 'i' };
    if (userId) filter.userId = userId;
    if (severity) filter.severity = severity;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const total = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .populate('userId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: { logs, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    logger.error('Audit logs error:', error);
    next(error);
  }
};

// ============================================
// SUPPORT TICKETS
// ============================================
exports.getSupportTickets = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, priority } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const total = await SupportTicket.countDocuments(filter);
    const tickets = await SupportTicket.find(filter)
      .populate('userId', 'firstName lastName email')
      .populate('assignedTo', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: { tickets, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    logger.error('Get support tickets error:', error);
    next(error);
  }
};

exports.updateTicket = async (req, res, next) => {
  try {
    const { status, priority, assignedTo, message } = req.body;
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found' });

    if (status) ticket.status = status;
    if (priority) ticket.priority = priority;
    if (assignedTo) ticket.assignedTo = assignedTo;

    if (message) {
      ticket.messages.push({
        sender: 'ADMIN',
        senderId: req.user.id,
        message,
        createdAt: new Date()
      });
    }

    if (status === 'RESOLVED') {
      ticket.resolution = message;
      ticket.resolvedAt = new Date();
    }

    await ticket.save();

    await auditLog(req.user.id, 'TICKET_UPDATED', 'ADMIN', 'INFO', { ticketId: ticket.ticketId, status }, req);

    res.json({ success: true, message: 'Ticket updated', data: ticket });
  } catch (error) {
    logger.error('Update ticket error:', error);
    next(error);
  }
};

// ============================================
// APPROVE LOAN
// ============================================
exports.approveLoan = async (req, res, next) => {
  try {
    const loan = await Loan.findById(req.params.id);
    if (!loan) return res.status(404).json({ success: false, message: 'Loan not found' });

    loan.status = 'APPROVED';
    loan.approvedBy = req.user.id;
    loan.startDate = new Date();
    loan.disbursedAt = new Date();
    await loan.save();

    // Disburse to account
    const account = await Account.findOne({ userId: loan.userId });
    if (account) {
      account.balance += loan.principal;
      await account.save();
    }

    await createNotification(loan.userId, 'Loan Approved', `Your ${loan.loanType} loan of ₹${loan.principal.toLocaleString()} has been approved and disbursed.`, 'LOAN', 'HIGH');
    await auditLog(req.user.id, 'LOAN_APPROVED', 'ADMIN', 'INFO', { loanId: loan._id }, req);

    res.json({ success: true, message: 'Loan approved and disbursed' });
  } catch (error) {
    logger.error('Approve loan error:', error);
    next(error);
  }
};

// ============================================
// DELETE USER (Super Admin only)
// ============================================
exports.deleteUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'SUPER_ADMIN') return res.status(403).json({ success: false, message: 'Cannot delete super admin' });

    // Freeze first then deactivate
    user.isActive = false;
    user.isFrozen = true;
    await user.save();
    await Account.updateOne({ userId: user._id }, { status: 'CLOSED' });
    await Card.updateMany({ userId: user._id }, { status: 'CANCELLED' });

    await auditLog(req.user.id, 'USER_DELETED', 'ADMIN', 'CRITICAL', { deletedUserId: user._id, email: user.email }, req);
    logger.info(`User deleted/deactivated: ${user.email} by admin ${req.user.id}`);
    res.json({ success: true, message: 'User deactivated successfully' });
  } catch (error) { logger.error('Delete user error:', error); next(error); }
};

// ============================================
// PROMOTE USER TO ADMIN
// ============================================
exports.promoteToAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      return res.status(400).json({ success: false, message: 'User is already an admin' });
    }

    const previousRole = user.role;
    user.role = 'ADMIN';
    await user.save();

    await AuditLog.create({
      userId: req.user.id,
      action: 'ROLE_PROMOTED',
      category: 'ADMIN',
      severity: 'CRITICAL',
      details: {
        targetUserId: user._id,
        targetEmail: user.email,
        previousRole,
        newRole: 'ADMIN',
        reason: reason || 'No reason provided',
        timestamp: new Date()
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    await createNotification(user._id, 'Role Changed', 'You have been promoted to Admin.', 'SECURITY', 'URGENT');
    logger.info(`User ${user.email} promoted to ADMIN by ${req.user.id}`);

    res.json({ success: true, message: `${user.firstName} ${user.lastName} promoted to Admin` });
  } catch (error) { logger.error('Promote admin error:', error); next(error); }
};

// ============================================
// REMOVE ADMIN ACCESS (demote to USER)
// ============================================
exports.demoteFromAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'SUPER_ADMIN') return res.status(403).json({ success: false, message: 'Cannot demote super admin' });
    if (user.role !== 'ADMIN') return res.status(400).json({ success: false, message: 'User is not an admin' });

    const previousRole = user.role;
    user.role = 'USER';
    await user.save();

    await AuditLog.create({
      userId: req.user.id,
      action: 'ROLE_DEMOTED',
      category: 'ADMIN',
      severity: 'CRITICAL',
      details: {
        targetUserId: user._id,
        targetEmail: user.email,
        previousRole,
        newRole: 'USER',
        reason: reason || 'No reason provided',
        timestamp: new Date()
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    await createNotification(user._id, 'Role Changed', 'Your admin access has been removed.', 'SECURITY', 'URGENT');
    logger.info(`Admin ${user.email} demoted to USER by ${req.user.id}`);

    res.json({ success: true, message: `${user.firstName} ${user.lastName} demoted to User` });
  } catch (error) { logger.error('Demote admin error:', error); next(error); }
};

// ============================================
// SEND BROADCAST NOTIFICATION
// ============================================
exports.broadcastNotification = async (req, res, next) => {
  try {
    const { title, message, type = 'SYSTEM', priority = 'MEDIUM' } = req.body;
    if (!title || !message) return res.status(400).json({ success: false, message: 'Title and message required' });

    const users = await User.find({ isActive: true }).select('_id');
    const notifications = users.map(user => ({
      userId: user._id,
      title,
      message,
      type,
      priority,
      sentVia: { inApp: true }
    }));

    await Notification.insertMany(notifications);

    await auditLog(req.user.id, 'BROADCAST_NOTIFICATION', 'ADMIN', 'INFO', { title, userCount: users.length }, req);

    res.json({ success: true, message: `Notification sent to ${users.length} users` });
  } catch (error) {
    logger.error('Broadcast notification error:', error);
    next(error);
  }
};

// ============================================
// REVERSE TRANSACTION
// ============================================
exports.reverseTransaction = async (req, res, next) => {
  const session = await require('mongoose').startSession();
  try {
    session.startTransaction();
    const { reason } = req.body;

    const tx = await Transaction.findOne({ transactionId: req.params.id }).session(session);
    if (!tx) throw new Error('Transaction not found');
    if (tx.status !== 'COMPLETED') throw new Error('Only completed transactions can be reversed');

    // Reverse the amounts
    const fromAcc = await Account.findOne({ accountNumber: tx.fromAccount }).session(session);
    const toAcc = await Account.findOne({ accountNumber: tx.toAccount }).session(session);

    if (fromAcc) {
      fromAcc.balance += tx.amount;
      await fromAcc.save({ session });
    }
    if (toAcc) {
      toAcc.balance -= tx.amount;
      await toAcc.save({ session });
    }

    tx.status = 'REVERSED';
    tx.meta = { ...tx.meta, reversedBy: req.user.id, reversalReason: reason };
    await tx.save({ session });

    // Create reversal transaction
    const reversalId = `REV${Date.now()}${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    await Transaction.create([{
      transactionId: reversalId,
      fromAccount: tx.toAccount,
      toAccount: tx.fromAccount,
      fromUserId: tx.toUserId,
      toUserId: tx.fromUserId,
      amount: tx.amount,
      type: 'REVERSAL',
      channel: tx.channel,
      status: 'COMPLETED',
      description: `Reversal for ${tx.transactionId}. Reason: ${reason}`,
      referenceId: tx.transactionId,
      processedAt: new Date()
    }], { session });

    await session.commitTransaction();

    await auditLog(req.user.id, 'TRANSACTION_REVERSED', 'ADMIN', 'CRITICAL', { txnId: tx.transactionId, reason }, req);

    res.json({ success: true, message: 'Transaction reversed', data: { reversalId } });
  } catch (error) {
    await session.abortTransaction();
    logger.error('Reverse transaction error:', error);
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};
