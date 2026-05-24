import React, { useState, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiMail, FiLock, FiUser, FiPhone, FiEye, FiEyeOff, FiArrowLeft, FiAlertCircle, FiLoader } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { login, signup, clearError } from '../store';
import { api as API } from '../lib/api';

// ============================================
// SHARED INPUT COMPONENT — icons never overlap text
// ============================================
const IconInput = ({ icon: Icon, error, rightIcon, ...props }) => (
  <div>
    <div className="relative">
      {Icon && (
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <Icon size={18} />
        </span>
      )}
      <input
        className={`block w-full py-3.5 rounded-xl border-2 bg-transparent outline-none transition-all text-sm
          ${Icon ? 'pl-11' : 'pl-4'}
          ${rightIcon ? 'pr-11' : 'pr-4'}
          ${error ? 'border-red-400 focus:border-red-500' : 'border-gray-200 dark:border-gray-700 focus:border-indigo-500'}
        `}
        style={{ color: 'var(--text-primary)', background: 'var(--bg-card)', borderColor: error ? undefined : 'var(--border)' }}
        {...props}
      />
      {rightIcon && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2">{rightIcon}</span>
      )}
    </div>
    {error && (
      <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1 pl-1">
        <FiAlertCircle size={12} /> {error}
      </p>
    )}
  </div>
);

// ============================================
// LOGIN FORM
// ============================================
const LoginForm = ({ isAdmin }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading, error } = useSelector(s => s.auth);
  const [showPw, setShowPw] = useState(false);
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const e = {};
    if (!form.email) e.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Invalid email';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 4) e.password = 'Min 4 characters';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    dispatch(clearError());
    setSubmitting(true);

    try {
      if (isAdmin) {
        const { data } = await API.post('/auth/admin-login', form);
        if (data.success && data.data?.tokens?.accessToken) {
          localStorage.setItem('accessToken', data.data.tokens.accessToken);
          localStorage.setItem('refreshToken', data.data.tokens.refreshToken || '');
          localStorage.setItem('user', JSON.stringify(data.data.user));
          dispatch({ type: 'auth/login/fulfilled', payload: data });
          toast.success('Welcome, Admin!');
          navigate('/admin');
          return;
        }
      } else {
        const r = await dispatch(login(form)).unwrap();
        toast.success(r?.message || 'Welcome back!');
        navigate('/dashboard');
        return;
      }
    } catch (err) {
      console.error("LOGIN ERROR:", err);
      const msg = err?.response?.data?.message || err?.message || (isAdmin ? 'Admin login failed' : 'Login failed');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || loading;

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && !isAdmin && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
          <FiAlertCircle className="shrink-0" /> {error}
        </div>
      )}

      <IconInput
        icon={FiMail}
        type="email"
        placeholder={isAdmin ? 'Admin email' : 'Email address'}
        value={form.email}
        onChange={e => setForm({ ...form, email: e.target.value })}
        error={errors.email}
        disabled={busy}
        autoComplete="email"
      />

      <IconInput
        icon={FiLock}
        type={showPw ? 'text' : 'password'}
        placeholder="Password"
        value={form.password}
        onChange={e => setForm({ ...form, password: e.target.value })}
        error={errors.password}
        disabled={busy}
        autoComplete="current-password"
        rightIcon={
          <button
            type="button"
            onClick={() => setShowPw(!showPw)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
            tabIndex={-1}
          >
            {showPw ? <FiEyeOff size={18} /> : <FiEye size={18} />}
          </button>
        }
      />

      {!isAdmin && (
        <div className="flex justify-between items-center text-sm">
          <label className="flex items-center gap-2 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" className="w-4 h-4 rounded accent-indigo-600" />
            Remember
          </label>
          <a href="/forgot-password" className="font-medium text-indigo-600 hover:text-indigo-500">
            Forgot password?
          </a>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="btn-primary w-full py-3.5 text-base flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <FiLoader className="animate-spin" size={18} />
            {isAdmin ? 'Signing in...' : 'Signing in...'}
          </>
        ) : isAdmin ? '🛡️ Admin Sign In' : 'Sign In'}
      </button>

      {isAdmin && (
        <div className="p-3 rounded-xl text-center text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
          ⛔ Only pre-created admin accounts can login here.<br />No admin signup exists.
        </div>
      )}
    </form>
  );
};

