const { Notification, KYC, User, Transaction, Account, Card, FixedDeposit, Loan } = require('../models');
const { logger, upload } = require('../config');
const { auditLog } = require('../services');
const cloudinary = require('cloudinary').v2;

const analyzeKYC = async (kyc, userId) => {
  const user = await User.findById(userId);
  const hasPan = kyc.documents.some(d => d.type === 'PAN' && d.frontImage && d.number);
  const hasAadhaar = kyc.documents.some(d => d.type === 'AADHAAR' && d.frontImage && d.number);
  const hasProfile = !!user?.profileImage;
  const hasSelfie = !!kyc.selfieImage;
  let confidence = 0;

  if (hasPan) confidence += 25;
  if (hasAadhaar) confidence += 25;
  if (hasProfile) confidence += 20;
  if (hasSelfie) confidence += 20;
  if (hasProfile && hasSelfie) confidence += 10;

  kyc.confidenceScore = Math.min(confidence, 100);
  kyc.panVerified = hasPan;
  kyc.aadhaarVerified = hasAadhaar;
  kyc.addressVerified = hasAadhaar;

  if (!hasPan || !hasAadhaar || !hasProfile || !hasSelfie) {
    kyc.status = 'PENDING';
    kyc.remarks = 'Missing required KYC documents';
  } else if (kyc.confidenceScore >= 85) {
    kyc.status = 'APPROVED';
    kyc.level = 3;
    kyc.reviewedAt = new Date();
    kyc.remarks = 'Auto-approved by KYC validation';
    await User.updateOne({ _id: userId }, { isKYCVerified: true, kycLevel: 3 });
  } else {
    kyc.status = 'IN_REVIEW';
    kyc.remarks = 'Marked for manual review by KYC validation';
  }
};

// ============================================
// NOTIFICATION CONTROLLERS
// ============================================

exports.getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, type, isRead } = req.query;
    const filter = { userId: req.user.id };
    if (type) filter.type = type;
    if (isRead !== undefined) filter.isRead = isRead === 'true';

    const total = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: { notifications, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) } }
    });
  } catch (error) {
    logger.error('Get notifications error:', error);
    next(error);
  }
};

exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user.id, isRead: false });
    res.json({ success: true, data: { count } });
  } catch (error) {
    logger.error('Unread count error:', error);
    next(error);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user.id }, { isRead: true, readAt: new Date() });
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    logger.error('Mark as read error:', error);
    next(error);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ userId: req.user.id, isRead: false }, { isRead: true, readAt: new Date() });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    logger.error('Mark all read error:', error);
    next(error);
  }
};

exports.deleteNotification = async (req, res, next) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, userId: req.user.id });
    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    logger.error('Delete notification error:', error);
    next(error);
  }
};

// ============================================
// KYC CONTROLLERS
// ============================================

exports.uploadKYCDocuments = async (req, res, next) => {
  try {
    const { documentType, documentNumber } = req.body;
    if (!documentType) return res.status(400).json({ success: false, message: 'Document type required' });

    let kyc = await KYC.findOne({ userId: req.user.id });
    if (!kyc) {
      kyc = await KYC.create({ userId: req.user.id, status: 'PENDING' });
    }

    if (kyc.status === 'APPROVED') {
      return res.status(400).json({ success: false, message: 'KYC already approved' });
    }

    // Handle file upload
    let documentUrl = null;
    let backImageUrl = null;

    if (req.files?.front) {
      const result = await cloudinary.uploader.upload(req.files.front[0].path, {
        folder: `nexbank/kyc/${req.user.id}`,
        resource_type: 'auto'
      });
      documentUrl = result.secure_url;
    }

    if (req.files?.back) {
      const result = await cloudinary.uploader.upload(req.files.back[0].path, {
        folder: `nexbank/kyc/${req.user.id}`,
        resource_type: 'auto'
      });
      backImageUrl = result.secure_url;
    }

    if (!documentUrl && req.body.documentImage) {
      documentUrl = req.body.documentImage;
    }

    if (!documentUrl) return res.status(400).json({ success: false, message: 'Document image required' });

    if (documentType === 'PROFILE_PHOTO') {
      await User.updateOne({ _id: req.user.id }, { profileImage: documentUrl });
      await analyzeKYC(kyc, req.user.id);
      await kyc.save();
      return res.json({ success: true, message: 'Profile photo uploaded', data: kyc });
    }

    if (!['PAN', 'AADHAAR'].includes(documentType)) {
      return res.status(400).json({ success: false, message: 'Only PAN and Aadhaar uploads are supported here' });
    }

    // Add document to KYC
    const docEntry = {
      type: documentType,
      number: documentNumber,
      frontImage: documentUrl,
      backImage: backImageUrl,
      verified: false,
      uploadedAt: new Date()
    };

    const existingDocIndex = kyc.documents.findIndex(d => d.type === documentType);
    if (existingDocIndex >= 0) {
      kyc.documents[existingDocIndex] = docEntry;
    } else {
      kyc.documents.push(docEntry);
    }

    kyc.status = 'SUBMITTED';
    kyc.meta = kyc.meta || {};
    kyc.meta.submissionCount = (kyc.meta.submissionCount || 0) + 1;
    await analyzeKYC(kyc, req.user.id);
    await kyc.save();

    await Notification.create({
      userId: req.user.id,
      title: 'KYC Documents Uploaded',
      message: `${documentType} document uploaded successfully. Verification in progress.`,
      type: 'KYC',
      priority: 'MEDIUM'
    });

    await auditLog(req.user.id, 'KYC_DOCUMENT_UPLOADED', 'KYC', 'INFO', { documentType }, req);

    res.json({ success: true, message: 'Document uploaded successfully', data: kyc });
  } catch (error) {
    logger.error('KYC upload error:', error);
    next(error);
  }
};

