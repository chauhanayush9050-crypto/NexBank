const express = require('express');
const router = express.Router();

const { authenticate, authorizeAdmin, authorizeSuperAdmin, authorizeUser, authLimiter, otpLimiter, transferLimiter, generalLimiter, adminLimiter } = require('../middleware');

const authController = require('../controllers/authController');
const bankingController = require('../controllers/bankingController');
const adminController = require('../controllers/adminController');
const notificationController = require('../controllers/notificationController');

// ============================================
// HEALTH
// ============================================
router.get('/health', (req, res) => res.json({ success: true, message: 'NexBank API running', version: '1.0.0' }));

// ============================================
// PUBLIC AUTH — User signup & login
// ============================================
router.post('/auth/signup', authLimiter, authController.signup);
router.post('/auth/login', authLimiter, authController.login);
router.post('/auth/forgot-password', authLimiter, authController.forgotPassword);
router.post('/auth/reset-password', authLimiter, authController.resetPassword);
router.post('/auth/refresh-token', authController.refreshToken);

// ============================================
// ADMIN AUTH — Separate login endpoint (no signup!)
// ============================================
router.post('/auth/admin-login', authLimiter, authController.adminLogin);

// ============================================
// PROTECTED — USER ONLY (role check enforced)
// ============================================
router.post('/auth/logout', authenticate, authorizeUser, authController.logout);
router.post('/auth/verify-email', authenticate, authorizeUser, authController.verifyEmail);
router.post('/auth/verify-phone', authenticate, authorizeUser, authController.verifyPhone);
router.post('/auth/resend-otp', authenticate, authorizeUser, otpLimiter, authController.resendOTP);
router.put('/auth/change-password', authenticate, authorizeUser, authController.changePassword);
router.post('/auth/set-pin', authenticate, authorizeUser, authController.setTransactionPin);
router.post('/auth/verify-pin', authenticate, authorizeUser, authController.verifyPin);
router.post('/auth/change-pin', authenticate, authorizeUser, authController.changePin);
router.post('/auth/request-pin-reset', authenticate, authorizeUser, otpLimiter, authController.requestPinReset);
router.post('/auth/reset-pin-otp', authenticate, authorizeUser, authController.resetPinWithOTP);
router.post('/auth/transfer-otp', authenticate, authorizeUser, otpLimiter, authController.generateTransferOTP);
router.post('/auth/verify-transfer-otp', authenticate, authorizeUser, authController.verifyTransferOTP);
router.get('/auth/sessions', authenticate, authorizeUser, authController.getActiveSessions);
router.delete('/auth/sessions/:sessionId', authenticate, authorizeUser, authController.destroySession);
router.get('/auth/login-history', authenticate, authorizeUser, authController.getLoginHistory);
router.get('/auth/profile', authenticate, authorizeUser, authController.getProfile);
router.put('/auth/profile', authenticate, authorizeUser, authController.updateProfile);
router.post('/auth/enable-2fa', authenticate, authorizeUser, authController.enable2FA);
router.post('/auth/confirm-2fa', authenticate, authorizeUser, authController.confirm2FA);
router.post('/auth/verify-2fa', authController.verify2FA);

// ============================================
// ACCOUNT — USER ONLY
// ============================================
router.get('/account/summary', authenticate, authorizeUser, bankingController.getAccountSummary);
router.get('/account/balance', authenticate, authorizeUser, bankingController.getBalance);
router.get('/account/passbook', authenticate, authorizeUser, bankingController.getPassbook);

// ============================================
// TRANSACTIONS — USER ONLY
// ============================================
router.post('/transaction/deposit', authenticate, authorizeUser, bankingController.deposit);
router.post('/transaction/withdraw', authenticate, authorizeUser, bankingController.withdraw);
router.post('/transaction/transfer', authenticate, authorizeUser, transferLimiter, bankingController.transfer);
router.post('/transaction/imps', authenticate, authorizeUser, transferLimiter, bankingController.transfer);
router.post('/transaction/rtgs', authenticate, authorizeUser, transferLimiter, bankingController.transfer);
router.post('/transaction/neft', authenticate, authorizeUser, transferLimiter, bankingController.transfer);
router.post('/transaction/upi', authenticate, authorizeUser, transferLimiter, bankingController.transfer);
router.get('/transaction/history', authenticate, authorizeUser, bankingController.getTransactionHistory);
router.get('/transaction/:id', authenticate, authorizeUser, bankingController.getTransaction);
router.get('/transaction/statement/download', authenticate, authorizeUser, bankingController.downloadStatement);

// ============================================
// UPI — USER ONLY
// ============================================
router.post('/upi/create', authenticate, authorizeUser, bankingController.createUPI);
router.post('/upi/send', authenticate, authorizeUser, transferLimiter, bankingController.sendUPIMoney);
router.post('/upi/receive', authenticate, authorizeUser, bankingController.receiveUPIMoney);
router.get('/upi/history', authenticate, authorizeUser, bankingController.getUPIHistory);

// ============================================
// BENEFICIARY — USER ONLY
// ============================================
router.post('/beneficiary/add', authenticate, authorizeUser, bankingController.addBeneficiary);
router.get('/beneficiary/list', authenticate, authorizeUser, bankingController.getBeneficiaries);
router.delete('/beneficiary/:id', authenticate, authorizeUser, bankingController.deleteBeneficiary);
router.put('/beneficiary/:id/favorite', authenticate, authorizeUser, bankingController.toggleFavorite);

