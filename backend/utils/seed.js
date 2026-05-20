require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const { User, Account, Transaction, Card, KYC, Notification, Loan, AuditLog } = require('../models');
const { generateAccountNumber, generateIFSC, generateUPIId, generateCardNumber, generateCVV } = require('../config');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nexbank');
    console.log('MongoDB connected for seeding');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

const hashPassword = async (pw) => bcrypt.hash(pw, 12);
const hashPin = async (pin) => bcrypt.hash(pin, 10);

const seed = async () => {
  try {
    console.log('🔄 Clearing old data...');
    await User.deleteMany({});
    await Account.deleteMany({});
    await Transaction.deleteMany({});
    await Card.deleteMany({});
    await KYC.deleteMany({});
    await Notification.deleteMany({});
    await Loan.deleteMany({});
    await AuditLog.deleteMany({});

    // ── Admin (Pre-created — NO SIGNUP POSSIBLE FOR ADMIN) ──
    // This account is created ONCE during seed. No one can sign up as admin.
    const admin = await User.create({
      firstName: 'Ayush',
      lastName: 'Chauhan',
      email: 'chauhanayush9050@gmail.com',
      phone: '9999999999',
      password: await hashPassword('Ayush@321'),
      dateOfBirth: new Date('1990-01-01'),
      panNumber: 'ADMIN1234A',
      aadhaarNumber: '999999999999',
      address: { street: '1 Admin HQ', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
      isEmailVerified: true,
      isPhoneVerified: true,
      isKYCVerified: true,
      kycLevel: 3,
      role: 'ADMIN',
      isActive: true,
      transactionPin: await hashPin('1234'),
      customerId: 'CUST_ADMIN_00001',
    });
    console.log('  ✅ Admin created');

    const adminAcc = await Account.create({
      userId: admin._id,
      accountNumber: generateAccountNumber(),
      accountType: 'SAVINGS',
      ifsc: generateIFSC(),
      balance: 0,
      status: 'ACTIVE',
      upiId: generateUPIId('superadmin'),
    });

    // ── Demo Users ──
    const users = [];
    const userData = [
      { firstName: 'John', lastName: 'Doe', email: 'john@example.com', phone: '9876543210', dob: '1995-03-15', pan: 'JKLMN5678P', aadhaar: '234567890123', street: '42 Park St', city: 'Bangalore', state: 'Karnataka', pincode: '560001' },
      { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '9876543211', dob: '1992-07-22', pan: 'FGHIJ9012K', aadhaar: '345678901234', street: '15 MG Road', city: 'Delhi', state: 'Delhi', pincode: '110001' },
      { firstName: 'Rahul', lastName: 'Sharma', email: 'rahul@example.com', phone: '9876543212', dob: '1988-11-08', pan: 'PQRST3456U', aadhaar: '456789012345', street: '7 Civil Lines', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      { firstName: 'Priya', lastName: 'Patel', email: 'priya@example.com', phone: '9876543213', dob: '1997-05-30', pan: 'VWXYZ7890A', aadhaar: '567890123456', street: '23 CG Road', city: 'Ahmedabad', state: 'Gujarat', pincode: '380001' },
    ];

    for (const u of userData) {
      const user = await User.create({
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        phone: u.phone,
        password: await hashPassword('User@123'),
        dateOfBirth: new Date(u.dob),
        panNumber: u.pan,
        aadhaarNumber: u.aadhaar,
        address: { street: u.street, city: u.city, state: u.state, pincode: u.pincode },
        isEmailVerified: true,
        isPhoneVerified: true,
        isKYCVerified: true,
        kycLevel: 3,
        role: 'USER',
        isActive: true,
        transactionPin: await hashPin('1234'),
      });

      const balance = Math.floor(Math.random() * 900000) + 100000;
      const acc = await Account.create({
        userId: user._id,
        accountNumber: generateAccountNumber(),
        accountType: 'SAVINGS',
        ifsc: generateIFSC(),
        balance,
        status: 'ACTIVE',
        upiId: generateUPIId(`${u.firstName}${u.lastName}`),
        lastTransactionAt: new Date(),
      });

      await KYC.create({
        userId: user._id,
        status: 'APPROVED',
        level: 3,
        panVerified: true,
        aadhaarVerified: true,
        addressVerified: true,
        documents: [
          { type: 'PAN', number: u.pan, verified: true, verifiedAt: new Date() },
          { type: 'AADHAAR', number: u.aadhaar, verified: true, verifiedAt: new Date() },
        ],
      });

      users.push({ user, account: acc });
      console.log(`  ✅ ${u.firstName} ${u.lastName} — ${acc.accountNumber} (₹${balance.toLocaleString()})`);
    }

    // ── Transactions ──
    const txTypes = ['CREDIT', 'DEBIT', 'TRANSFER', 'DEPOSIT'];
    const channels = ['IMPS', 'NEFT', 'RTGS', 'UPI', 'INTERNAL'];
    const categories = ['FOOD', 'SHOPPING', 'TRANSPORT', 'BILLS', 'ENTERTAINMENT', 'HEALTH', 'EDUCATION', 'SALARY', 'INVESTMENT'];
    const descs = ['Salary credit', 'Grocery purchase', 'Electricity bill', 'Netflix subscription', 'Uber ride', 'Restaurant payment', 'Mutual fund SIP', 'Amazon shopping', 'EMI payment', 'Freelance payment', 'Insurance premium', 'Flight booking'];

    let txCount = 0;
    for (const u of users) {
      for (let i = 0; i < 15; i++) {
        const type = txTypes[Math.floor(Math.random() * txTypes.length)];
        const isDebit = type === 'DEBIT' || type === 'TRANSFER';
        const amount = Math.floor(Math.random() * 50000) + 100;

        await Transaction.create({
          transactionId: `TXN${Date.now()}${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
          fromAccount: isDebit ? u.account.accountNumber : 'EXTERNAL',
          toAccount: isDebit ? 'EXTERNAL' : u.account.accountNumber,
          fromUserId: isDebit ? u.user._id : null,
          toUserId: isDebit ? null : u.user._id,
          amount,
          type,
          channel: channels[Math.floor(Math.random() * channels.length)],
          status: 'COMPLETED',
          description: descs[Math.floor(Math.random() * descs.length)],
          category: categories[Math.floor(Math.random() * categories.length)],
          processedAt: new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)),
          createdAt: new Date(Date.now() - Math.floor(Math.random() * 30 * 24 * 60 * 60 * 1000)),
        });
        txCount++;
      }
    }
    console.log(`  ✅ ${txCount} transactions created`);

    // ── Cards ──
    for (const u of users) {
      const cardNum = generateCardNumber();
      await Card.create({
        userId: u.user._id,
        accountId: u.account._id,
        cardNumber: cardNum,
        cardType: 'DEBIT',
        cardNetwork: 'VISA',
        cardHolderName: `${u.user.firstName.toUpperCase()} ${u.user.lastName.toUpperCase()}`,
        expiryMonth: '12',
        expiryYear: '2028',
        cvv: generateCVV(),
        pin: await hashPin('1234'),
        isVirtual: false,
        status: 'ACTIVE',
      });

      // Virtual card
      const vCardNum = generateCardNumber();
      await Card.create({
        userId: u.user._id,
        accountId: u.account._id,
        cardNumber: vCardNum,
        cardType: 'VIRTUAL',
        cardNetwork: 'VISA',
        cardHolderName: `${u.user.firstName.toUpperCase()} ${u.user.lastName.toUpperCase()}`,
        expiryMonth: '06',
        expiryYear: '2027',
        cvv: generateCVV(),
        pin: await hashPin('1234'),
        isVirtual: true,
        status: 'ACTIVE',
      });
    }
    console.log('  ✅ Cards created (2 per user)');

    // ── Notifications ──
    for (const u of users) {
      await Notification.create({
        userId: u.user._id,
        title: 'Welcome to NexBank!',
        message: 'Your account has been set up successfully. Explore all our banking features.',
        type: 'SYSTEM',
        priority: 'HIGH',
        isRead: false,
      });
      await Notification.create({
        userId: u.user._id,
        title: 'KYC Verified',
        message: 'Your KYC documents have been verified. You now have full access.',
        type: 'KYC',
        priority: 'MEDIUM',
        isRead: false,
      });
      await Notification.create({
        userId: u.user._id,
        title: 'Security Tip',
        message: 'Enable two-factor authentication for enhanced account security.',
        type: 'SECURITY',
        priority: 'HIGH',
        isRead: false,
      });
    }
    console.log('  ✅ Notifications created');

    // ── Audit Logs ──
    for (const u of users) {
      await AuditLog.create({
        userId: u.user._id,
        action: 'SIGNUP',
        category: 'AUTH',
        severity: 'INFO',
        ipAddress: '127.0.0.1',
        createdAt: u.user.createdAt,
      });
      await AuditLog.create({
        userId: u.user._id,
        action: 'LOGIN_SUCCESS',
        category: 'AUTH',
        severity: 'INFO',
        ipAddress: '127.0.0.1',
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000)),
      });
    }
    console.log('  ✅ Audit logs created');

    console.log('\n🎉 Seed complete!\n');
    console.log('══════════════════════════════════════════════════');
    console.log('  🔐 PRE-CREATED ADMIN (no signup possible):');
    console.log('     Email    : chauhanayush9050@gmail.com');
    console.log('     Password : Ayush@321');
    console.log('     Role     : admin');
    console.log('     Login    : http://localhost:5173/admin/login');
    console.log('');
    console.log('  👤 DEMO USERS:');
    console.log('     john@example.com  / User@123');
    console.log('     jane@example.com  / User@123');
    console.log('     rahul@example.com / User@123');
    console.log('     priya@example.com / User@123');
    console.log('     TX Pin: 1234');
    console.log('');
    console.log('  ⛔ NO ADMIN SIGNUP PAGE EXISTS');
    console.log('══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    process.exit(1);
  }
};

connectDB().then(seed);