exports.uploadSelfie = async (req, res, next) => {
  try {
    let selfieUrl = null;

    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: `nexbank/kyc/${req.user.id}/selfie`,
        resource_type: 'auto'
      });
      selfieUrl = result.secure_url;
    }

    if (!selfieUrl && req.body.selfieImage) {
      selfieUrl = req.body.selfieImage;
    }

    let kyc = await KYC.findOne({ userId: req.user.id });
    if (!kyc) kyc = await KYC.create({ userId: req.user.id, status: 'PENDING' });

    kyc.selfieImage = selfieUrl;
    if (!selfieUrl) return res.status(400).json({ success: false, message: 'Selfie image required' });
    await analyzeKYC(kyc, req.user.id);
    await kyc.save();

    res.json({ success: true, message: 'Selfie uploaded', data: { selfieImage: selfieUrl } });
  } catch (error) {
    logger.error('Selfie upload error:', error);
    next(error);
  }
};

exports.getKYCStatus = async (req, res, next) => {
  try {
    const kyc = await KYC.findOne({ userId: req.user.id });
    if (!kyc) return res.json({ success: true, data: { status: 'NOT_STARTED', level: 0, documents: [] } });

    res.json({ success: true, data: kyc });
  } catch (error) {
    logger.error('KYC status error:', error);
    next(error);
  }
};

// ============================================
// AI FEATURES CONTROLLERS
// ============================================

