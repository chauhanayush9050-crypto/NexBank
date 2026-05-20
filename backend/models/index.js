const mongoose = require('mongoose');
const crypto = require('crypto');

// ============================================
// USER SCHEMA
// ============================================
const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true, select: false },
  dateOfBirth: { type: Date, required: true },
  gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
  panNumber: { type: String, required: true, unique: uppercaseSetter },
  aadhaarNumber: { type: String, required: true, unique: true },
  address: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' }
  },
  profileImage: { type: String, default: null },
  isEmailVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  is2FAEnabled: { type: Boolean, default: false },
  twoFASecret: { type: String, select: false },
  transactionPin: { type: String, select: false },
  isActive: { type: Boolean, default: true },
  isFrozen: { type: Boolean, default: false },
  isKYCVerified: { type: Boolean, default: false },
  kycLevel: { type: Number, default: 0, min: 0, max: 3 },
  role: { type: String, enum: ['USER', 'ADMIN', 'SUPER_ADMIN'], default: 'USER' },
  loginAttempts: { type: Number, default: 0, select: false },
  lockUntil: { type: Date, select: false },
  lastLogin: { type: Date },
  lastLoginIP: { type: String },
  refreshToken: { type: String, select: false },
  preferredLanguage: { type: String, default: 'en' },
  theme: { type: String, enum: ['LIGHT', 'DARK', 'SYSTEM'], default: 'SYSTEM' },
  notificationPreferences: {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
    transaction: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false }
  },
  rewards: {
    points: { type: Number, default: 0 },
    tier: { type: String, enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'], default: 'BRONZE' },
    totalCashback: { type: Number, default: 0 }
  },
  deviceTokens: [{ type: String }],
  meta: {
    createdBy: { type: String },
    source: { type: String, default: 'WEB' }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

function uppercaseSetter(val) {
  return typeof val === 'string' ? val.toUpperCase() : val;
}

userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.methods.incLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({ $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } });
  }
  const updates = { $inc: { loginAttempts: 1 } };
  const maxAttempts = 5;
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 30 * 60 * 1000 };
  }
  return this.updateOne(updates);
};

userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ panNumber: 1 });
userSchema.index({ createdAt: -1 });

const User = mongoose.model('User', userSchema);

// ============================================
// ACCOUNT SCHEMA
// ============================================
const accountSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountNumber: { type: String, required: true, unique: true },
  accountType: { type: String, enum: ['SAVINGS', 'CURRENT', 'SALARY', 'NRI'], default: 'SAVINGS' },
  ifsc: { type: String, required: true },
  balance: { type: Number, default: 0, required: true },
  minBalance: { type: Number, default: 1000 },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['ACTIVE', 'FROZEN', 'CLOSED', 'DORMANT', 'PENDING'], default: 'PENDING' },
  upiId: { type: String, unique: true, sparse: true },
  dailyLimit: { type: Number, default: 500000 },
  monthlyLimit: { type: Number, default: 5000000 },
  dailySpent: { type: Number, default: 0 },
  monthlySpent: { type: Number, default: 0 },
  interestRate: { type: Number, default: 3.5 },
  nominee: {
    name: { type: String },
    relation: { type: String },
    percentage: { type: Number }
  },
  statement: [{
    month: { type: String },
    year: { type: Number },
    openingBalance: { type: Number },
    closingBalance: { type: Number },
    totalCredits: { type: Number, default: 0 },
    totalDebits: { type: Number, default: 0 },
    fileUrl: { type: String }
  }],
  lastTransactionAt: { type: Date },
  meta: {
    branch: { type: String, default: 'MAIN' },
    manager: { type: String }
  }
}, { timestamps: true });

accountSchema.virtual('availableBalance').get(function() {
  return Math.max(0, this.balance - this.minBalance);
});

accountSchema.index({ userId: 1 });
accountSchema.index({ accountNumber: 1 });
accountSchema.index({ status: 1 });

const Account = mongoose.model('Account', accountSchema);