// ============================================
// SIGNUP FORM (2-step)
// ============================================
const SignupForm = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading } = useSelector(s => s.auth);
  const [step, setStep] = useState(1);
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '',
    password: '', confirmPassword: '', dateOfBirth: '',
    pinMode: 'AUTO', pin: '', confirmPin: '',
    panNumber: '', aadhaarNumber: '',
    address: { street: '', city: '', state: '', pincode: '' }
  });
  const [errors, setErrors] = useState({});

  const v1 = () => {
    const e = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email) e.email = 'Required';
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone) e.phone = 'Required';
    else if (form.phone.length < 10) e.phone = 'Min 10 digits';
    if (!form.password) e.password = 'Required';
    else if (form.password.length < 8) e.password = 'Min 8 chars';
    else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/.test(form.password)) e.password = 'Need uppercase, lowercase, number & special char';
    if (form.password !== form.confirmPassword) e.confirmPassword = "Passwords don't match";
    if (form.pinMode === 'CUSTOM') {
      if (!/^\d{4}$|^\d{6}$/.test(form.pin)) e.pin = 'PIN must be 4 or 6 digits';
      if (form.pin !== form.confirmPin) e.confirmPin = "PINs don't match";
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const v2 = () => {
    const e = {};
    if (!form.dateOfBirth) e.dateOfBirth = 'Required';
    if (!form.panNumber || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.panNumber.toUpperCase())) e.panNumber = 'Invalid PAN';
    if (!form.aadhaarNumber || !/^\d{12}$/.test(form.aadhaarNumber)) e.aadhaarNumber = 'Invalid (12 digits)';
    if (!form.address.street) e.street = 'Required';
    if (!form.address.city) e.city = 'Required';
    if (!form.address.state) e.state = 'Required';
    if (!form.address.pincode || !/^\d{6}$/.test(form.address.pincode)) e.pincode = 'Invalid (6 digits)';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const submit = async (ev) => {
    ev.preventDefault();
    if (submitting) return;

    if (step === 1) {
      if (v1()) setStep(2);
      return;
    }

    if (!v2()) return;

    setSubmitting(true);
    try {
      const result = await dispatch(signup({ ...form, panNumber: form.panNumber.toUpperCase() })).unwrap();
      toast.success(result?.data?.pin?.generatedPin ? `Account created. PIN: ${result.data.pin.generatedPin}` : result?.message || 'Account created successfully! Redirecting...');
      // Auto-navigate to dashboard after short delay
      setTimeout(() => navigate('/dashboard'), 800);
    } catch (err) {
      toast.error(typeof err === 'string' ? err : err?.message || err?.response?.data?.message || 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || loading;

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Progress */}
      <div className="flex gap-2 mb-2">
        {[1, 2].map(s => (
          <div key={s} className="flex-1 h-1.5 rounded-full transition-colors" style={{ background: step >= s ? 'var(--primary)' : 'var(--border)' }} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 1 ? (
          <motion.div key="s1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <IconInput icon={FiUser} placeholder="First name *" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} error={errors.firstName} disabled={busy} />
              <IconInput icon={FiUser} placeholder="Last name *" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} error={errors.lastName} disabled={busy} />
            </div>
            <IconInput icon={FiMail} type="email" placeholder="Email *" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} error={errors.email} disabled={busy} autoComplete="email" />
            <IconInput icon={FiPhone} type="tel" placeholder="Phone *" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} error={errors.phone} disabled={busy} />
            <IconInput
              icon={FiLock}
              type={showPw ? 'text' : 'password'}
              placeholder="Password *"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              error={errors.password}
              disabled={busy}
              rightIcon={
                <button type="button" onClick={() => setShowPw(!showPw)} className="text-gray-400 hover:text-gray-600 p-1" tabIndex={-1}>
                  {showPw ? <FiEyeOff size={18} /> : <FiEye size={18} />}
                </button>
              }
            />
            <IconInput icon={FiLock} type="password" placeholder="Confirm password *" value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })} error={errors.confirmPassword} disabled={busy} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setForm({ ...form, pinMode: 'AUTO', pin: '', confirmPin: '' })} className={`py-2 rounded-lg text-sm font-medium ${form.pinMode === 'AUTO' ? 'gradient-bg text-white' : ''}`} style={form.pinMode !== 'AUTO' ? { background: 'var(--bg-secondary)', color: 'var(--text-secondary)' } : {}}>Auto PIN</button>
              <button type="button" onClick={() => setForm({ ...form, pinMode: 'CUSTOM' })} className={`py-2 rounded-lg text-sm font-medium ${form.pinMode === 'CUSTOM' ? 'gradient-bg text-white' : ''}`} style={form.pinMode !== 'CUSTOM' ? { background: 'var(--bg-secondary)', color: 'var(--text-secondary)' } : {}}>Custom PIN</button>
            </div>
            {form.pinMode === 'CUSTOM' && (
              <div className="grid grid-cols-2 gap-3">
                <IconInput icon={FiLock} type="password" placeholder="PIN *" value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} error={errors.pin} disabled={busy} />
                <IconInput icon={FiLock} type="password" placeholder="Confirm PIN *" value={form.confirmPin} onChange={e => setForm({ ...form, confirmPin: e.target.value.replace(/\D/g, '').slice(0, 6) })} error={errors.confirmPin} disabled={busy} />
              </div>
            )}
            <button type="submit" disabled={busy} className="btn-primary w-full py-3">Continue</button>
          </motion.div>
        ) : (
          <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
            <button type="button" onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-500 font-medium">
              <FiArrowLeft size={14} /> Back
            </button>

            <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Date of Birth *</label>
            <input type="date" className="input" value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} disabled={busy} />
            {errors.dateOfBirth && <p className="text-red-500 text-xs">{errors.dateOfBirth}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <input className="input" placeholder="PAN Number *" value={form.panNumber} onChange={e => setForm({ ...form, panNumber: e.target.value.toUpperCase() })} disabled={busy} />
                {errors.panNumber && <p className="text-red-500 text-xs">{errors.panNumber}</p>}
              </div>
              <div>
                <input className="input" placeholder="Aadhaar (12 digits) *" value={form.aadhaarNumber} onChange={e => setForm({ ...form, aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12) })} disabled={busy} />
                {errors.aadhaarNumber && <p className="text-red-500 text-xs">{errors.aadhaarNumber}</p>}
              </div>
            </div>

            <input className="input" placeholder="Street Address *" value={form.address.street} onChange={e => setForm({ ...form, address: { ...form.address, street: e.target.value } })} disabled={busy} />
            {errors.street && <p className="text-red-500 text-xs">{errors.street}</p>}

            <div className="grid grid-cols-3 gap-3">
              <div>
                <input className="input" placeholder="City *" value={form.address.city} onChange={e => setForm({ ...form, address: { ...form.address, city: e.target.value } })} disabled={busy} />
                {errors.city && <p className="text-red-500 text-xs">{errors.city}</p>}
              </div>
              <div>
                <input className="input" placeholder="State *" value={form.address.state} onChange={e => setForm({ ...form, address: { ...form.address, state: e.target.value } })} disabled={busy} />
                {errors.state && <p className="text-red-500 text-xs">{errors.state}</p>}
              </div>
              <div>
                <input
                  className="input"
                  placeholder="Pincode *"
                  value={form.address.pincode}
                  onChange={e => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setForm(prev => ({ ...prev, address: { ...prev.address, pincode: val } }));
                  }}
                  disabled={busy}
                />
                {errors.pincode && <p className="text-red-500 text-xs">{errors.pincode}</p>}
              </div>
            </div>

            <button type="submit" disabled={busy} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
              {busy ? (
                <><FiLoader className="animate-spin" size={18} /> Creating Account...</>
              ) : 'Create Account'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
};