exports.chatWithAI = async (req, res, next) => {
  try {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message required' });

    const user = await User.findById(req.user.id);
    const account = await Account.findOne({ userId: req.user.id });
    const [recentTransactions, activeFDs, loans, cards] = await Promise.all([
      account ? Transaction.find({ $or: [{ fromAccount: account.accountNumber }, { toAccount: account.accountNumber }] }).sort({ createdAt: -1 }).limit(5) : [],
      FixedDeposit.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(5),
      Loan.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(5),
      Card.find({ userId: req.user.id, status: { $ne: 'CANCELLED' } }).select('cardType status cardLast4 isVirtual'),
    ]);
    const activeFdCount = activeFDs.filter(fd => fd.status === 'ACTIVE').length;
    const completedFdCount = activeFDs.filter(fd => ['MATURED', 'PREMATURE_CLOSED'].includes(fd.status)).length;
    const txSummary = recentTransactions.length
      ? recentTransactions.map(tx => `${tx.type} ₹${tx.amount?.toLocaleString()} ${tx.status}`).join('; ')
      : 'No recent transactions found.';

    // AI Chatbot logic (rule-based simulation)
    const responses = {
      balance: `Your account balance is ₹${account?.balance?.toLocaleString() || '0'}. Available balance: ₹${((account?.balance || 0) - (account?.minBalance || 0)).toLocaleString()}.`,
      transaction: `Recent transaction summary: ${txSummary}`,
      fd: activeFDs.length ? `You have ${activeFdCount} active FD(s) and ${completedFdCount} completed/closed FD(s). Plans available: 6 months, 1 year, 3 years, and 5 years.` : 'You do not have an FD yet. You can create one from Deposits using 6 month, 1 year, 3 year, or 5 year plans.',
      transfer: 'To transfer funds, go to the Transfer section. You can use IMPS, NEFT, RTGS, or UPI. Would you like step-by-step guidance?',
      loan: loans.length ? `You have ${loans.length} loan application(s). Latest status: ${loans[0].loanType} loan is ${loans[0].status}.` : 'We offer Personal, Home, Car, Education, and Business loans. Use the Loans section to estimate EMI before applying.',
      card: cards.length ? `You have ${cards.length} card(s). Active cards can be blocked, unblocked, or revealed after PIN verification in Cards.` : 'You can create a virtual debit card instantly from the Cards section.',
      kyc: account ? `Your KYC status is: ${user?.isKYCVerified ? 'Verified ✓' : 'Pending'}. Please upload your documents for verification.` : 'Please complete your profile first.',
      support: 'For banking support, check recent transactions first, keep your card blocked if suspicious, reset your PIN from Settings, and contact support with the transaction ID if money moved unexpectedly.',
      help: 'I can help with balance queries, transaction summaries, FD information, loan guidance, account FAQs, card help, and banking support suggestions.',
      default: `Hello ${user?.firstName || 'there'}! I'm your NexBank AI assistant. I can help you with balance checks, transactions, loans, cards, and more. How can I assist you today?`
    };

    const lowerMessage = message.toLowerCase();
    let response = responses.default;

    if (lowerMessage.includes('balance') || lowerMessage.includes('how much')) response = responses.balance;
    else if (lowerMessage.includes('transaction') || lowerMessage.includes('history')) response = responses.transaction;
    else if (lowerMessage.includes('fd') || lowerMessage.includes('fixed deposit') || lowerMessage.includes('deposit plan')) response = responses.fd;
    else if (lowerMessage.includes('transfer') || lowerMessage.includes('send money')) response = responses.transfer;
    else if (lowerMessage.includes('loan') || lowerMessage.includes('emi')) response = responses.loan;
    else if (lowerMessage.includes('card') || lowerMessage.includes('debit') || lowerMessage.includes('credit')) response = responses.card;
    else if (lowerMessage.includes('kyc') || lowerMessage.includes('verify')) response = responses.kyc;
    else if (lowerMessage.includes('support') || lowerMessage.includes('help me') || lowerMessage.includes('problem')) response = responses.support;
    else if (lowerMessage.includes('help') || lowerMessage.includes('what can')) response = responses.help;
    else if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) response = `Hello ${user?.firstName}! How can I help you with your banking today?`;

    res.json({ success: true, data: { response, timestamp: new Date() } });
  } catch (error) {
    logger.error('AI chat error:', error);
    next(error);
  }
};

exports.getTransactionInsights = async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    // Monthly analysis
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const spending = await Transaction.aggregate([
      { $match: { fromAccount: account.accountNumber, status: 'COMPLETED', createdAt: { $gte: lastMonth } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } }
    ]);

    const income = await Transaction.aggregate([
      { $match: { toAccount: account.accountNumber, status: 'COMPLETED', type: { $in: ['CREDIT', 'DEPOSIT'] }, createdAt: { $gte: lastMonth } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalSpent = spending.reduce((sum, s) => sum + s.total, 0);
    const totalIncome = income[0]?.total || 0;
    const savingsRate = totalIncome > 0 ? ((totalIncome - totalSpent) / totalIncome * 100).toFixed(1) : 0;

    // Generate insights
    const insights = [];
    if (spending.length > 0) {
      insights.push(`Your highest spending category is ${spending[0]._id} at ₹${spending[0].total.toLocaleString()}`);
    }
    if (Number(savingsRate) < 20) {
      insights.push('Your savings rate is below 20%. Consider reducing discretionary spending.');
    }
    if (Number(savingsRate) > 40) {
      insights.push('Great savings rate! Consider investing in FDs or mutual funds.');
    }

    // Spending prediction (simple moving average)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const avgSpending = await Transaction.aggregate([
      { $match: { fromAccount: account.accountNumber, status: 'COMPLETED', createdAt: { $gte: threeMonthsAgo } } },
      { $group: { _id: null, avgMonthly: { $avg: '$amount' }, total: { $sum: '$amount' } } }
    ]);

    const predictedNextMonth = avgSpending[0] ? (avgSpending[0].total / 3) : 0;

    res.json({
      success: true,
      data: {
        spending,
        totalSpent,
        totalIncome,
        savingsRate: Number(savingsRate),
        insights,
        predictions: {
          nextMonthSpending: Math.round(predictedNextMonth),
          recommendedSavings: Math.round(totalIncome * 0.3)
        }
      }
    });
  } catch (error) {
    logger.error('Transaction insights error:', error);
    next(error);
  }
};