// ============================================
// TRANSACTION SCHEMA
// ============================================
const transactionSchema = new mongoose.Schema({
  transactionId: { type: String, required: true, unique: true },
  fromAccount: { type: String, required: true },
  toAccount: { type: String, required: true },
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount: { type: Number, required: true },
  type: {
    type: String,
    enum: ['CREDIT', 'DEBIT', 'TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'REFUND', 'REVERSAL'],
    required: true
  },
  channel: {
    type: String,
    enum: ['IMPS', 'RTGS', 'NEFT', 'UPI', 'INTERNAL', 'ATM', 'POS', 'CHEQUE', 'ONLINE', 'CASH'],
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED', 'CANCELLED', 'SCHEDULED'],
    default: 'PENDING'
  },
  description: { type: String, default: '' },
  remark: { type: String },
  referenceId: { type: String },
  utr: { type: String },
  fee: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  cashback: { type: Number, default: 0 },
  category: {
    type: String,
    enum: ['FOOD', 'SHOPPING', 'TRANSPORT', 'BILLS', 'ENTERTAINMENT', 'HEALTH', 'EDUCATION',
           'INVESTMENT', 'SALARY', 'BUSINESS', 'RENT', 'EMI', 'INSURANCE', 'OTHER'],
    default: 'OTHER'
  },
  aiCategory: { type: String },
  location: {
    city: { type: String },
    country: { type: String },
    coordinates: { type: [Number] }
  },
  device: {
    type: { type: String },
    browser: { type: String },
    ip: { type: String }
  },
  scheduledAt: { type: Date },
  processedAt: { type: Date },
  recurring: {
    isRecurring: { type: Boolean, default: false },
    frequency: { type: String, enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] },
    nextDate: { type: Date },
    parentId: { type: mongoose.Schema.Types.ObjectId }
  },
  meta: {
    initiatedBy: { type: String },
    approvedBy: { type: String },
    failureReason: { type: String },
    fraudScore: { type: Number, min: 0, max: 100 }
  }
}, { timestamps: true });

transactionSchema.index({ fromAccount: 1, createdAt: -1 });
transactionSchema.index({ toAccount: 1, createdAt: -1 });
transactionSchema.index({ fromUserId: 1 });
transactionSchema.index({ toUserId: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ createdAt: -1 });

const Transaction = mongoose.model('Transaction', transactionSchema);

// ============================================
// CARD SCHEMA
// ============================================
const cardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  cardNumber: { type: String, required: true },
  encryptedCardNumber: { type: String, select: false },
  cardLast4: { type: String },
  cardType: { type: String, enum: ['DEBIT', 'CREDIT', 'VIRTUAL'], required: true },
  cardNetwork: { type: String, enum: ['VISA', 'MASTERCARD', 'RUPAY'], default: 'VISA' },
  cardHolderName: { type: String, required: true },
  expiryMonth: { type: String, required: true },
  expiryYear: { type: String, required: true },
  cvv: { type: String, required: true, select: false },
  encryptedCVV: { type: String, select: false },
  pin: { type: String, select: false },
  status: { type: String, enum: ['ACTIVE', 'BLOCKED', 'EXPIRED', 'CANCELLED', 'PENDING'], default: 'ACTIVE' },
  isVirtual: { type: Boolean, default: false },
  isContactless: { type: Boolean, default: true },
  isInternational: { type: Boolean, default: false },
  isOnlinePayment: { type: Boolean, default: true },
  dailyLimit: { type: Number, default: 100000 },
  monthlyLimit: { type: Number, default: 500000 },
  color: { type: String, default: '#1a1a2e' },
  design: { type: String, default: 'CLASSIC' },
  spending: {
    daily: { type: Number, default: 0 },
    monthly: { type: Number, default: 0 }
  },
  lastUsedAt: { type: Date }
}, { timestamps: true });

cardSchema.index({ userId: 1 });
cardSchema.index({ cardNumber: 1 });

const Card = mongoose.model('Card', cardSchema);

