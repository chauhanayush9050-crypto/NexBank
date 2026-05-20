# 🏦 NexBank — Full-Stack Online Banking System

> A production-grade, enterprise-level online banking platform built with React, Node.js, MongoDB, Redis, and Socket.io.

---

## 📁 Project Structure

```
NexBank/
├── README.md
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── server.js
│   ├── config/
│   │   └── index.js
│   ├── models/
│   │   └── index.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── bankingController.js
│   │   ├── adminController.js
│   │   └── notificationController.js
│   ├── middleware/
│   │   └── index.js
│   ├── routes/
│   │   └── index.js
│   ├── services/
│   │   └── index.js
│   ├── utils/
│   │   └── index.js
│   ├── jobs/
│   │   └── index.js
│   └── uploads/
│       └── .gitkeep
├── frontend/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css
│       ├── store/
│       │   └── index.js
│       ├── layouts/
│       │   └── MainLayout.jsx
│       ├── pages/
│       │   ├── Auth.jsx
│       │   ├── Dashboard.jsx
│       │   └── Admin.jsx
│       └── assets/
│           └── .gitkeep
```

---

## 🚀 Installation Guide

### Prerequisites
- Node.js >= 18.x
- MongoDB >= 6.x
- Redis >= 7.x
- npm >= 9.x

### 1. Clone & Install

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Configure Environment

```bash
cd backend
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start Services

```bash
# Start MongoDB
mongod --dbpath /data/db

# Start Redis
redis-server

# Start Backend (development)
cd backend
npm run dev

# Start Frontend (development)
cd frontend
npm run dev
```

---

## 🔐 Environment Variables

See `backend/.env.example` for the complete list.

---

## 🧪 Sample Data

Run the seed script:
```bash
cd backend
npm run seed
```

**Default Admin:**
- Email: `admin@nexbank.com`
- Password: `Admin@123456`

**Default User:**
- Email: `john@example.com`
- Password: `User@123456`

---

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register new user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/refresh` | Refresh JWT |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password |
| POST | `/api/auth/verify-email` | Verify email OTP |
| POST | `/api/auth/verify-phone` | Verify phone OTP |
| POST | `/api/auth/enable-2fa` | Enable 2FA |
| POST | `/api/auth/verify-2fa` | Verify 2FA code |
| POST | `/api/auth/resend-otp` | Resend OTP |

### Banking
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/account/summary` | Account summary |
| GET | `/api/account/balance` | Get balance |
| POST | `/api/transaction/deposit` | Deposit funds |
| POST | `/api/transaction/withdraw` | Withdraw funds |
| POST | `/api/transaction/transfer` | Transfer funds |
| POST | `/api/transaction/imps` | IMPS transfer |
| POST | `/api/transaction/rtgs` | RTGS transfer |
| POST | `/api/transaction/neft` | NEFT transfer |
| POST | `/api/transaction/upi` | UPI payment |
| GET | `/api/transaction/history` | Transaction history |
| GET | `/api/transaction/statement` | Download statement |
| POST | `/api/beneficiary/add` | Add beneficiary |
| GET | `/api/beneficiary/list` | List beneficiaries |
| DELETE | `/api/beneficiary/:id` | Remove beneficiary |
| POST | `/api/payment/bill` | Pay bill |
| POST | `/api/payment/recharge` | Mobile recharge |
| POST | `/api/payment/schedule` | Schedule payment |
| POST | `/api/card/virtual` | Create virtual card |
| GET | `/api/card/list` | List cards |
| POST | `/api/loan/apply` | Apply for loan |
| GET | `/api/loan/emicalculator` | EMI calculator |
| POST | `/api/fd/create` | Create fixed deposit |
| POST | `/api/rd/create` | Create recurring deposit |

### KYC
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/kyc/upload` | Upload KYC documents |
| GET | `/api/kyc/status` | KYC status |
| POST | `/api/kyc/selfie` | Upload selfie |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/users` | List all users |
| POST | `/api/admin/freeze/:id` | Freeze account |
| POST | `/api/admin/unfreeze/:id` | Unfreeze account |
| POST | `/api/admin/kyc/approve/:id` | Approve KYC |
| POST | `/api/admin/kyc/reject/:id` | Reject KYC |
| GET | `/api/admin/transactions` | All transactions |
| GET | `/api/admin/analytics` | Platform analytics |
| GET | `/api/admin/fraud` | Fraud monitoring |
| GET | `/api/admin/logs` | Audit logs |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | Get notifications |
| PUT | `/api/notifications/:id/read` | Mark as read |
| GET | `/api/notifications/unread-count` | Unread count |

---

## 🛡️ Security Features

- JWT + Refresh Token rotation
- bcrypt password hashing (salt rounds: 12)
- Account lockout (5 failed attempts, 30 min lock)
- Redis-based OTP with TTL
- Rate limiting per IP
- Helmet security headers
- CORS configuration
- XSS/CSRF protection
- NoSQL injection prevention
- Secure HTTP-only cookies
- Audit logging
- IP-based suspicious login detection

---

## 📜 License

MIT License © 2025 NexBank
