const cron = require('node-cron');
const { logger } = require('../config');
const { Account, Transaction, ScheduledPayment, FixedDeposit, RecurringDeposit, Loan } = require('../models');
const { createNotification } = require('../services');

// ============================================
// RESET DAILY/MONTHLY LIMITS - Runs at midnight
// ============================================
const resetDailyLimits = cron.schedule('0 0 * * *', async () => {
  try {
    logger.info('Running cron: Reset daily limits');
    await Account.updateMany({}, { $set: { dailySpent: 0 } });
    logger.info('Daily limits reset successfully');
  } catch (error) {
    logger.error('Reset daily limits error:', error);
  }
});

// ============================================
// RESET MONTHLY LIMITS - Runs 1st of every month
// ============================================
const resetMonthlyLimits = cron.schedule('0 0 1 * *', async () => {
  try {
    logger.info('Running cron: Reset monthly limits');
    await Account.updateMany({}, { $set: { monthlySpent: 0 } });
    logger.info('Monthly limits reset successfully');
  } catch (error) {
    logger.error('Reset monthly limits error:', error);
  }
});

// ============================================
// PROCESS SCHEDULED PAYMENTS - Runs every hour
// ============================================
const processScheduledPayments = cron.schedule('0 * * * *', async () => {
  try {
    logger.info('Running cron: Process scheduled payments');
    const now = new Date();
    const payments = await ScheduledPayment.find({
      status: 'ACTIVE',
      nextExecution: { $lte: now }
    }).limit(100);

    for (const payment of payments) {
      try {
        const fromAccount = await Account.findOne({ accountNumber: payment.fromAccount });
        if (!fromAccount || fromAccount.balance - payment.amount < fromAccount.minBalance) {
          payment.status = 'FAILED';
          await payment.save();
          continue;
        }

        const toAccount = await Account.findOne({ accountNumber: payment.toAccount });

        // Process the payment
        fromAccount.balance -= payment.amount;
        await fromAccount.save();

        if (toAccount) {
          toAccount.balance += payment.amount;
          await toAccount.save();
        }

        payment.lastExecuted = now;
        payment.executionCount += 1;
        payment.transactionIds.push(`TXN${Date.now()}${Math.random().toString(36).substring(2, 7)}`);

        // Calculate next execution
        if (payment.frequency === 'DAILY') payment.nextExecution = new Date(now.getTime() + 86400000);
        else if (payment.frequency === 'WEEKLY') payment.nextExecution = new Date(now.getTime() + 7 * 86400000);
        else if (payment.frequency === 'MONTHLY') {
          const next = new Date(now);
          next.setMonth(next.getMonth() + 1);
          payment.nextExecution = next;
        }
        else if (payment.frequency === 'YEARLY') {
          const next = new Date(now);
          next.setFullYear(next.getFullYear() + 1);
          payment.nextExecution = next;
        }
        else if (payment.frequency === 'ONCE') {
          payment.status = 'COMPLETED';
        }

        // Check end date and max executions
        if (payment.endDate && payment.nextExecution > payment.endDate) payment.status = 'COMPLETED';
        if (payment.maxExecutions && payment.executionCount >= payment.maxExecutions) payment.status = 'COMPLETED';

        await payment.save();
        await createNotification(fromAccount.userId, 'Scheduled Payment Executed', `₹${payment.amount} sent to ${payment.toAccount}`, 'TRANSACTION', 'MEDIUM');
      } catch (err) {
        logger.error(`Scheduled payment ${payment._id} error:`, err);
      }
    }
    logger.info(`Processed ${payments.length} scheduled payments`);
  } catch (error) {
    logger.error('Process scheduled payments error:', error);
  }
});

// ============================================
// CHECK MATURING FDs - Runs daily at 9 AM
// ============================================
const checkMaturity = cron.schedule('0 9 * * *', async () => {
  try {
    logger.info('Running cron: Check maturity dates');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 7);

    const maturingFDs = await FixedDeposit.find({
      status: 'ACTIVE',
      maturityDate: { $lte: tomorrow }
    }).populate('userId', 'firstName email');

    for (const fd of maturingFDs) {
      await createNotification(fd.userId._id, 'FD Maturing Soon', `Your FD ${fd.fdNumber} of ₹${fd.principal.toLocaleString()} is maturing on ${fd.maturityDate.toDateString()}.`, 'SYSTEM', 'HIGH');
    }

    // Auto-mature past-due FDs
    const maturedFDs = await FixedDeposit.find({
      status: 'ACTIVE',
      maturityDate: { $lte: new Date() }
    });

    for (const fd of maturedFDs) {
      fd.status = 'MATURED';
      await fd.save();

      const account = await Account.findById(fd.accountId);
      if (account) {
        account.balance += fd.maturityAmount;
        await account.save();
      }

      await createNotification(fd.userId, 'FD Matured', `Your FD ${fd.fdNumber} has matured. ₹${fd.maturityAmount.toLocaleString()} credited to your account.`, 'TRANSACTION', 'HIGH');
    }

    logger.info(`Checked ${maturingFDs.length} maturing FDs, matured ${maturedFDs.length}`);
  } catch (error) {
    logger.error('Check maturity error:', error);
  }
});

// ============================================
// LOAN EMI REMINDER - Runs daily at 8 AM
// ============================================
const emiReminder = cron.schedule('0 8 * * *', async () => {
  try {
    const in7Days = new Date();
    in7Days.setDate(in7Days.getDate() + 7);

    const upcomingEMIs = await Loan.find({
      status: 'ACTIVE',
      nextEmiDate: { $lte: in7Days, $gte: new Date() }
    }).populate('userId', 'firstName email');

    for (const loan of upcomingEMIs) {
      await createNotification(loan.userId._id, 'EMI Reminder', `Your ${loan.loanType} loan EMI of ₹${loan.emi.toLocaleString()} is due on ${loan.nextEmiDate.toDateString()}. Ensure sufficient balance.`, 'LOAN', 'HIGH');
    }

    logger.info(`Sent ${upcomingEMIs.length} EMI reminders`);
  } catch (error) {
    logger.error('EMI reminder error:', error);
  }
});

// ============================================
// DORMANT ACCOUNT CHECK - Runs monthly
// ============================================
const checkDormantAccounts = cron.schedule('0 2 1 * *', async () => {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const dormantAccounts = await Account.find({
      status: 'ACTIVE',
      lastTransactionAt: { $lt: oneYearAgo }
    });

    for (const account of dormantAccounts) {
      account.status = 'DORMANT';
      await account.save();
      await createNotification(account.userId, 'Account Dormant', 'Your account has been marked as dormant due to inactivity. Please make a transaction to reactivate.', 'ALERT', 'HIGH');
    }

    logger.info(`Marked ${dormantAccounts.length} accounts as dormant`);
  } catch (error) {
    logger.error('Dormant account check error:', error);
  }
});

module.exports = {
  resetDailyLimits,
  resetMonthlyLimits,
  processScheduledPayments,
  checkMaturity,
  emiReminder,
  checkDormantAccounts
};