// ============================================
// BENEFICIARY SCHEMA
// ============================================
const beneficiarySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  nickname: { type: String },
  accountNumber: { type: String, required: true },
  ifsc: { type: String, required: true },
  bank: { type: String, required: true },
  branch: { type: String },
  type: { type: String, enum: ['IMPS', 'RTGS', 'NEFT', 'UPI'], default: 'IMPS' },
  upiId: { type: String },
  isVerified: { type: Boolean, default: false },
  isFavorite: { type: Boolean, default: false },
  lastTransferredAt: { type: Date },
  transferCount: { type: Number, default: 0 },
  totalTransferred: { type: Number, default: 0 },
  status: { type: String, enum: ['ACTIVE', 'DELETED', 'PENDING'], default: 'PENDING' },
  addedAt: { type: Date, default: Date.now },
  verifiedAt: { type: Date }
}, { timestamps: true });

beneficiarySchema.index({ userId: 1 });
beneficiarySchema.index({ userId: 1, accountNumber: 1 });

const Beneficiary = mongoose.model('Beneficiary', beneficiarySchema);

// ============================================
// KYC SCHEMA
// ============================================
const kycSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  status: {
    type: String,
    enum: ['NOT_STARTED', 'PENDING', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED'],
    default: 'NOT_STARTED'
  },
  level: { type: Number, default: 0, min: 0, max: 3 },
  documents: [{
    type: { type: String, enum: ['PAN', 'AADHAAR', 'PASSPORT', 'DRIVING_LICENSE', 'VOTER_ID', 'SELFIE', 'ADDRESS_PROOF'] },
    number: { type: String },
    frontImage: { type: String },
    backImage: { type: String },
    selfieWithDoc: { type: String },
    verified: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date },
    rejectedReason: { type: String }
  }],
  selfieImage: { type: String },
  confidenceScore: { type: Number, default: 0, min: 0, max: 100 },
  panVerified: { type: Boolean, default: false },
  aadhaarVerified: { type: Boolean, default: false },
  addressVerified: { type: Boolean, default: false },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  remarks: { type: String },
  rejectionReason: { type: String },
  expiryDate: { type: Date },
  meta: {
    ipAddress: { type: String },
    userAgent: { type: String },
    submissionCount: { type: Number, default: 0 }
  }
}, { timestamps: true });

kycSchema.index({ userId: 1 });
kycSchema.index({ status: 1 });

const KYC = mongoose.model('KYC', kycSchema);

// ============================================
// NOTIFICATION SCHEMA
// ============================================
const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: {
    type: String,
    enum: ['TRANSACTION', 'SECURITY', 'PROMOTION', 'SYSTEM', 'KYC', 'LOAN', 'CARD', 'BILL', 'ALERT'],
    required: true
  },
  category: { type: String },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  actionUrl: { type: String },
  actionText: { type: String },
  data: { type: mongoose.Schema.Types.Mixed },
  sentVia: {
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: false },
    inApp: { type: Boolean, default: true }
  },
  expiresAt: { type: Date }
}, { timestamps: true });

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ type: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

// ============================================
// LOAN SCHEMA
// ============================================
const loanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  loanType: { type: String, enum: ['PERSONAL', 'HOME', 'CAR', 'EDUCATION', 'BUSINESS', 'GOLD'], required: true },
  loanNumber: { type: String, required: true, unique: true },
  principal: { type: Number, required: true },
  interestRate: { type: Number, required: true },
  tenure: { type: Number, required: true },
  emi: { type: Number, required: true },
  outstandingAmount: { type: Number, required: true },
  paidAmount: { type: Number, default: 0 },
  totalInterest: { type: Number },
  totalPayable: { type: Number },
  status: {
    type: String,
    enum: ['APPLIED', 'APPROVED', 'ACTIVE', 'REJECTED', 'CLOSED', 'DEFAULTED', 'SETTLED'],
    default: 'APPLIED'
  },
  startDate: { type: Date },
  endDate: { type: Date },
  nextEmiDate: { type: Date },
  missedEmiCount: { type: Number, default: 0 },
  collateral: {
    type: { type: String },
    value: { type: Number },
    documents: [{ type: String }]
  },
  schedule: [{
    month: { type: Number },
    emiAmount: { type: Number },
    principal: { type: Number },
    interest: { type: Number },
    balance: { type: Number },
    dueDate: { type: Date },
    status: { type: String, enum: ['PENDING', 'PAID', 'MISSED', 'PARTIAL'], default: 'PENDING' },
    paidDate: { type: Date },
    paidAmount: { type: Number, default: 0 }
  }],
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  disbursedAt: { type: Date },
  remarks: { type: String }
}, { timestamps: true });