// ============================================
// CARDS — USER ONLY
// ============================================
router.post('/card/virtual', authenticate, authorizeUser, bankingController.createVirtualCard);
router.get('/card/list', authenticate, authorizeUser, bankingController.getCards);
router.post('/card/:id/reveal', authenticate, authorizeUser, bankingController.revealCard);
router.put('/card/:id/block', authenticate, authorizeUser, bankingController.blockCard);
router.put('/card/:id/unblock', authenticate, authorizeUser, bankingController.unblockCard);
router.put('/card/:id/limits', authenticate, authorizeUser, bankingController.updateCardLimits);

// ============================================
// LOANS — USER ONLY
// ============================================
router.post('/loan/apply', authenticate, authorizeUser, bankingController.applyLoan);
router.get('/loan/list', authenticate, authorizeUser, bankingController.getLoans);
router.get('/loan/emi-calculator', bankingController.emiCalculator);

// ============================================
// DEPOSITS — USER ONLY
// ============================================
router.post('/fd/create', authenticate, authorizeUser, bankingController.createFD);
router.get('/fd/list', authenticate, authorizeUser, bankingController.getFDs);
router.get('/fd/status/summary', authenticate, authorizeUser, bankingController.getFDStatusSummary);
router.get('/fd/:id', authenticate, authorizeUser, bankingController.getFDDetails);
router.get('/fd/:id/maturity', authenticate, authorizeUser, bankingController.getFDMaturity);
router.post('/fd/:id/break', authenticate, authorizeUser, bankingController.breakFD);
router.post('/rd/create', authenticate, authorizeUser, bankingController.createRD);
router.get('/rd/list', authenticate, authorizeUser, bankingController.getRDs);

// ============================================
// BILLS & PAYMENTS — USER ONLY
// ============================================
router.post('/payment/bill', authenticate, authorizeUser, bankingController.payBill);
router.post('/payment/schedule', authenticate, authorizeUser, bankingController.schedulePayment);
router.get('/payment/scheduled', authenticate, authorizeUser, bankingController.getScheduledPayments);
router.post('/payment/request', authenticate, authorizeUser, bankingController.createPaymentRequest);
router.post('/cheque/request', authenticate, authorizeUser, bankingController.requestChequeBook);

// ============================================
// ANALYTICS & AI — USER ONLY
// ============================================
router.get('/analytics/spending', authenticate, authorizeUser, bankingController.getSpendingAnalytics);
router.post('/ai/chat', authenticate, authorizeUser, notificationController.chatWithAI);
router.get('/ai/insights', authenticate, authorizeUser, notificationController.getTransactionInsights);
router.get('/ai/fraud-prediction', authenticate, authorizeUser, notificationController.getFraudPrediction);
router.get('/ai/recommendations', authenticate, authorizeUser, notificationController.getSmartRecommendations);

// ============================================
// NOTIFICATIONS — USER ONLY
// ============================================
router.get('/notifications', authenticate, authorizeUser, notificationController.getNotifications);
router.get('/notifications/unread-count', authenticate, authorizeUser, notificationController.getUnreadCount);
router.put('/notifications/:id/read', authenticate, authorizeUser, notificationController.markAsRead);
router.put('/notifications/read-all', authenticate, authorizeUser, notificationController.markAllRead);
router.delete('/notifications/:id', authenticate, authorizeUser, notificationController.deleteNotification);

// ============================================
// KYC — USER ONLY
// ============================================
router.post('/kyc/upload', authenticate, authorizeUser, notificationController.uploadKYCDocuments);
router.post('/kyc/selfie', authenticate, authorizeUser, notificationController.uploadSelfie);
router.get('/kyc/status', authenticate, authorizeUser, notificationController.getKYCStatus);

// ============================================
// ============================================
// ADMIN ROUTES — ADMIN/SUPER_ADMIN ONLY
// ============================================
// ============================================
router.use('/admin', authenticate, authorizeAdmin, adminLimiter);

router.get('/admin/dashboard', adminController.getAnalytics);
router.get('/admin/users', adminController.getAllUsers);
router.get('/admin/users/:id', adminController.getUserById);
router.post('/admin/freeze/:id', adminController.freezeAccount);
router.post('/admin/unfreeze/:id', adminController.unfreezeAccount);
router.get('/admin/kyc/pending', adminController.getPendingKYC);
router.post('/admin/kyc/approve/:id', adminController.approveKYC);
router.post('/admin/kyc/reject/:id', adminController.rejectKYC);
router.get('/admin/transactions', adminController.getAllTransactions);
router.get('/admin/fraud', adminController.getFraudAlerts);
router.get('/admin/analytics', adminController.getAnalytics);
router.get('/admin/logs', adminController.getAuditLogs);
router.get('/admin/tickets', adminController.getSupportTickets);
router.put('/admin/tickets/:id', adminController.updateTicket);
router.post('/admin/loan/approve/:id', adminController.approveLoan);
router.post('/admin/broadcast', adminController.broadcastNotification);
router.delete('/admin/users/:id', authorizeSuperAdmin, adminController.deleteUser);
router.post('/admin/transaction/reverse/:id', authorizeSuperAdmin, adminController.reverseTransaction);

// Admin Management — Promote / Demote
router.post('/admin/promote/:id', authorizeSuperAdmin, adminController.promoteToAdmin);
router.post('/admin/demote/:id', authorizeSuperAdmin, adminController.demoteFromAdmin);

// Admin logout
router.post('/admin/logout', (req, res, next) => { req.user = { id: req.user?.id, role: req.user?.role }; next(); }, authController.logout);

module.exports = router;