// ============================================
// FORGOT PASSWORD
// ============================================
const ForgotForm = () => {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef([]);

  const sendOtp = async (e) => {
    e.preventDefault();
    if (loading || !email) return;
    setLoading(true);
    try {
      const { data } = await API.post('/auth/forgot-password', { email });
      if (data.userId) setUserId(data.userId);
      toast.success('OTP sent to your email');
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOtp = (i, v) => {
    if (!/^\d*$/.test(v)) return;
    const o = [...otp];
    o[i] = v;
    setOtp(o);
    if (v && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const reset = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (otp.join('').length !== 6) return toast.error('Enter 6-digit OTP');
    if (!newPassword) return toast.error('Enter new password');
    setLoading(true);
    try {
      await API.post('/auth/reset-password', { userId, otp: otp.join(''), newPassword, confirmPassword: newPassword });
      toast.success('Password reset! Redirecting to login...');
      setTimeout(() => { window.location.href = '/login'; }, 1000);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <AnimatePresence mode="wait">
        {step === 1 ? (
          <motion.form key="f1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={sendOtp} className="space-y-4">
            <IconInput icon={FiMail} type="email" placeholder="Enter your email" value={email} onChange={e => setEmail(e.target.value)} required disabled={loading} />
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
              {loading ? <><FiLoader className="animate-spin" size={18} /> Sending...</> : 'Send Reset OTP'}
            </button>
          </motion.form>
        ) : (
          <motion.form key="f2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={reset} className="space-y-4">
            <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
              Enter the 6-digit OTP sent to your email
            </p>
            <div className="flex justify-center gap-2">
              {otp.map((d, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el; }}
                  type="text"
                  maxLength={1}
                  value={d}
                  onChange={e => handleOtp(i, e.target.value)}
                  className="otp-input"
                  disabled={loading}
                />
              ))}
            </div>
            <IconInput icon={FiLock} type="password" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required disabled={loading} />
            <button type="submit" disabled={loading} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
              {loading ? <><FiLoader className="animate-spin" size={18} /> Resetting...</> : 'Reset Password'}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
      <a href="/login" className="flex items-center justify-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        <FiArrowLeft size={14} /> Back to login
      </a>
    </div>
  );
};

// ============================================
// MAIN AUTH PAGE
// ============================================
export default function Auth({ isAdmin }) {
  const location = useLocation();
  const isSignup = location.pathname === '/signup';
  const isForgot = location.pathname === '/forgot-password';
  const isAdminLogin = location.pathname === '/admin/login';

  return (
    <div className="min-h-screen flex">
      {/* Left branding */}
      <div className="hidden lg:flex lg:w-[45%] gradient-bg relative overflow-hidden items-center justify-center p-10">
        <div className="relative z-10 text-white max-w-md">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center text-3xl">
                {isAdminLogin ? '🛡️' : '🏦'}
              </div>
              <span className="text-3xl font-bold">NexBank</span>
            </div>
            <h1 className="text-4xl font-bold mb-4 leading-tight">
              {isAdminLogin ? 'Admin Portal' : 'Your Modern Digital Banking Experience'}
            </h1>
            <p className="text-lg text-white/80 mb-8">
              {isAdminLogin
                ? 'Manage users, monitor transactions, and control the platform.'
                : 'Secure, fast, and intelligent banking at your fingertips.'}
            </p>
            {!isAdminLogin && (
              <div className="flex gap-8">
                {[['256-bit', 'Encryption'], ['24/7', 'Support'], ['0 Fees', 'Transfers']].map(([v, l]) => (
                  <div key={l}>
                    <p className="text-2xl font-bold">{v}</p>
                    <p className="text-white/60 text-sm">{l}</p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full glass opacity-20" />
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full glass opacity-10" />
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-8" style={{ background: 'var(--bg-primary)' }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-white font-bold text-lg">
              {isAdminLogin ? '🛡️' : 'N'}
            </div>
            <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>NexBank</span>
          </div>

          <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            {isAdminLogin ? 'Admin Login' : isSignup ? 'Create your account' : isForgot ? 'Reset password' : 'Welcome back'}
          </h2>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            {isAdminLogin
              ? 'Sign in to the admin portal'
              : isSignup
              ? 'Start your digital banking journey'
              : isForgot
              ? 'Enter your email to reset password'
              : 'Sign in to your NexBank account'}
          </p>

          {isSignup
            ? <SignupForm />
            : isForgot
            ? <ForgotForm />
            : <LoginForm isAdmin={isAdminLogin} />}

          {!isForgot && !isAdminLogin && !isSignup && (
            <p className="text-center text-sm mt-4" style={{ color: 'var(--text-secondary)' }}>
              Don&apos;t have an account?{' '}
              <a href="/signup" className="font-semibold text-indigo-600 hover:text-indigo-500 ml-1">Sign up</a>
            </p>
          )}
          {isSignup && (
            <p className="text-center text-sm mt-4" style={{ color: 'var(--text-secondary)' }}>
              Already have an account?{' '}
              <a href="/login" className="font-semibold text-indigo-600 hover:text-indigo-500 ml-1">Sign in</a>
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