loanSchema.index({ userId: 1 });
loanSchema.index({ loanNumber: 1 });
loanSchema.index({ status: 1 });

const Loan = mongoose.model('Loan', loanSchema);

// ============================================
// FIXED DEPOSIT SCHEMA
// ============================================
const fixedDepositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  fdNumber: { type: String, required: true, unique: true },
  principal: { type: Number, required: true },
  interestRate: { type: Number, required: true },
  tenureDays: { type: Number, required: true },
  maturityAmount: { type: Number, required: true },
  interestEarned: { type: Number },
  status: {
    type: String,
    enum: ['ACTIVE', 'MATURED', 'PREMATURE_CLOSED', 'CANCELLED'],
    default: 'ACTIVE'
  },
  startDate: { type: Date, default: Date.now },
  maturityDate: { type: Date, required: true },
  closedAt: { type: Date },
  autoRenew: { type: Boolean, default: false },
  prematurePenalty: { type: Number, default: 0 }
}, { timestamps: true });

fixedDepositSchema.index({ userId: 1, createdAt: -1 });
fixedDepositSchema.index({ userId: 1, status: 1 });
fixedDepositSchema.index({ fdNumber: 1 });

const FixedDeposit = mongoose.model('FixedDeposit', fixedDepositSchema);

// ============================================
// RECURRING DEPOSIT SCHEMA
// ============================================
const recurringDepositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  rdNumber: { type: String, required: true, unique: true },
  monthlyInstallment: { type: Number, required: true },
  interestRate: { type: Number, required: true },
  tenureMonths: { type: Number, required: true },
  maturityAmount: { type: Number, required: true },
  totalDeposited: { type: Number, default: 0 },
  interestEarned: { type: Number },
  status: {
    type: String,
    enum: ['ACTIVE', 'MATURED', 'PREMATURE_CLOSED', 'CANCELLED'],
    default: 'ACTIVE'
  },
  startDate: { type: Date, default: Date.now },
  maturityDate: { type: Date, required: true },
  paidInstallments: { type: Number, default: 0 },
  missedInstallments: { type: Number, default: 0 },
  nextDueDate: { type: Date }
}, { timestamps: true });

const RecurringDeposit = mongoose.model('RecurringDeposit', recurringDepositSchema);

// ============================================
// BILL SCHEMA
// ============================================
const billSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: {
    type: String,
    enum: ['ELECTRICITY', 'WATER', 'GAS', 'INTERNET', 'MOBILE', 'DTH', 'INSURANCE', 'TAX', 'OTHER'],
    required: true
  },
  provider: { type: String, required: true },
  consumerNumber: { type: String, required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'PAID', 'FAILED', 'SCHEDULED', 'CANCELLED'],
    default: 'PENDING'
  },
  transactionId: { type: String },
  billDate: { type: Date },
  dueDate: { type: Date },
  paidAt: { type: Date },
  isAutoPay: { type: Boolean, default: false },
  autoPayDay: { type: Number },
  receipt: { type: String }
}, { timestamps: true });

billSchema.index({ userId: 1 });
billSchema.index({ status: 1 });

const Bill = mongoose.model('Bill', billSchema);

// ============================================
// SCHEDULED PAYMENT SCHEMA
// ============================================
const scheduledPaymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fromAccount: { type: String, required: true },
  toAccount: { type: String, required: true },
  amount: { type: Number, required: true },
  description: { type: String },
  frequency: {
    type: String,
    enum: ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
    required: true
  },
  startDate: { type: Date, required: true },
  endDate: { type: Date },
  nextExecution: { type: Date, required: true },
  lastExecuted: { type: Date },
  status: {
    type: String,
    enum: ['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
    default: 'ACTIVE'
  },
  executionCount: { type: Number, default: 0 },
  maxExecutions: { type: Number },
  transactionIds: [{ type: String }]
}, { timestamps: true });

