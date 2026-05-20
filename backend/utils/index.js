// ============================================
// UTILITY FUNCTIONS
// ============================================

const formatCurrency = (amount, currency = 'INR') => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2
  }).format(amount);
};

const generateOTP = (length = 6) => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
};

const maskAccountNumber = (accountNumber) => {
  if (!accountNumber || accountNumber.length < 4) return '****';
  return `XXXX XXXX ${accountNumber.slice(-4)}`;
};

const maskCardNumber = (cardNumber) => {
  if (!cardNumber || cardNumber.length < 4) return '****';
  return `**** **** **** ${cardNumber.slice(-4)}`;
};

const maskEmail = (email) => {
  const [name, domain] = email.split('@');
  return `${name[0]}${'*'.repeat(Math.max(name.length - 2, 1))}${name[name.length - 1]}@${domain}`;
};

const maskPhone = (phone) => {
  if (phone.length < 4) return '****';
  return `${phone.slice(0, 2)}${'*'.repeat(phone.length - 4)}${phone.slice(-2)}`;
};

const paginate = (page, limit, total) => {
  const currentPage = parseInt(page) || 1;
  const perPage = parseInt(limit) || 20;
  const totalPages = Math.ceil(total / perPage);
  const skip = (currentPage - 1) * perPage;

  return {
    page: currentPage,
    limit: perPage,
    total,
    pages: totalPages,
    skip,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1
  };
};

const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
};

const errorResponse = (res, message = 'Error', statusCode = 400, errors = null) => {
  return res.status(statusCode).json({ success: false, message, ...(errors && { errors }) });
};

const getRandomColor = () => {
  const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#00f2fe', '#43e97b', '#fa709a', '#fee140'];
  return colors[Math.floor(Math.random() * colors.length)];
};

const getCategoryIcon = (category) => {
  const icons = {
    FOOD: '🍔',
    SHOPPING: '🛍️',
    TRANSPORT: '🚗',
    BILLS: '📄',
    ENTERTAINMENT: '🎬',
    HEALTH: '🏥',
    EDUCATION: '📚',
    INVESTMENT: '📈',
    SALARY: '💰',
    BUSINESS: '💼',
    RENT: '🏠',
    EMI: '💳',
    INSURANCE: '🛡️',
    OTHER: '📌'
  };
  return icons[category] || '📌';
};

const isValidUPI = (upiId) => {
  return /^[\w.-]+@[\w.-]+$/.test(upiId);
};

const isValidIFSC = (ifsc) => {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc);
};

const isValidPAN = (pan) => {
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan);
};

const isValidAadhaar = (aadhaar) => {
  return /^\d{12}$/.test(aadhaar);
};

const timeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60
  };

  for (const [unit, value] of Object.entries(intervals)) {
    const count = Math.floor(seconds / value);
    if (count >= 1) return `${count} ${unit}${count > 1 ? 's' : ''} ago`;
  }
  return 'Just now';
};

module.exports = {
  formatCurrency, generateOTP, maskAccountNumber, maskCardNumber,
  maskEmail, maskPhone, paginate, successResponse, errorResponse,
  getRandomColor, getCategoryIcon, isValidUPI, isValidIFSC,
  isValidPAN, isValidAadhaar, timeAgo
};
