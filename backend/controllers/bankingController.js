const bcrypt = require('bcryptjs');
const {
  User, Account, Transaction, Card, Beneficiary, Loan,
  FixedDeposit, RecurringDeposit, Bill, ScheduledPayment,
  Notification, AuditLog, PaymentRequest, Cheque
} = require('../models');
const {
  logger, generateTransactionId, generateCardNumber, generateCVV,
  schemas, calculateEMI, calculateFD, calculateRD, getRedis, encrypt, decrypt
} = require('../config');
const { createNotification, auditLog, sendEmail } = require('../services');

const FD_PLANS = {
  '6M': { label: '6 months', days: 182, rate: 6.25 },
  '1Y': { label: '1 year', days: 365, rate: 7.0 },
  '3Y': { label: '3 years', days: 1095, rate: 7.35 },
  '5Y': { label: '5 years', days: 1825, rate: 7.5 },
};

const getFDMaturityDetails = (fd) => {
  const now = new Date();
  const daysHeld = Math.max(0, Math.floor((now - fd.startDate) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, Math.ceil((fd.maturityDate - now) / (1000 * 60 * 60 * 24)));
  const progress = Math.min(100, Math.round((daysHeld / fd.tenureDays) * 10000) / 100);
  const penaltyRate = 1;
  const effectiveRate = daysHeld < 30 ? 0 : Math.max(0, fd.interestRate - penaltyRate);
  const prematureAmount = fd.principal + (fd.principal * effectiveRate / 100 * (daysHeld / 365));
  const prematureReturnAmount = Math.round(prematureAmount * 100) / 100;

  return {
    fdNumber: fd.fdNumber,
    status: fd.status,
    principal: fd.principal,
    interestRate: fd.interestRate,
    tenureDays: fd.tenureDays,
    startDate: fd.startDate,
    maturityDate: fd.maturityDate,
    maturityAmount: fd.maturityAmount,
    interestEarned: fd.interestEarned || Math.round((fd.maturityAmount - fd.principal) * 100) / 100,
    daysHeld,
    daysRemaining,
    progress,
    prematurePenaltyRate: penaltyRate,
    prematureReturnAmount,
    prematurePenalty: Math.max(0, Math.round((fd.maturityAmount - prematureReturnAmount) * 100) / 100),
    completed: ['MATURED', 'PREMATURE_CLOSED', 'CANCELLED'].includes(fd.status)
  };
};

const cardResponse = (card) => ({
  ...card.toObject(),
  cardNumber: `XXXX XXXX XXXX ${card.cardLast4 || (/^\d{16}$/.test(card.cardNumber || '') ? card.cardNumber.slice(-4) : '****')}`,
});

const normalizeUPI = (upiId) => String(upiId || '').trim().toLowerCase();

const syncMaturedFDs = async (userId) => {
  const maturedFDs = await FixedDeposit.find({ userId, status: 'ACTIVE', maturityDate: { $lte: new Date() } });
  for (const fd of maturedFDs) {
    const account = await Account.findById(fd.accountId);
    if (account) {
      account.balance += fd.maturityAmount;
      account.lastTransactionAt = new Date();
      await account.save();
      await Transaction.create({
        transactionId: generateTransactionId(),
        fromAccount: 'FD_MATURITY',
        toAccount: account.accountNumber,
        fromUserId: fd.userId,
        toUserId: fd.userId,
        amount: fd.maturityAmount,
        type: 'CREDIT',
        channel: 'INTERNAL',
        status: 'COMPLETED',
        description: `FD maturity credit ${fd.fdNumber}`,
        category: 'INVESTMENT',
        processedAt: new Date()
      }).catch(() => {});
    }
    fd.status = 'MATURED';
    fd.closedAt = new Date();
    await fd.save();
  }
};

// ============================================
// GET ACCOUNT SUMMARY
// ============================================
exports.getAccountSummary = async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    await syncMaturedFDs(req.user.id);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentTransactions = await Transaction.find({
      $or: [{ fromAccount: account.accountNumber }, { toAccount: account.accountNumber }],
      createdAt: { $gte: thirtyDaysAgo }
    }).sort({ createdAt: -1 }).limit(10);

    const totalCredits = await Transaction.aggregate([
      { $match: { toAccount: account.accountNumber, status: 'COMPLETED', type: { $in: ['CREDIT', 'DEPOSIT'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalDebits = await Transaction.aggregate([
      { $match: { fromAccount: account.accountNumber, status: 'COMPLETED', type: { $in: ['DEBIT', 'WITHDRAWAL'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const cards = await Card.find({ userId: req.user.id, status: 'ACTIVE' });
    const loans = await Loan.find({ userId: req.user.id, status: { $in: ['ACTIVE', 'APPROVED'] } });
    const fds = await FixedDeposit.find({ userId: req.user.id, status: 'ACTIVE' });
    const rds = await RecurringDeposit.find({ userId: req.user.id, status: 'ACTIVE' });

    // Spending by category
    const spendingByCategory = await Transaction.aggregate([
      { $match: { fromAccount: account.accountNumber, status: 'COMPLETED', type: 'DEBIT' } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]);

    // Monthly spending trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyTrend = await Transaction.aggregate([
      { $match: { fromAccount: account.accountNumber, status: 'COMPLETED', createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        totalSpent: { $sum: '$amount' },
        transactions: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        account,
        balance: account.balance,
        availableBalance: account.balance - account.minBalance,
        recentTransactions,
        summary: {
          totalCredits: totalCredits[0]?.total || 0,
          totalDebits: totalDebits[0]?.total || 0,
          cardsCount: cards.length,
          activeLoans: loans.length,
          fixedDeposits: fds.length,
          recurringDeposits: rds.length
        },
        spendingByCategory,
        monthlyTrend,
        cards: cards.map(cardResponse),
        loans,
        fixedDeposits: fds,
        recurringDeposits: rds
      }
    });
  } catch (error) {
    logger.error('Account summary error:', error);
    next(error);
  }
};

// ============================================
// GET BALANCE
// ============================================
exports.getBalance = async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    res.json({
      success: true,
      data: {
        balance: account.balance,
        availableBalance: account.balance - account.minBalance,
        accountNumber: account.accountNumber,
        accountType: account.accountType,
        currency: account.currency
      }
    });
  } catch (error) {
    logger.error('Get balance error:', error);
    next(error);
  }
};

// ============================================
// DEPOSIT
// ============================================
exports.deposit = async (req, res, next) => {
  try {
    const { error } = schemas.deposit.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { amount, method, description } = req.body;
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Amount must be positive' });

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    if (account.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Account is not active' });

    const txId = generateTransactionId();
    const transaction = await Transaction.create({
      transactionId: txId,
      fromAccount: 'CASH',
      toAccount: account.accountNumber,
      fromUserId: null,
      toUserId: req.user.id,
      amount,
      type: 'DEPOSIT',
      channel: method || 'ONLINE',
      status: 'COMPLETED',
      description: description || 'Cash deposit',
      processedAt: new Date()
    });

    account.balance += amount;
    account.lastTransactionAt = new Date();
    await account.save();

    await createNotification(req.user.id, 'Deposit Successful', `₹${amount.toLocaleString()} deposited to your account. New balance: ₹${account.balance.toLocaleString()}`, 'TRANSACTION', 'HIGH');
    await auditLog(req.user.id, 'DEPOSIT', 'TRANSACTION', 'INFO', { amount, method, txId }, req);

    res.json({
      success: true,
      message: 'Deposit successful',
      data: { transaction, newBalance: account.balance }
    });
  } catch (error) {
    logger.error('Deposit error:', error);
    next(error);
  }
};

// ============================================
// WITHDRAW
// ============================================
exports.withdraw = async (req, res, next) => {
  try {
    const { amount, pin, description } = req.body;
    if (!amount || !pin) return res.status(400).json({ success: false, message: 'Amount and PIN required' });
    if (amount <= 0) return res.status(400).json({ success: false, message: 'Invalid amount' });

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user.transactionPin) return res.status(400).json({ success: false, message: 'Transaction PIN not set' });

    const isPinValid = await bcrypt.compare(String(pin), user.transactionPin);
    if (!isPinValid) return res.status(401).json({ success: false, message: 'Invalid transaction PIN' });

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    if (account.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Account is not active' });

    if (account.balance - amount < account.minBalance) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Minimum balance of ₹${account.minBalance} required.` });
    }

    const txId = generateTransactionId();
    const transaction = await Transaction.create({
      transactionId: txId,
      fromAccount: account.accountNumber,
      toAccount: 'CASH',
      fromUserId: req.user.id,
      toUserId: null,
      amount,
      type: 'WITHDRAWAL',
      channel: 'ONLINE',
      status: 'COMPLETED',
      description: description || 'Withdrawal',
      processedAt: new Date()
    });

    account.balance -= amount;
    account.lastTransactionAt = new Date();
    await account.save();

    await createNotification(req.user.id, 'Withdrawal Successful', `₹${amount.toLocaleString()} withdrawn. New balance: ₹${account.balance.toLocaleString()}`, 'TRANSACTION', 'HIGH');
    await auditLog(req.user.id, 'WITHDRAWAL', 'TRANSACTION', 'INFO', { amount, txId }, req);

    res.json({ success: true, message: 'Withdrawal successful', data: { transaction, newBalance: account.balance } });
  } catch (error) {
    logger.error('Withdrawal error:', error);
    next(error);
  }
};

// ============================================
// FUND TRANSFER (INTERNAL / IMPS / RTGS / NEFT / UPI)
// ============================================
exports.transfer = async (req, res, next) => {
  const session = await require('mongoose').startSession();
  try {
    session.startTransaction();

    const { error } = schemas.transfer.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { toAccount, amount, type, description, pin } = req.body;

    // Verify PIN
    const user = await User.findById(req.user.id).select('+transactionPin').session(session);
    if (!user.transactionPin) throw new Error('Transaction PIN not set');
    const isPinValid = await bcrypt.compare(String(pin), user.transactionPin);
    if (!isPinValid) throw new Error('Invalid transaction PIN');

    const fromAccount = await Account.findOne({ userId: req.user.id }).session(session);
    if (!fromAccount) throw new Error('Source account not found');
    if (fromAccount.status !== 'ACTIVE') throw new Error('Source account is not active');

    // Transfer limits
    if (type === 'RTGS' && amount < 200000) throw new Error('RTGS minimum amount is ₹2,00,000');
    if (type === 'IMPS' && amount > 500000) throw new Error('IMPS maximum amount is ₹5,00,000');
    if (fromAccount.balance - amount < fromAccount.minBalance) throw new Error('Insufficient balance');

    // Check daily/monthly limits
    if (fromAccount.dailySpent + amount > fromAccount.dailyLimit) throw new Error('Daily transfer limit exceeded');
    if (fromAccount.monthlySpent + amount > fromAccount.monthlyLimit) throw new Error('Monthly transfer limit exceeded');

    // Find recipient
    const toAcc = await Account.findOne({ accountNumber: toAccount }).session(session);
    if (!toAcc) throw new Error('Recipient account not found');
    if (toAcc.status !== 'ACTIVE') throw new Error('Recipient account is not active');
    if (fromAccount.accountNumber === toAccount) throw new Error('Cannot transfer to same account');

    const toUser = await User.findById(toAcc.userId).session(session);

    // Calculate fee
    let fee = 0;
    if (type === 'RTGS') fee = amount > 500000 ? 55 : 25;
    else if (type === 'IMPS') fee = amount <= 1000 ? 1 : amount <= 100000 ? 5 : 15;
    else if (type === 'NEFT') fee = Math.min(amount * 0.001, 25);

    // Calculate cashback (0.1%)
    const cashback = Math.round(amount * 0.001 * 100) / 100;

    const txId = generateTransactionId();

    // Debit transaction
    const debitTx = await Transaction.create([{
      transactionId: txId,
      fromAccount: fromAccount.accountNumber,
      toAccount: toAcc.accountNumber,
      fromUserId: req.user.id,
      toUserId: toAcc.userId,
      amount,
      type: 'TRANSFER',
      channel: type,
      status: 'COMPLETED',
      description: description || `Transfer to ${toUser?.fullName || toAccount}`,
      fee,
      cashback,
      processedAt: new Date()
    }], { session });

    // Credit transaction
    const creditTxId = generateTransactionId();
    await Transaction.create([{
      transactionId: creditTxId,
      fromAccount: fromAccount.accountNumber,
      toAccount: toAcc.accountNumber,
      fromUserId: req.user.id,
      toUserId: toAcc.userId,
      amount,
      type: 'CREDIT',
      channel: type,
      status: 'COMPLETED',
      description: description || `Transfer from ${user.fullName}`,
      processedAt: new Date()
    }], { session });

    // Update balances
    fromAccount.balance -= (amount + fee);
    fromAccount.dailySpent += amount;
    fromAccount.monthlySpent += amount;
    fromAccount.lastTransactionAt = new Date();
    await fromAccount.save({ session });

    toAcc.balance += amount;
    toAcc.lastTransactionAt = new Date();
    await toAcc.save({ session });

    // Award cashback
    if (cashback > 0) {
      fromAccount.balance += cashback;
      await fromAccount.save({ session });
    }

    // Update rewards
    const points = Math.floor(amount / 100);
    await User.updateOne({ _id: req.user.id }, { $inc: { 'rewards.points': points, 'rewards.totalCashback': cashback } }, { session });

    await session.commitTransaction();

    // Notifications
    await createNotification(req.user.id, 'Transfer Successful', `₹${amount.toLocaleString()} sent to ${toUser?.fullName || toAccount}. TXN: ${txId}`, 'TRANSACTION', 'HIGH');
    await createNotification(toAcc.userId, 'Amount Received', `₹${amount.toLocaleString()} received from ${user.fullName}.`, 'TRANSACTION', 'HIGH');

    await auditLog(req.user.id, 'TRANSFER', 'TRANSACTION', 'INFO', { txId, toAccount, amount, type, fee }, req);

    res.json({
      success: true,
      message: 'Transfer successful',
      data: {
        transactionId: txId,
        amount,
        fee,
        cashback,
        newBalance: fromAccount.balance,
        points,
        status: 'COMPLETED'
      }
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error('Transfer error:', error);
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ============================================
// UPI SIMULATION
// ============================================
exports.createUPI = async (req, res, next) => {
  try {
    const { error } = schemas.upiCreate.validate(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    if (account.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Account is not active' });

    const requestedUpi = normalizeUPI(req.body?.upiId);
    if (account.upiId && !requestedUpi) {
      return res.json({ success: true, message: 'UPI ID already active', data: { upiId: account.upiId, accountNumber: account.accountNumber } });
    }

    let upiId = requestedUpi || `nxb${account.accountNumber.slice(-6).toLowerCase()}@nexbank`;
    if (await Account.exists({ upiId, _id: { $ne: account._id } })) {
      if (requestedUpi) return res.status(409).json({ success: false, message: 'UPI ID already exists' });
      let suffix = 1;
      while (await Account.exists({ upiId, _id: { $ne: account._id } })) {
        upiId = `nxb${account.accountNumber.slice(-6).toLowerCase()}${suffix}@nexbank`;
        suffix += 1;
      }
    }

    account.upiId = upiId;
    await account.save();

    await auditLog(req.user.id, 'UPI_CREATED', 'ACCOUNT', 'INFO', { upiId }, req);
    res.json({ success: true, message: 'UPI ID created', data: { upiId, accountNumber: account.accountNumber } });
  } catch (error) {
    logger.error('Create UPI error:', error);
    next(error);
  }
};

exports.sendUPIMoney = async (req, res, next) => {
  const session = await require('mongoose').startSession();
  try {
    session.startTransaction();

    const { error } = schemas.upiSend.validate(req.body);
    if (error) throw new Error(error.details[0].message);

    const { amount, pin, note } = req.body;
    const upiId = normalizeUPI(req.body.upiId);
    const user = await User.findById(req.user.id).select('+transactionPin').session(session);
    if (!user?.transactionPin) throw new Error('Transaction PIN not set');
    if (!(await bcrypt.compare(String(pin), user.transactionPin))) throw new Error('Invalid transaction PIN');

    const fromAccount = await Account.findOne({ userId: req.user.id }).session(session);
    if (!fromAccount) throw new Error('Source account not found');
    if (fromAccount.status !== 'ACTIVE') throw new Error('Source account is not active');
    if (!fromAccount.upiId) throw new Error('Create your UPI ID first');
    if (fromAccount.upiId === upiId) throw new Error('Cannot send money to your own UPI ID');
    if (fromAccount.balance - amount < fromAccount.minBalance) throw new Error('Insufficient balance');
    if (fromAccount.dailySpent + amount > fromAccount.dailyLimit) throw new Error('Daily transfer limit exceeded');
    if (fromAccount.monthlySpent + amount > fromAccount.monthlyLimit) throw new Error('Monthly transfer limit exceeded');

    const toAccount = await Account.findOne({ upiId }).session(session);
    if (!toAccount) throw new Error('Recipient UPI ID not found');
    if (toAccount.status !== 'ACTIVE') throw new Error('Recipient account is not active');

    const toUser = await User.findById(toAccount.userId).session(session);
    const txId = generateTransactionId();
    await Transaction.create([{
      transactionId: txId,
      fromAccount: fromAccount.accountNumber,
      toAccount: toAccount.accountNumber,
      fromUserId: req.user.id,
      toUserId: toAccount.userId,
      amount,
      type: 'TRANSFER',
      channel: 'UPI',
      status: 'COMPLETED',
      description: note || `UPI transfer to ${upiId}`,
      referenceId: upiId,
      processedAt: new Date()
    }], { session });

    await Transaction.create([{
      transactionId: generateTransactionId(),
      fromAccount: fromAccount.accountNumber,
      toAccount: toAccount.accountNumber,
      fromUserId: req.user.id,
      toUserId: toAccount.userId,
      amount,
      type: 'CREDIT',
      channel: 'UPI',
      status: 'COMPLETED',
      description: note || `UPI received from ${fromAccount.upiId}`,
      referenceId: fromAccount.upiId,
      processedAt: new Date()
    }], { session });

    fromAccount.balance -= amount;
    fromAccount.dailySpent += amount;
    fromAccount.monthlySpent += amount;
    fromAccount.lastTransactionAt = new Date();
    await fromAccount.save({ session });

    toAccount.balance += amount;
    toAccount.lastTransactionAt = new Date();
    await toAccount.save({ session });

    await session.commitTransaction();

    await createNotification(req.user.id, 'UPI Payment Sent', `₹${amount.toLocaleString()} sent to ${upiId}. TXN: ${txId}`, 'TRANSACTION', 'HIGH');
    await createNotification(toAccount.userId, 'UPI Payment Received', `₹${amount.toLocaleString()} received from ${fromAccount.upiId}.`, 'TRANSACTION', 'HIGH');
    await auditLog(req.user.id, 'UPI_SEND', 'TRANSACTION', 'INFO', { txId, upiId, amount }, req);

    res.json({ success: true, message: 'UPI payment successful', data: { transactionId: txId, amount, toUpiId: upiId, recipient: toUser?.fullName, newBalance: fromAccount.balance } });
  } catch (error) {
    await session.abortTransaction();
    logger.error('UPI send error:', error);
    res.status(400).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

exports.receiveUPIMoney = async (req, res, next) => {
  try {
    const { error } = schemas.upiReceive.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { amount, note } = req.body;
    const fromUpiId = normalizeUPI(req.body.fromUpiId) || 'simulated@upi';
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    if (account.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Account is not active' });
    if (!account.upiId) return res.status(400).json({ success: false, message: 'Create your UPI ID first' });

    const txId = generateTransactionId();
    await Transaction.create({
      transactionId: txId,
      fromAccount: fromUpiId,
      toAccount: account.accountNumber,
      fromUserId: null,
      toUserId: req.user.id,
      amount,
      type: 'CREDIT',
      channel: 'UPI',
      status: 'COMPLETED',
      description: note || `UPI received from ${fromUpiId}`,
      referenceId: fromUpiId,
      processedAt: new Date()
    });

    account.balance += amount;
    account.lastTransactionAt = new Date();
    await account.save();

    await createNotification(req.user.id, 'UPI Payment Received', `₹${amount.toLocaleString()} received via UPI. TXN: ${txId}`, 'TRANSACTION', 'HIGH');
    await auditLog(req.user.id, 'UPI_RECEIVE_SIMULATED', 'TRANSACTION', 'INFO', { txId, fromUpiId, amount }, req);
    res.json({ success: true, message: 'UPI money received', data: { transactionId: txId, amount, fromUpiId, newBalance: account.balance } });
  } catch (error) {
    logger.error('UPI receive error:', error);
    next(error);
  }
};

exports.getUPIHistory = async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const transactions = await Transaction.find({
      channel: 'UPI',
      $or: [{ fromAccount: account.accountNumber }, { toAccount: account.accountNumber }]
    }).sort({ createdAt: -1 }).limit(50);

    res.json({ success: true, data: { upiId: account.upiId, transactions } });
  } catch (error) {
    logger.error('UPI history error:', error);
    next(error);
  }
};

// ============================================
// GET TRANSACTION HISTORY
// ============================================
exports.getTransactionHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, type, status, startDate, endDate, category, search, minAmount, maxAmount } = req.query;

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const filter = {
      $or: [{ fromAccount: account.accountNumber }, { toAccount: account.accountNumber }]
    };

    if (type) filter.type = type;
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    if (minAmount || maxAmount) {
      filter.amount = {};
      if (minAmount) filter.amount.$gte = Number(minAmount);
      if (maxAmount) filter.amount.$lte = Number(maxAmount);
    }
    if (search) {
      filter.$or = [
        { transactionId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { toAccount: { $regex: search, $options: 'i' } },
        { fromAccount: { $regex: search, $options: 'i' } }
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
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Transaction history error:', error);
    next(error);
  }
};

// ============================================
// DIGITAL PASSBOOK
// ============================================
exports.getPassbook = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, startDate, endDate } = req.query;
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const filter = {
      $or: [{ fromAccount: account.accountNumber }, { toAccount: account.accountNumber }],
      status: 'COMPLETED'
    };

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(filter).sort({ createdAt: 1, _id: 1 });
    const getImpact = (tx) => {
      if (tx.fromAccount === account.accountNumber) return -tx.amount;
      if (tx.toAccount === account.accountNumber && tx.type !== 'TRANSFER') return tx.amount;
      return 0;
    };

    const openingBalance = Math.round((account.balance - transactions.reduce((sum, tx) => sum + getImpact(tx), 0)) * 100) / 100;
    let runningBalance = openingBalance;
    const entries = transactions.map((tx) => {
      const impact = getImpact(tx);
      runningBalance = Math.round((runningBalance + impact) * 100) / 100;
      return {
        transactionId: tx.transactionId,
        date: tx.createdAt,
        description: tx.description || tx.type,
        type: impact < 0 ? 'DEBIT' : 'CREDIT',
        channel: tx.channel,
        amount: tx.amount,
        signedAmount: Math.round(impact * 100) / 100,
        balance: runningBalance,
        status: tx.status,
        referenceId: tx.referenceId || tx.utr || tx.transactionId
      };
    }).filter(entry => entry.signedAmount !== 0);

    const pageNumber = parseInt(page);
    const pageLimit = parseInt(limit);
    const start = (pageNumber - 1) * pageLimit;

    res.json({
      success: true,
      data: {
        account: {
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          ifsc: account.ifsc,
          currency: account.currency
        },
        openingBalance,
        closingBalance: account.balance,
        entries: entries.slice(start, start + pageLimit),
        pagination: {
          page: pageNumber,
          limit: pageLimit,
          total: entries.length,
          pages: Math.ceil(entries.length / pageLimit)
        }
      }
    });
  } catch (error) {
    logger.error('Passbook error:', error);
    next(error);
  }
};

// ============================================
// GET TRANSACTION BY ID
// ============================================
exports.getTransaction = async (req, res, next) => {
  try {
    const transaction = await Transaction.findOne({ transactionId: req.params.id });
    if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });

    res.json({ success: true, data: transaction });
  } catch (error) {
    logger.error('Get transaction error:', error);
    next(error);
  }
};

// ============================================
// DOWNLOAD STATEMENT
// ============================================
exports.downloadStatement = async (req, res, next) => {
  try {
    const { startDate, endDate, format = 'pdf' } = req.query;

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const fromDate = startDate ? new Date(startDate) : null;
    const toDate = endDate ? new Date(endDate) : null;
    if (fromDate && Number.isNaN(fromDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid start date' });
    if (toDate && Number.isNaN(toDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid end date' });
    if (toDate) toDate.setHours(23, 59, 59, 999);
    if (fromDate && toDate && fromDate > toDate) return res.status(400).json({ success: false, message: 'Start date must be before end date' });

    const filter = {
      $or: [{ fromAccount: account.accountNumber }, { toAccount: account.accountNumber }],
      status: 'COMPLETED'
    };
    if (fromDate || toDate) filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = fromDate;
    if (toDate) filter.createdAt.$lte = toDate;

    const transactions = await Transaction.find(filter).sort({ createdAt: 1 });
    const summary = transactions.reduce((acc, tx) => {
      const isDebit = tx.fromAccount === account.accountNumber;
      const amount = Number(tx.amount) || 0;
      if (isDebit) {
        acc.totalDebits += amount;
        acc.debitCount += 1;
      } else {
        acc.totalCredits += amount;
        acc.creditCount += 1;
      }
      acc.transactionCount += 1;
      return acc;
    }, { transactionCount: 0, creditCount: 0, debitCount: 0, totalCredits: 0, totalDebits: 0 });
    summary.netMovement = Math.round((summary.totalCredits - summary.totalDebits) * 100) / 100;
    summary.totalCredits = Math.round(summary.totalCredits * 100) / 100;
    summary.totalDebits = Math.round(summary.totalDebits * 100) / 100;

    if (format === 'json') {
      return res.json({ success: true, data: { account, transactions, summary, period: { startDate: startDate || null, endDate: endDate || null } } });
    }

    // PDF generation
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=statement-${account.accountNumber}-${startDate || 'all'}-${endDate || 'all'}.pdf`);

    doc.pipe(res);
    doc.fontSize(24).text('NexBank', { align: 'center' });
    doc.fontSize(16).text('Monthly Account Statement', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).text(`Account: ${account.accountNumber}`);
    doc.text(`IFSC: ${account.ifsc}`);
    doc.text(`Balance: Rs. ${account.balance.toLocaleString()}`);
    doc.text(`Period: ${startDate || 'All'} to ${endDate || 'All'}`);
    doc.moveDown();
    doc.fontSize(13).text('Transaction Summary', { underline: true });
    doc.fontSize(10).text(`Total Transactions: ${summary.transactionCount}`);
    doc.text(`Credits: ${summary.creditCount} | Rs. ${summary.totalCredits.toLocaleString()}`);
    doc.text(`Debits: ${summary.debitCount} | Rs. ${summary.totalDebits.toLocaleString()}`);
    doc.text(`Net Movement: Rs. ${summary.netMovement.toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(13).text('Transactions', { underline: true });
    doc.moveDown(0.5);

    if (!transactions.length) {
      doc.fontSize(10).text('No completed transactions found for this period.');
    }

    transactions.forEach((tx) => {
      const isDebit = tx.fromAccount === account.accountNumber;
      doc.fontSize(10)
        .text(`${tx.createdAt.toISOString().split('T')[0]}  ${tx.transactionId}  ${tx.description?.substring(0, 30) || ''}  ${isDebit ? 'DR' : 'CR'}  Rs. ${tx.amount.toLocaleString()}  ${tx.status}`, { lineGap: 4 });
    });

    doc.end();
  } catch (error) {
    logger.error('Download statement error:', error);
    next(error);
  }
};

// ============================================
// BENEFICIARY OPERATIONS
// ============================================
exports.addBeneficiary = async (req, res, next) => {
  try {
    const { error } = schemas.beneficiary.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { name, accountNumber, ifsc, bank, nickname, type } = req.body;

    const existing = await Beneficiary.findOne({ userId: req.user.id, accountNumber, status: 'ACTIVE' });
    if (existing) return res.status(409).json({ success: false, message: 'Beneficiary already exists' });

    const beneficiary = await Beneficiary.create({
      userId: req.user.id,
      name,
      accountNumber,
      ifsc,
      bank,
      nickname,
      type: type || 'IMPS',
      status: 'ACTIVE',
      isVerified: true
    });

    await createNotification(req.user.id, 'Beneficiary Added', `${name} (${accountNumber}) added as beneficiary.`, 'SYSTEM', 'MEDIUM');
    await auditLog(req.user.id, 'BENEFICIARY_ADDED', 'TRANSACTION', 'INFO', { name, accountNumber }, req);

    res.status(201).json({ success: true, message: 'Beneficiary added successfully', data: beneficiary });
  } catch (error) {
    logger.error('Add beneficiary error:', error);
    next(error);
  }
};

exports.getBeneficiaries = async (req, res, next) => {
  try {
    const beneficiaries = await Beneficiary.find({ userId: req.user.id, status: 'ACTIVE' }).sort({ isFavorite: -1, lastTransferredAt: -1 });
    res.json({ success: true, data: beneficiaries });
  } catch (error) {
    logger.error('Get beneficiaries error:', error);
    next(error);
  }
};

exports.deleteBeneficiary = async (req, res, next) => {
  try {
    const beneficiary = await Beneficiary.findOne({ _id: req.params.id, userId: req.user.id });
    if (!beneficiary) return res.status(404).json({ success: false, message: 'Beneficiary not found' });

    beneficiary.status = 'DELETED';
    await beneficiary.save();

    await auditLog(req.user.id, 'BENEFICIARY_DELETED', 'TRANSACTION', 'INFO', { name: beneficiary.name }, req);

    res.json({ success: true, message: 'Beneficiary removed' });
  } catch (error) {
    logger.error('Delete beneficiary error:', error);
    next(error);
  }
};

exports.toggleFavorite = async (req, res, next) => {
  try {
    const beneficiary = await Beneficiary.findOne({ _id: req.params.id, userId: req.user.id });
    if (!beneficiary) return res.status(404).json({ success: false, message: 'Beneficiary not found' });

    beneficiary.isFavorite = !beneficiary.isFavorite;
    await beneficiary.save();

    res.json({ success: true, data: beneficiary });
  } catch (error) {
    logger.error('Toggle favorite error:', error);
    next(error);
  }
};

// ============================================
// CARD OPERATIONS
// ============================================
exports.createVirtualCard = async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const user = await User.findById(req.user.id);
    const cardNumber = generateCardNumber();
    const cvv = generateCVV();
    const now = new Date();
    const expiryMonth = String(now.getMonth() + 1).padStart(2, '0');
    const expiryYear = String(now.getFullYear() + 5);

    const hashedCVV = await bcrypt.hash(cvv, 10);
    const hashedPin = await bcrypt.hash('0000', 10);

    const card = await Card.create({
      userId: req.user.id,
      accountId: account._id,
      cardNumber: await bcrypt.hash(cardNumber, 10),
      encryptedCardNumber: encrypt(cardNumber),
      cardLast4: cardNumber.slice(-4),
      cardType: 'VIRTUAL',
      cardNetwork: 'VISA',
      cardHolderName: user.fullName.toUpperCase(),
      expiryMonth,
      expiryYear,
      cvv: hashedCVV,
      encryptedCVV: encrypt(cvv),
      pin: hashedPin,
      isVirtual: true,
      status: 'ACTIVE'
    });

    await createNotification(req.user.id, 'Virtual Card Created', 'Your virtual debit card has been created.', 'CARD', 'HIGH');
    await auditLog(req.user.id, 'VIRTUAL_CARD_CREATED', 'CARD', 'INFO', null, req);

    res.status(201).json({
      success: true,
      message: 'Virtual card created',
      data: {
        id: card._id,
        cardNumber: `**** **** **** ${cardNumber.slice(-4)}`,
        fullCardNumber: cardNumber,
        cvv,
        expiry: `${expiryMonth}/${expiryYear}`,
        cardHolderName: card.cardHolderName,
        type: 'VIRTUAL',
        network: 'VISA'
      }
    });
  } catch (error) {
    logger.error('Create virtual card error:', error);
    next(error);
  }
};

exports.getCards = async (req, res, next) => {
  try {
    const cards = await Card.find({ userId: req.user.id, status: { $ne: 'CANCELLED' } })
      .select('-cvv -pin');
    res.json({ success: true, data: cards.map(cardResponse) });
  } catch (error) {
    logger.error('Get cards error:', error);
    next(error);
  }
};

exports.revealCard = async (req, res, next) => {
  try {
    const { pin } = req.body;
    if (!/^\d{4}$|^\d{6}$/.test(String(pin || ''))) {
      return res.status(400).json({ success: false, message: 'Valid PIN required' });
    }

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user?.transactionPin) return res.status(400).json({ success: false, message: 'Transaction PIN not set' });
    const validPin = await bcrypt.compare(String(pin), user.transactionPin);
    if (!validPin) return res.status(401).json({ success: false, message: 'Invalid PIN' });

    const card = await Card.findOne({ _id: req.params.id, userId: req.user.id }).select('+encryptedCardNumber +encryptedCVV +cvv');
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });
    if (!card.encryptedCardNumber && /^\d{16}$/.test(card.cardNumber || '')) {
      await auditLog(req.user.id, 'CARD_REVEALED', 'CARD', 'WARN', { cardId: card._id, legacy: true }, req);
      return res.json({
        success: true,
        data: {
          cardNumber: card.cardNumber,
          cvv: /^\d{3}$/.test(card.cvv || '') ? card.cvv : '***',
          expiryMonth: card.expiryMonth,
          expiryYear: card.expiryYear,
        }
      });
    }
    if (!card.encryptedCardNumber || !card.encryptedCVV) {
      return res.status(400).json({ success: false, message: 'This card was created before secure reveal support. Create a new virtual card to view full details.' });
    }

    await auditLog(req.user.id, 'CARD_REVEALED', 'CARD', 'WARN', { cardId: card._id }, req);
    res.json({
      success: true,
      data: {
        cardNumber: decrypt(card.encryptedCardNumber),
        cvv: decrypt(card.encryptedCVV),
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
      }
    });
  } catch (error) {
    logger.error('Reveal card error:', error);
    next(error);
  }
};

exports.unblockCard = async (req, res, next) => {
  try {
    const card = await Card.findOne({ _id: req.params.id, userId: req.user.id });
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });
    card.status = 'ACTIVE';
    await card.save();
    await createNotification(req.user.id, 'Card Unblocked', `Card ending ${card.cardLast4 || '****'} has been unblocked.`, 'CARD', 'HIGH');
    await auditLog(req.user.id, 'CARD_UNBLOCKED', 'CARD', 'INFO', { cardId: card._id }, req);
    res.json({ success: true, message: 'Card unblocked successfully' });
  } catch (error) { logger.error('Unblock card error:', error); next(error); }
};

exports.breakFD = async (req, res, next) => {
  try {
    const fd = await FixedDeposit.findOne({ _id: req.params.id, userId: req.user.id });
    if (!fd) return res.status(404).json({ success: false, message: 'FD not found' });
    if (fd.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'FD is not active' });

    const maturityDetails = getFDMaturityDetails(fd);
    const returnAmount = maturityDetails.prematureReturnAmount;

    fd.status = 'PREMATURE_CLOSED';
    fd.prematurePenalty = maturityDetails.prematurePenalty;
    fd.closedAt = new Date();
    await fd.save();

    // Credit back to account
    const account = await Account.findById(fd.accountId);
    if (account) {
      account.balance += returnAmount;
      account.lastTransactionAt = new Date();
      await account.save();
      await Transaction.create({
        transactionId: generateTransactionId(),
        fromAccount: 'FD_CLOSURE',
        toAccount: account.accountNumber,
        fromUserId: req.user.id,
        toUserId: req.user.id,
        amount: returnAmount,
        type: 'CREDIT',
        channel: 'INTERNAL',
        status: 'COMPLETED',
        description: `Premature FD closure ${fd.fdNumber}`,
        category: 'INVESTMENT',
        processedAt: new Date()
      });
    }

    await createNotification(req.user.id, 'FD Broken', `FD ${fd.fdNumber} closed prematurely. ₹${returnAmount.toLocaleString()} credited.`, 'TRANSACTION', 'HIGH');
    await auditLog(req.user.id, 'FD_BROKEN', 'TRANSACTION', 'INFO', { fdNumber: fd.fdNumber, returnAmount, penalty: fd.prematurePenalty }, req);
    res.json({ success: true, message: 'FD broken successfully', data: { returnAmount, penalty: fd.prematurePenalty, newBalance: account?.balance } });
  } catch (error) { logger.error('Break FD error:', error); next(error); }
};

exports.blockCard = async (req, res, next) => {
  try {
    const card = await Card.findOne({ _id: req.params.id, userId: req.user.id });
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });

    card.status = 'BLOCKED';
    await card.save();

    await createNotification(req.user.id, 'Card Blocked', `Your card ending ${card.cardLast4 || '****'} has been blocked.`, 'CARD', 'HIGH');
    await auditLog(req.user.id, 'CARD_BLOCKED', 'CARD', 'INFO', { cardId: card._id }, req);

    res.json({ success: true, message: 'Card blocked successfully' });
  } catch (error) {
    logger.error('Block card error:', error);
    next(error);
  }
};

exports.updateCardLimits = async (req, res, next) => {
  try {
    const { dailyLimit, monthlyLimit } = req.body;
    const card = await Card.findOne({ _id: req.params.id, userId: req.user.id });
    if (!card) return res.status(404).json({ success: false, message: 'Card not found' });

    if (dailyLimit) card.dailyLimit = dailyLimit;
    if (monthlyLimit) card.monthlyLimit = monthlyLimit;
    await card.save();

    res.json({ success: true, message: 'Card limits updated', data: card });
  } catch (error) {
    logger.error('Update card limits error:', error);
    next(error);
  }
};

// ============================================
// LOAN OPERATIONS
// ============================================
exports.applyLoan = async (req, res, next) => {
  try {
    const { error } = schemas.loanApply.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { type, amount, tenure } = req.body;
    const user = await User.findById(req.user.id);
    const account = await Account.findOne({ userId: req.user.id });

    if (!account || account.balance < account.minBalance) {
      return res.status(400).json({ success: false, message: 'Insufficient account balance for loan eligibility' });
    }

    // Interest rates by loan type
    const rates = { PERSONAL: 12.5, HOME: 8.5, CAR: 9.5, EDUCATION: 7.5, BUSINESS: 14.0, GOLD: 8.0 };
    const interestRate = req.body.interestRate || rates[type] || 12.0;
    const emi = calculateEMI(amount, interestRate, tenure);
    const totalPayable = emi * tenure;
    const totalInterest = totalPayable - amount;

    const loanNumber = `LOAN${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    // Generate EMI schedule
    const schedule = [];
    let balance = amount;
    const monthlyRate = interestRate / 12 / 100;
    const startDate = new Date();

    for (let i = 1; i <= tenure; i++) {
      const interest = balance * monthlyRate;
      const principal = emi - interest;
      balance -= principal;

      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      schedule.push({
        month: i,
        emiAmount: emi,
        principal: Math.round(principal * 100) / 100,
        interest: Math.round(interest * 100) / 100,
        balance: Math.round(Math.max(0, balance) * 100) / 100,
        dueDate,
        status: 'PENDING'
      });
    }

    const loan = await Loan.create({
      userId: req.user.id,
      loanType: type,
      loanNumber,
      principal: amount,
      interestRate,
      tenure,
      emi,
      outstandingAmount: amount,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalPayable: Math.round(totalPayable * 100) / 100,
      status: 'APPLIED',
      startDate,
      endDate: schedule[schedule.length - 1]?.dueDate,
      nextEmiDate: schedule[0]?.dueDate,
      schedule
    });

    await createNotification(req.user.id, 'Loan Application Submitted', `Your ${type} loan of ₹${amount.toLocaleString()} has been submitted. Loan No: ${loanNumber}`, 'LOAN', 'HIGH');
    await auditLog(req.user.id, 'LOAN_APPLIED', 'TRANSACTION', 'INFO', { loanNumber, type, amount }, req);

    res.status(201).json({
      success: true,
      message: 'Loan application submitted',
      data: { loan, emiSchedule: schedule }
    });
  } catch (error) {
    logger.error('Loan apply error:', error);
    next(error);
  }
};

exports.emiCalculator = async (req, res, next) => {
  try {
    const { principal, rate, tenure } = req.query;
    if (!principal || !rate || !tenure) {
      return res.status(400).json({ success: false, message: 'Principal, rate and tenure required' });
    }

    const emi = calculateEMI(Number(principal), Number(rate), Number(tenure));
    const totalPayable = emi * Number(tenure);
    const totalInterest = totalPayable - Number(principal);

    res.json({
      success: true,
      data: {
        emi,
        totalPayable: Math.round(totalPayable * 100) / 100,
        totalInterest: Math.round(totalInterest * 100) / 100,
        principal: Number(principal),
        rate: Number(rate),
        tenure: Number(tenure)
      }
    });
  } catch (error) {
    logger.error('EMI calculator error:', error);
    next(error);
  }
};

exports.getLoans = async (req, res, next) => {
  try {
    const loans = await Loan.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, data: loans });
  } catch (error) {
    logger.error('Get loans error:', error);
    next(error);
  }
};

// ============================================
// FIXED DEPOSIT
// ============================================
exports.createFD = async (req, res, next) => {
  try {
    const { error } = schemas.fdCreate.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { amount, plan = '1Y', tenure, interestRate: customRate } = req.body;
    const principal = Number(amount);
    if (!principal) return res.status(400).json({ success: false, message: 'Amount required' });
    if (principal < 1000) return res.status(400).json({ success: false, message: 'Minimum FD amount is ₹1,000' });

    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });
    if (account.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Account is not active' });
    if (account.balance - principal < account.minBalance) return res.status(400).json({ success: false, message: 'Insufficient balance' });

    const fdPlan = FD_PLANS[plan] || FD_PLANS['1Y'];
    const fdTenure = Number(tenure) || fdPlan.days;
    const rate = Number(customRate) || fdPlan.rate;
    const { maturityAmount, interestEarned } = calculateFD(principal, rate, fdTenure);
    const maturityDate = new Date();
    maturityDate.setDate(maturityDate.getDate() + fdTenure);
    const fdNumber = `FD${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const fd = await FixedDeposit.create({
      userId: req.user.id,
      accountId: account._id,
      fdNumber,
      principal,
      interestRate: rate,
      tenureDays: fdTenure,
      maturityAmount,
      interestEarned,
      maturityDate
    });

    account.balance -= principal;
    account.lastTransactionAt = new Date();
    await account.save();

    await Transaction.create({
      transactionId: generateTransactionId(),
      fromAccount: account.accountNumber,
      toAccount: 'FIXED_DEPOSIT',
      fromUserId: req.user.id,
      toUserId: req.user.id,
      amount: principal,
      type: 'DEBIT',
      channel: 'INTERNAL',
      status: 'COMPLETED',
      description: `Fixed deposit created ${fdNumber}`,
      category: 'INVESTMENT',
      processedAt: new Date()
    });

    await createNotification(req.user.id, 'Fixed Deposit Created', `FD of ₹${principal.toLocaleString()} for ${fdPlan.label}. Maturity: ₹${maturityAmount.toLocaleString()}`, 'SYSTEM', 'HIGH');
    await auditLog(req.user.id, 'FD_CREATED', 'TRANSACTION', 'INFO', { fdNumber, principal, plan, fdTenure, rate }, req);

    res.status(201).json({ success: true, message: 'FD created', data: fd });
  } catch (error) {
    logger.error('Create FD error:', error);
    next(error);
  }
};

// ============================================
// RECURRING DEPOSIT
// ============================================
exports.createRD = async (req, res, next) => {
  try {
    const { monthlyInstallment, tenure, interestRate: customRate } = req.body;
    if (!monthlyInstallment || !tenure) return res.status(400).json({ success: false, message: 'Installment and tenure required' });
    if (monthlyInstallment < 500) return res.status(400).json({ success: false, message: 'Minimum monthly installment is ₹500' });

    const rate = customRate || 6.5;
    const { maturityAmount, totalDeposited, interestEarned } = calculateRD(monthlyInstallment, rate, tenure);
    const maturityDate = new Date();
    maturityDate.setMonth(maturityDate.getMonth() + tenure);
    const rdNumber = `RD${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + 1);

    const rd = await RecurringDeposit.create({
      userId: req.user.id,
      accountId: (await Account.findOne({ userId: req.user.id }))._id,
      rdNumber,
      monthlyInstallment,
      interestRate: rate,
      tenureMonths: tenure,
      maturityAmount,
      totalDeposited,
      interestEarned,
      maturityDate,
      nextDueDate: nextDue
    });

    res.status(201).json({ success: true, message: 'RD created', data: rd });
  } catch (error) {
    logger.error('Create RD error:', error);
    next(error);
  }
};

// ============================================
// BILL PAYMENT
// ============================================
exports.payBill = async (req, res, next) => {
  try {
    const { error } = schemas.billPayment.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { category, provider, consumerNumber, amount, pin } = req.body;

    const user = await User.findById(req.user.id).select('+transactionPin');
    if (!user.transactionPin) return res.status(400).json({ success: false, message: 'Set transaction PIN first' });
    const validPin = await bcrypt.compare(String(pin), user.transactionPin);
    if (!validPin) return res.status(401).json({ success: false, message: 'Invalid PIN' });

    const account = await Account.findOne({ userId: req.user.id });
    if (account.balance - amount < account.minBalance) return res.status(400).json({ success: false, message: 'Insufficient balance' });

    const txId = generateTransactionId();
    await Transaction.create({
      transactionId: txId,
      fromAccount: account.accountNumber,
      toAccount: `BILL_${category}`,
      fromUserId: req.user.id,
      amount,
      type: 'DEBIT',
      channel: 'ONLINE',
      status: 'COMPLETED',
      description: `${category} bill - ${provider}`,
      category: 'BILLS',
      processedAt: new Date()
    });

    account.balance -= amount;
    await account.save();

    const bill = await Bill.create({
      userId: req.user.id,
      category,
      provider,
      consumerNumber,
      amount,
      status: 'PAID',
      transactionId: txId,
      paidAt: new Date()
    });

    await createNotification(req.user.id, 'Bill Paid', `₹${amount.toLocaleString()} paid for ${category} (${provider}). TXN: ${txId}`, 'TRANSACTION', 'HIGH');

    res.json({ success: true, message: 'Bill paid successfully', data: { bill, transactionId: txId } });
  } catch (error) {
    logger.error('Bill payment error:', error);
    next(error);
  }
};

// ============================================
// SCHEDULE PAYMENT
// ============================================
exports.schedulePayment = async (req, res, next) => {
  try {
    const { toAccount, amount, frequency, startDate, endDate, description } = req.body;
    if (!toAccount || !amount || !frequency || !startDate) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const account = await Account.findOne({ userId: req.user.id });
    const payment = await ScheduledPayment.create({
      userId: req.user.id,
      fromAccount: account.accountNumber,
      toAccount,
      amount,
      description,
      frequency,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      nextExecution: new Date(startDate),
      status: 'ACTIVE'
    });

    await createNotification(req.user.id, 'Payment Scheduled', `${frequency} payment of ₹${amount.toLocaleString()} scheduled starting ${new Date(startDate).toLocaleDateString()}`, 'SYSTEM', 'MEDIUM');

    res.status(201).json({ success: true, message: 'Payment scheduled', data: payment });
  } catch (error) {
    logger.error('Schedule payment error:', error);
    next(error);
  }
};

exports.getScheduledPayments = async (req, res, next) => {
  try {
    const payments = await ScheduledPayment.find({ userId: req.user.id, status: 'ACTIVE' }).sort({ nextExecution: 1 });
    res.json({ success: true, data: payments });
  } catch (error) {
    logger.error('Get scheduled payments error:', error);
    next(error);
  }
};

// ============================================
// PAYMENT REQUEST
// ============================================
exports.createPaymentRequest = async (req, res, next) => {
  try {
    const { toEmail, amount, description } = req.body;
    if (!toEmail || !amount) return res.status(400).json({ success: false, message: 'Email and amount required' });

    const toUser = await User.findOne({ email: toEmail.toLowerCase() });
    if (!toUser) return res.status(404).json({ success: false, message: 'User not found' });

    const request = await PaymentRequest.create({
      fromUserId: req.user.id,
      toUserId: toUser._id,
      amount,
      description,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    await createNotification(toUser._id, 'Payment Request', `${req.user.fullName} requested ₹${amount.toLocaleString()}. ${description || ''}`, 'TRANSACTION', 'HIGH');

    res.status(201).json({ success: true, message: 'Payment request sent', data: request });
  } catch (error) {
    logger.error('Payment request error:', error);
    next(error);
  }
};

// ============================================
// GET FDs / RDs
// ============================================
exports.getFDs = async (req, res, next) => {
  try {
    await syncMaturedFDs(req.user.id);
    const filter = { userId: req.user.id };
    if (req.query.status) filter.status = String(req.query.status).toUpperCase();
    const fds = await FixedDeposit.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: { plans: FD_PLANS, fds } });
  } catch (error) { next(error); }
};

exports.getFDStatusSummary = async (req, res, next) => {
  try {
    await syncMaturedFDs(req.user.id);
    const [active, matured, prematureClosed, cancelled, total] = await Promise.all([
      FixedDeposit.countDocuments({ userId: req.user.id, status: 'ACTIVE' }),
      FixedDeposit.countDocuments({ userId: req.user.id, status: 'MATURED' }),
      FixedDeposit.countDocuments({ userId: req.user.id, status: 'PREMATURE_CLOSED' }),
      FixedDeposit.countDocuments({ userId: req.user.id, status: 'CANCELLED' }),
      FixedDeposit.countDocuments({ userId: req.user.id })
    ]);

    res.json({
      success: true,
      data: {
        active,
        completed: matured + prematureClosed,
        matured,
        prematureClosed,
        cancelled,
        total
      }
    });
  } catch (error) {
    logger.error('Get FD status summary error:', error);
    next(error);
  }
};

exports.getFDDetails = async (req, res, next) => {
  try {
    await syncMaturedFDs(req.user.id);
    const fd = await FixedDeposit.findOne({ _id: req.params.id, userId: req.user.id });
    if (!fd) return res.status(404).json({ success: false, message: 'FD not found' });

    res.json({
      success: true,
      data: {
        fd,
        maturity: getFDMaturityDetails(fd)
      }
    });
  } catch (error) {
    logger.error('Get FD details error:', error);
    next(error);
  }
};

exports.getFDMaturity = async (req, res, next) => {
  try {
    await syncMaturedFDs(req.user.id);
    const fd = await FixedDeposit.findOne({ _id: req.params.id, userId: req.user.id });
    if (!fd) return res.status(404).json({ success: false, message: 'FD not found' });

    res.json({ success: true, data: getFDMaturityDetails(fd) });
  } catch (error) {
    logger.error('Get FD maturity error:', error);
    next(error);
  }
};

exports.getRDs = async (req, res, next) => {
  try {
    const rds = await RecurringDeposit.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json({ success: true, data: rds });
  } catch (error) { next(error); }
};

// ============================================
// CHEQUE SERVICES
// ============================================
exports.requestChequeBook = async (req, res, next) => {
  try {
    const { leavesCount = 25 } = req.body;
    const account = await Account.findOne({ userId: req.user.id });
    const startNum = Math.floor(Math.random() * 900000 + 100000);
    const cheque = await Cheque.create({
      userId: req.user.id,
      accountId: account._id,
      chequeNumber: String(startNum),
      leavesCount,
      startCheque: String(startNum),
      endCheque: String(startNum + leavesCount - 1),
      status: 'ISSUED'
    });

    await createNotification(req.user.id, 'Cheque Book Requested', `A cheque book with ${leavesCount} leaves has been requested.`, 'SYSTEM', 'MEDIUM');

    res.status(201).json({ success: true, message: 'Cheque book requested', data: cheque });
  } catch (error) {
    logger.error('Cheque book error:', error);
    next(error);
  }
};

// ============================================
// SPENDING ANALYTICS
// ============================================
exports.getSpendingAnalytics = async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    const { period = 'month' } = req.query;

    let startDate = new Date();
    if (period === 'week') startDate.setDate(startDate.getDate() - 7);
    else if (period === 'month') startDate.setMonth(startDate.getMonth() - 1);
    else if (period === 'year') startDate.setFullYear(startDate.getFullYear() - 1);

    const categoryBreakdown = await Transaction.aggregate([
      {
        $match: {
          fromAccount: account.accountNumber,
          status: 'COMPLETED',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$category',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }
    ]);

    const dailySpending = await Transaction.aggregate([
      {
        $match: {
          fromAccount: account.accountNumber,
          status: 'COMPLETED',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const totalSpent = categoryBreakdown.reduce((sum, cat) => sum + cat.total, 0);
    const avgDaily = totalSpent / (dailySpending.length || 1);

    // AI predictions
    const predictions = {
      nextMonthEstimate: Math.round(avgDaily * 30 * 100) / 100,
      topCategory: categoryBreakdown[0]?._id || 'NONE',
      savingsPotential: Math.round(totalSpent * 0.15 * 100) / 100,
      insights: []
    };

    if (categoryBreakdown.length > 0) {
      const topCat = categoryBreakdown[0];
      const percentage = ((topCat.total / totalSpent) * 100).toFixed(1);
      predictions.insights.push(`You spend ${percentage}% on ${topCat._id}`);
    }
    if (dailySpending.length > 7) {
      predictions.insights.push('Consider setting weekly spending limits');
    }

    res.json({
      success: true,
      data: {
        categoryBreakdown,
        dailySpending,
        totalSpent,
        averageDaily: Math.round(avgDaily * 100) / 100,
        predictions,
        period
      }
    });
  } catch (error) {
    logger.error('Spending analytics error:', error);
    next(error);
  }
};