const ScheduledPayment = mongoose.model('ScheduledPayment', scheduledPaymentSchema);

// ============================================
// SUPPORT TICKET SCHEMA
// ============================================
const supportTicketSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  ticketId: { type: String, required: true, unique: true },
  subject: { type: String, required: true },
  description: { type: String, required: true },
  category: {
    type: String,
    enum: ['TRANSACTION', 'ACCOUNT', 'CARD', 'LOAN', 'KYC', 'TECHNICAL', 'OTHER'],
    required: true
  },
  priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' },
  status: {
    type: String,
    enum: ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'],
    default: 'OPEN'
  },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  messages: [{
    sender: { type: String, enum: ['USER', 'ADMIN', 'SYSTEM'], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, required: true },
    attachments: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
  }],
  resolution: { type: String },
  resolvedAt: { type: Date },
  satisfaction: { type: Number, min: 1, max: 5 },
  meta: {
    source: { type: String, default: 'WEB' },
    relatedTransaction: { type: String }
  }
}, { timestamps: true });

supportTicketSchema.index({ userId: 1 });
supportTicketSchema.index({ status: 1 });
supportTicketSchema.index({ ticketId: 1 });

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

// ============================================
// AUDIT LOG SCHEMA
// ============================================
const auditLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  category: {
    type: String,
    enum: ['AUTH', 'TRANSACTION', 'ACCOUNT', 'ADMIN', 'SECURITY', 'KYC', 'CARD', 'SYSTEM'],
    required: true
  },
  severity: { type: String, enum: ['INFO', 'WARN', 'ERROR', 'CRITICAL'], default: 'INFO' },
  details: { type: mongoose.Schema.Types.Mixed },
  ipAddress: { type: String },
  userAgent: { type: String },
  deviceInfo: { type: mongoose.Schema.Types.Mixed },
  location: { type: String },
  resource: { type: String },
  resourceId: { type: String },
  oldData: { type: mongoose.Schema.Types.Mixed },
  newData: { type: mongoose.Schema.Types.Mixed },
  meta: { type: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

auditLogSchema.index({ userId: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ category: 1 });
auditLogSchema.index({ createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ============================================
// PAYMENT REQUEST SCHEMA
// ============================================
const paymentRequestSchema = new mongoose.Schema({
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  description: { type: String },
  status: {
    type: String,
    enum: ['PENDING', 'PAID', 'DECLINED', 'EXPIRED', 'CANCELLED'],
    default: 'PENDING'
  },
  expiresAt: { type: Date },
  paidTransactionId: { type: String },
  reminderCount: { type: Number, default: 0 },
  lastRemindedAt: { type: Date }
}, { timestamps: true });

const PaymentRequest = mongoose.model('PaymentRequest', paymentRequestSchema);

// ============================================
// CHEQUE SCHEMA
// ============================================
const chequeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  chequeNumber: { type: String, required: true },
  chequeBookNumber: { type: String },
  amount: { type: Number },
  status: {
    type: String,
    enum: ['ISSUED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED', 'STOPPED'],
    default: 'ISSUED'
  },
  issuedTo: { type: String },
  bankName: { type: String },
  issueDate: { type: Date, default: Date.now },
  depositDate: { type: Date },
  clearDate: { type: Date },
  bounceReason: { type: String },
  leavesCount: { type: Number, default: 25 },
  startCheque: { type: String },
  endCheque: { type: String }
}, { timestamps: true });

const Cheque = mongoose.model('Cheque', chequeSchema);

module.exports = {
  User, Account, Transaction, Card, Beneficiary, KYC, Notification,
  Loan, FixedDeposit, RecurringDeposit, Bill, ScheduledPayment,
  SupportTicket, AuditLog, PaymentRequest, Cheque
};