exports.getFraudPrediction = async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

    const recentTx = await Transaction.find({
      $or: [{ fromAccount: account.accountNumber }, { toAccount: account.accountNumber }],
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }).sort({ createdAt: -1 });

    let riskScore = 0;
    const alerts = [];

    // Check for unusual patterns
    const txCount = recentTx.length;
    if (txCount > 50) { riskScore += 30; alerts.push('High transaction frequency detected'); }

    const totalAmount = recentTx.reduce((sum, tx) => sum + tx.amount, 0);
    if (totalAmount > 500000) { riskScore += 25; alerts.push('High total transaction volume'); }

    const nightTx = recentTx.filter(tx => {
      const hour = new Date(tx.createdAt).getHours();
      return hour < 6 || hour > 22;
    });
    if (nightTx.length > 5) { riskScore += 20; alerts.push('Multiple late-night transactions'); }

    const failedTx = recentTx.filter(tx => tx.status === 'FAILED');
    if (failedTx.length > 3) { riskScore += 15; alerts.push('Multiple failed transactions'); }

    const largeTx = recentTx.filter(tx => tx.amount > 100000);
    if (largeTx.length > 2) { riskScore += 15; alerts.push('Multiple large transactions'); }

    riskScore = Math.min(riskScore, 100);

    res.json({
      success: true,
      data: {
        riskScore,
        riskLevel: riskScore < 30 ? 'LOW' : riskScore < 60 ? 'MEDIUM' : riskScore < 80 ? 'HIGH' : 'CRITICAL',
        alerts,
        recommendations: riskScore > 50 ? [
          'Enable two-factor authentication',
          'Set transaction limits',
          'Review recent transactions carefully',
          'Change your password'
        ] : ['Your account activity looks normal']
      }
    });
  } catch (error) {
    logger.error('Fraud prediction error:', error);
    next(error);
  }
};

exports.getSmartRecommendations = async (req, res, next) => {
  try {
    const account = await Account.findOne({ userId: req.user.id });
    const user = await User.findById(req.user.id);

    const recommendations = [];

    if (account) {
      // Balance-based recommendations
      if (account.balance > 50000) {
        recommendations.push({
          type: 'INVESTMENT',
          title: 'Start a Fixed Deposit',
          description: `You have ₹${(account.balance - account.minBalance).toLocaleString()} idle. Earn up to 7% with an FD.`,
          action: '/banking/fd/new',
          priority: 'HIGH'
        });
      }

      if (account.balance > 100000) {
        recommendations.push({
          type: 'INVESTMENT',
          title: 'Recurring Deposit',
          description: 'Start a recurring deposit and build wealth systematically.',
          action: '/banking/rd/new',
          priority: 'MEDIUM'
        });
      }

      // KYC recommendation
      if (!user.isKYCVerified) {
        recommendations.push({
          type: 'KYC',
          title: 'Complete Your KYC',
          description: 'Verify your identity to unlock all banking features.',
          action: '/kyc',
          priority: 'HIGH'
        });
      }

      // 2FA recommendation
      if (!user.is2FAEnabled) {
        recommendations.push({
          type: 'SECURITY',
          title: 'Enable Two-Factor Auth',
          description: 'Add an extra layer of security to your account.',
          action: '/settings/security',
          priority: 'HIGH'
        });
      }

      // Card recommendation
      const cards = await Card.countDocuments({ userId: req.user.id, status: 'ACTIVE' });
      if (cards === 0) {
        recommendations.push({
          type: 'CARD',
          title: 'Get a Virtual Debit Card',
          description: 'Create a virtual card instantly for online payments.',
          action: '/banking/card/new',
          priority: 'MEDIUM'
        });
      }

      // Transaction PIN
      if (!user.transactionPin) {
        recommendations.push({
          type: 'SECURITY',
          title: 'Set Transaction PIN',
          description: 'Set a 4-digit PIN for secure transactions.',
          action: '/settings/security',
          priority: 'URGENT'
        });
      }
    }

    res.json({ success: true, data: recommendations });
  } catch (error) {
    logger.error('Smart recommendations error:', error);
    next(error);
  }
};
