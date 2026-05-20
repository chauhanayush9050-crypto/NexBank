import React, { useState, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { FiArrowUpRight, FiArrowDownLeft, FiSend, FiCreditCard, FiRefreshCw, FiPlus, FiTrash2, FiCheck, FiAlertCircle, FiLock, FiUnlock, FiX } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { fetchSummary, makeTransfer, makeDeposit, makeWithdrawal } from '../store';
import axios from 'axios';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler);

const API = axios.create({ baseURL: '/api', withCredentials: true });
API.interceptors.request.use(c => { const t = localStorage.getItem('accessToken'); if (t) c.headers.Authorization = `Bearer ${t}`; return c; });

const Stat = ({ icon, label, value, color }) => (
  <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="card p-4 flex items-center gap-4">
    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-lg" style={{ background: `${color}15`, color }}>{icon}</div>
    <div><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p><p className="text-lg font-bold currency">{value}</p></div>
  </motion.div>
);

const TxRow = ({ tx }) => {
  const isDebit = ['DEBIT', 'WITHDRAWAL', 'TRANSFER'].includes(tx.type);
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: isDebit ? 'rgba(229,62,62,0.1)' : 'rgba(72,187,120,0.1)' }}>
        {isDebit ? <FiArrowUpRight className="text-red-500" size={16} /> : <FiArrowDownLeft className="text-green-500" size={16} />}
      </div>
      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{tx.description || tx.type}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{tx.channel} • {new Date(tx.createdAt).toLocaleDateString()}</p></div>
      <div className="text-right"><p className={`text-sm font-bold ${isDebit ? 'text-red-500' : 'text-green-500'}`}>{isDebit ? '-' : '+'}₹{tx.amount?.toLocaleString()}</p>
        <span className={`badge text-xs ${tx.status === 'COMPLETED' ? 'badge-success' : tx.status === 'PENDING' ? 'badge-warning' : 'badge-danger'}`}>{tx.status}</span></div>
    </div>
  );
};

// Quick Actions
const QuickActions = ({ onAction }) => {
  const items = [
    { icon: '💸', label: 'Transfer', a: 'transfer' }, { icon: '💰', label: 'Deposit', a: 'deposit' },
    { icon: '🏧', label: 'Withdraw', a: 'withdraw' }, { icon: '📱', label: 'UPI', a: 'upi' },
    { icon: '📄', label: 'Bills', a: 'bills' }, { icon: '💳', label: 'Cards', a: 'cards' },
    { icon: '🏦', label: 'FD', a: 'deposits' }, { icon: 'AI', label: 'AI Chat', a: 'ai-assistant' },
  ];
  return (
    <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
      {items.map(i => <button key={i.a} onClick={() => onAction(i.a)} className="card p-3 text-center hover:scale-105 transition-transform"><span className="text-xl block">{i.icon}</span><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{i.label}</span></button>)}
    </div>
  );
};

// OTP Input
const OTPInput = ({ length = 6, onComplete }) => {
  const [otp, setOtp] = useState(Array(length).fill(''));
  const refs = useRef([]);
  const handleChange = (i, v) => {
    if (!/^\d*$/.test(v)) return;
    const o = [...otp]; o[i] = v; setOtp(o);
    if (v && i < length - 1) refs.current[i + 1]?.focus();
    if (o.every(d => d)) onComplete(o.join(''));
  };
  return (
    <div className="flex justify-center gap-2 my-4">
      {otp.map((d, i) => <input key={i} ref={el => refs.current[i] = el} type="text" maxLength={1} value={d} onChange={e => handleChange(i, e.target.value)} className="otp-input" />)}
    </div>
  );
};

// MODAL WRAPPER
const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="modal-content max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">{title}</h3>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><FiX size={18} /></button>
      </div>
      {children}
    </motion.div>
  </div>
);

// TRANSFER MODAL with OTP
const TransferModal = ({ onClose }) => {
  const dispatch = useDispatch();
  const [step, setStep] = useState(1); // 1=form, 2=pin, 3=otp, 4=success
  const [form, setForm] = useState({ toAccount: '', amount: '', type: 'IMPS', description: '' });
  const [pin, setPin] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const step1Submit = () => {
    if (!form.toAccount || !form.amount || Number(form.amount) <= 0) return toast.error('Fill all fields');
    setStep(2);
  };

  const step2Submit = async () => {
    if (!/^\d{4}$|^\d{6}$/.test(pin)) return toast.error('Enter 4 or 6 digit PIN');
    setLoading(true);
    try {
      await API.post('/auth/verify-pin', { pin });
      // PIN OK, generate transfer OTP
      await API.post('/auth/transfer-otp');
      toast.success('OTP sent to your email/phone');
      setStep(3);
    } catch (e) { toast.error(e.response?.data?.message || 'Invalid PIN'); }
    setLoading(false);
  };

  const step3Submit = async () => {
    if (otp.length !== 6) return toast.error('Enter 6-digit OTP');
    setLoading(true);
    try {
      await API.post('/auth/verify-transfer-otp', { otp });
      const { data } = await dispatch(makeTransfer({ ...form, pin })).unwrap();
      setResult(data);
      setStep(4);
      dispatch(fetchSummary());
    } catch (e) { toast.error(e?.message || e?.response?.data?.message || 'Transfer failed'); }
    setLoading(false);
  };

  return (
    <Modal title={step === 4 ? '✅ Transfer Successful' : 'Transfer Funds'} onClose={onClose}>
      {step === 1 && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {['IMPS', 'NEFT', 'RTGS', 'UPI'].map(t => <button key={t} onClick={() => setForm({ ...form, type: t })} className={`py-2 rounded-lg text-sm font-medium ${form.type === t ? 'gradient-bg text-white' : ''}`} style={form.type !== t ? { background: 'var(--bg-secondary)', color: 'var(--text-secondary)' } : {}}>{t}</button>)}
          </div>
          <input className="input" placeholder="Recipient account number" value={form.toAccount} onChange={e => setForm({ ...form, toAccount: e.target.value })} />
          <input className="input" type="number" placeholder="Amount (₹)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          <input className="input" placeholder="Description (optional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <button onClick={step1Submit} className="btn-primary w-full">Continue</button>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3 text-center">
          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-secondary)' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sending</p>
            <p className="text-3xl font-bold">₹{Number(form.amount).toLocaleString()}</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>to {form.toAccount} via {form.type}</p>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Enter your 4-digit Transaction PIN</p>
          <input className="input text-center text-2xl tracking-[0.5em] mx-auto max-w-[240px]" type="password" maxLength={6} placeholder="• • • •" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <div className="flex gap-2"><button onClick={() => setStep(1)} className="btn-secondary flex-1">Back</button><button onClick={step2Submit} disabled={loading} className="btn-primary flex-1">{loading ? 'Verifying...' : 'Verify PIN'}</button></div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Enter the 6-digit OTP sent to your email/phone</p>
          <OTPInput onComplete={setOtp} />
          <button onClick={step3Submit} disabled={loading} className="btn-primary w-full">{loading ? 'Processing...' : 'Confirm Transfer'}</button>
        </div>
      )}
      {step === 4 && result && (
        <div className="text-center space-y-3">
          <div className="text-5xl">✅</div>
          <p className="text-2xl font-bold">₹{result.amount?.toLocaleString()}</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>TXN: {result.transactionId}</p>
          {result.fee > 0 && <p className="text-sm">Fee: ₹{result.fee} | Cashback: ₹{result.cashback}</p>}
          <button onClick={onClose} className="btn-primary w-full">Done</button>
        </div>
      )}
    </Modal>
  );
};

// DEPOSIT MODAL
const DepositModal = ({ onClose }) => {
  const dispatch = useDispatch();
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  const handleDeposit = async () => {
    if (!/^\d{4}$|^\d{6}$/.test(pin)) return toast.error('Enter 4 or 6 digit PIN');
    setLoading(true);
    try {
      await API.post('/auth/verify-pin', { pin });
      await dispatch(makeDeposit({ amount: Number(amount), method: 'ONLINE' })).unwrap();
      toast.success('Deposit successful!');
      dispatch(fetchSummary());
      onClose();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    setLoading(false);
  };

  return (
    <Modal title="Deposit Funds" onClose={onClose}>
      {step === 1 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {[1000, 5000, 10000, 50000].map(a => <button key={a} onClick={() => setAmount(String(a))} className="py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>₹{a.toLocaleString()}</button>)}
          </div>
          <input className="input text-2xl font-bold text-center" type="number" placeholder="Enter amount" value={amount} onChange={e => setAmount(e.target.value)} />
          <button onClick={() => { if (Number(amount) > 0) setStep(2); else toast.error('Enter amount'); }} className="btn-primary w-full">Continue</button>
        </div>
      ) : (
        <div className="space-y-3 text-center">
          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-secondary)' }}><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Depositing</p><p className="text-3xl font-bold">₹{Number(amount).toLocaleString()}</p></div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Enter PIN to confirm</p>
          <input className="input text-center text-2xl tracking-[0.5em] mx-auto max-w-[240px]" type="password" maxLength={6} placeholder="• • • •" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <div className="flex gap-2"><button onClick={() => setStep(1)} className="btn-secondary flex-1">Back</button><button onClick={handleDeposit} disabled={loading} className="btn-primary flex-1">{loading ? 'Processing...' : 'Confirm'}</button></div>
        </div>
      )}
    </Modal>
  );
};

// WITHDRAW MODAL
const WithdrawModal = ({ onClose }) => {
  const dispatch = useDispatch();
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  const handleWithdraw = async () => {
    if (!/^\d{4}$|^\d{6}$/.test(pin)) return toast.error('Enter 4 or 6 digit PIN');
    setLoading(true);
    try {
      await API.post('/auth/verify-pin', { pin });
      await dispatch(makeWithdrawal({ amount: Number(amount), pin })).unwrap();
      toast.success('Withdrawal successful!');
      dispatch(fetchSummary());
      onClose();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    setLoading(false);
  };

  return (
    <Modal title="Withdraw Funds" onClose={onClose}>
      <div className="space-y-3">
        <input className="input text-2xl font-bold text-center" type="number" placeholder="Enter amount" value={amount} onChange={e => setAmount(e.target.value)} />
        <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>Enter PIN to confirm withdrawal</p>
        <input className="input text-center text-2xl tracking-[0.5em] mx-auto max-w-[240px]" type="password" maxLength={6} placeholder="• • • •" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        <button onClick={handleWithdraw} disabled={loading} className="btn-primary w-full">{loading ? 'Processing...' : 'Withdraw'}</button>
      </div>
    </Modal>
  );
};

// CARDS PANEL
const CardsPanel = () => {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState({});
  const loadCards = () => API.get('/card/list').then(r => setCards(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { loadCards(); }, []);

  const blockCard = async (id) => { try { await API.put(`/card/${id}/block`); setCards(prev => prev.map(c => c._id === id ? { ...c, status: 'BLOCKED' } : c)); toast.success('Card blocked'); } catch (e) { toast.error('Failed'); } };
  const unblockCard = async (id) => { try { await API.put(`/card/${id}/unblock`); setCards(prev => prev.map(c => c._id === id ? { ...c, status: 'ACTIVE' } : c)); toast.success('Card unblocked'); } catch (e) { toast.error('Failed'); } };
  const createVirtual = async () => { try { await API.post('/card/virtual'); toast.success('Virtual card created'); loadCards(); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); } };
  const revealCard = async (id) => {
    const pin = prompt('Enter transaction PIN to reveal card');
    if (!pin) return;
    try { const { data } = await API.post(`/card/${id}/reveal`, { pin }); setRevealed(prev => ({ ...prev, [id]: data.data })); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><h3 className="font-bold text-lg">My Cards</h3><button onClick={createVirtual} className="btn-primary text-sm"><FiPlus /> Virtual Card</button></div>
      {loading ? <div className="skeleton h-40" /> : cards.length === 0 ? <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No cards</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cards.map(card => (
            <div key={card._id} className="rounded-2xl p-5 text-white relative overflow-hidden" style={{ background: card.isVirtual ? 'linear-gradient(135deg, #667eea, #764ba2)' : 'linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)' }}>
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white/5" style={{ transform: 'translate(30%,-30%)' }} />
              <div className="flex justify-between mb-6"><span className="text-xs opacity-70">{card.cardNetwork} {card.cardType}</span><span className={`badge text-xs ${card.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>{card.status}</span></div>
              <p className="text-lg tracking-[0.25em] mb-4 font-mono">{revealed[card._id]?.cardNumber?.replace(/(\d{4})(?=\d)/g, '$1 ') || card.cardNumber || 'XXXX XXXX XXXX ****'}</p>
              <div className="flex justify-between text-sm">
                <div><p className="text-xs opacity-60">Holder</p><p>{card.cardHolderName}</p></div>
                <div><p className="text-xs opacity-60">Expires</p><p>{card.expiryMonth}/{card.expiryYear}</p></div>
                <div><p className="text-xs opacity-60">CVV</p><p>{revealed[card._id]?.cvv || '***'}</p></div>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => revealed[card._id] ? setRevealed(prev => ({ ...prev, [card._id]: null })) : revealCard(card._id)} className="text-xs px-3 py-1 rounded-lg bg-white/10 text-white hover:bg-white/20">{revealed[card._id] ? 'Hide' : 'Show'}</button>
                {card.status === 'ACTIVE' && <button onClick={() => blockCard(card._id)} className="text-xs px-3 py-1 rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30"><FiLock size={12} className="inline mr-1" />Block</button>}
                {card.status === 'BLOCKED' && <button onClick={() => unblockCard(card._id)} className="text-xs px-3 py-1 rounded-lg bg-green-500/20 text-green-300 hover:bg-green-500/30"><FiUnlock size={12} className="inline mr-1" />Unblock</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// FD PANEL (working create + break)
const FDPannel = () => {
  const [fds, setFDs] = useState([]);
  const [plans, setPlans] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ amount: '', plan: '1Y' });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [breakingId, setBreakingId] = useState(null);
  const [selectedFD, setSelectedFD] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchFDs = useCallback(() => {
    setLoading(true);
    API.get('/fd/list')
      .then(r => { setPlans(r.data.data.plans || {}); setFDs(r.data.data.fds || r.data.data || []); })
      .catch(e => toast.error(e.response?.data?.message || 'Failed to load FDs'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(fetchFDs, []);

  const selectedPlan = plans[form.plan] || { days: 365, rate: 7.0, label: '1 year' };
  const maturity = form.amount ? (Number(form.amount) * Math.pow(1 + selectedPlan.rate / 400, 4 * (selectedPlan.days / 365))).toFixed(2) : 0;

  const createFD = async (e) => {
    e.preventDefault();
    if (!form.amount || Number(form.amount) < 1000) return toast.error('Min ₹1,000');
    setCreating(true);
    try {
      await API.post('/fd/create', form);
      toast.success('FD created!');
      setShowCreate(false);
      setForm({ amount: '', plan: '1Y' });
      fetchFDs();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setCreating(false); }
  };

  const breakFD = async (id) => {
    if (!confirm('Break this FD? Premature penalty applies.')) return;
    setBreakingId(id);
    try { const { data } = await API.post(`/fd/${id}/break`); toast.success(`FD broken. ₹${data.data.returnAmount?.toLocaleString()} credited.`); setSelectedFD(null); fetchFDs(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setBreakingId(null); }
  };

  const viewFD = async (id) => {
    setDetailLoading(true);
    try {
      const { data } = await API.get(`/fd/${id}`);
      setSelectedFD(data.data);
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to load FD details'); }
    finally { setDetailLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><h3 className="font-bold text-lg">Fixed Deposits</h3>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-primary text-sm"><FiPlus /> New FD</button>
      </div>
      {showCreate && (
        <form onSubmit={createFD} className="card space-y-3" style={{ background: 'var(--bg-secondary)' }}>
          <input className="input" type="number" placeholder="Principal amount (min ₹1,000)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(plans).map(([key, p]) => <button key={key} type="button" onClick={() => setForm({ ...form, plan: key })} className={`py-2 rounded-lg text-sm font-medium ${form.plan === key ? 'gradient-bg text-white' : ''}`} style={form.plan !== key ? { background: 'var(--bg-primary)', color: 'var(--text-secondary)' } : {}}>{p.label}<br /><span className="text-xs">{p.rate}%</span></button>)}
          </div>
          <div className="p-3 rounded-xl text-center" style={{ background: 'rgba(102,126,234,0.1)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Maturity Amount on {new Date(Date.now() + selectedPlan.days * 86400000).toLocaleDateString()}</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--primary)' }}>₹{Number(maturity).toLocaleString()}</p>
          </div>
          <button type="submit" disabled={creating} className="btn-primary w-full">{creating ? 'Creating...' : 'Create FD'}</button>
        </form>
      )}
      {loading ? <div className="skeleton h-20" /> : fds.length === 0 ? <p className="text-center py-6" style={{ color: 'var(--text-muted)' }}>No FDs</p> : fds.map(fd => (
        <div key={fd._id} onClick={() => viewFD(fd._id)} className="card flex items-center justify-between">
          <div><p className="font-semibold">₹{fd.principal?.toLocaleString()} <span className={`badge text-xs ml-1 ${fd.status === 'ACTIVE' ? 'badge-success' : fd.status === 'MATURED' ? 'badge-info' : 'badge-warning'}`}>{fd.status}</span></p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{fd.tenureDays} days @ {fd.interestRate}% | Maturity: ₹{fd.maturityAmount?.toLocaleString()} on {new Date(fd.maturityDate).toLocaleDateString()} | Penalty: {fd.status === 'ACTIVE' ? '1% lower interest, no interest before 30 days' : `₹${(fd.prematurePenalty || 0).toLocaleString()}`}</p></div>
          {fd.status === 'ACTIVE' && <button onClick={(e) => { e.stopPropagation(); breakFD(fd._id); }} disabled={breakingId === fd._id} className="btn-danger text-xs py-2 px-3">{breakingId === fd._id ? 'Breaking...' : 'Break FD'}</button>}
        </div>
      ))}
      {detailLoading && <div className="skeleton h-20" />}
      {selectedFD && (
        <Modal title="FD Details" onClose={() => setSelectedFD(null)}>
          <div className="space-y-3">
            {[
              ['FD Number', selectedFD.fd.fdNumber],
              ['Status', selectedFD.fd.status],
              ['Principal', `₹${selectedFD.fd.principal?.toLocaleString()}`],
              ['Interest Rate', `${selectedFD.fd.interestRate}%`],
              ['Maturity Amount', `₹${selectedFD.fd.maturityAmount?.toLocaleString()}`],
              ['Interest Earned', `₹${selectedFD.maturity.interestEarned?.toLocaleString()}`],
              ['Start Date', new Date(selectedFD.fd.startDate).toLocaleDateString()],
              ['Maturity Date', new Date(selectedFD.fd.maturityDate).toLocaleDateString()],
              ['Days Remaining', selectedFD.maturity.daysRemaining],
              ['Premature Return', `₹${selectedFD.maturity.prematureReturnAmount?.toLocaleString()}`],
              ['Premature Penalty', `₹${selectedFD.maturity.prematurePenalty?.toLocaleString()}`]
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span className="font-semibold">{value}</span>
              </div>
            ))}
            {selectedFD.fd.status === 'ACTIVE' && <button onClick={() => breakFD(selectedFD.fd._id)} disabled={breakingId === selectedFD.fd._id} className="btn-danger w-full">{breakingId === selectedFD.fd._id ? 'Breaking...' : 'Break FD'}</button>}
          </div>
        </Modal>
      )}
    </div>
  );
};

// LOANS PANEL
const LoansPanel = () => {
  const [loans, setLoans] = useState([]);
  const [emiCalc, setEmiCalc] = useState({ principal: 100000, rate: 12, tenure: 12 });
  useEffect(() => { API.get('/loan/list').then(r => setLoans(r.data.data)).catch(() => {}); }, []);
  const emi = emiCalc.principal > 0 ? Math.round((emiCalc.principal * (emiCalc.rate / 12 / 100) * Math.pow(1 + emiCalc.rate / 12 / 100, emiCalc.tenure)) / (Math.pow(1 + emiCalc.rate / 12 / 100, emiCalc.tenure) - 1)) : 0;

  return (
    <div className="space-y-4">
      <div className="card"><h3 className="font-bold mb-3">EMI Calculator</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-xs" style={{ color: 'var(--text-muted)' }}>Amount (₹)</label><input className="input mt-1" type="number" value={emiCalc.principal} onChange={e => setEmiCalc({ ...emiCalc, principal: Number(e.target.value) })} /></div>
          <div><label className="text-xs" style={{ color: 'var(--text-muted)' }}>Rate (%)</label><input className="input mt-1" type="number" value={emiCalc.rate} onChange={e => setEmiCalc({ ...emiCalc, rate: Number(e.target.value) })} /></div>
          <div><label className="text-xs" style={{ color: 'var(--text-muted)' }}>Tenure (months)</label><input className="input mt-1" type="number" value={emiCalc.tenure} onChange={e => setEmiCalc({ ...emiCalc, tenure: Number(e.target.value) })} /></div>
          <div className="flex items-end"><div className="w-full p-3 rounded-xl text-center" style={{ background: 'rgba(102,126,234,0.1)' }}><p className="text-xs" style={{ color: 'var(--text-muted)' }}>EMI</p><p className="text-xl font-bold" style={{ color: 'var(--primary)' }}>₹{emi.toLocaleString()}</p></div></div>
        </div>
      </div>
      <div className="card"><h3 className="font-bold mb-3">My Loans</h3>
        {loans.length === 0 ? <p className="text-center py-4" style={{ color: 'var(--text-muted)' }}>No loans</p> : loans.map(l => (
          <div key={l._id} className="p-3 rounded-xl mb-2" style={{ background: 'var(--bg-secondary)' }}>
            <div className="flex justify-between"><p className="font-semibold">{l.loanType} Loan</p><span className={`badge ${l.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'}`}>{l.status}</span></div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-sm"><div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Principal</p><p className="font-semibold">₹{l.principal?.toLocaleString()}</p></div>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>EMI</p><p className="font-semibold">₹{l.emi?.toLocaleString()}</p></div>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Outstanding</p><p className="font-semibold">₹{l.outstandingAmount?.toLocaleString()}</p></div></div>
          </div>
        ))}
      </div>
    </div>
  );
};

// BENEFICIARIES PANEL
const BeneficiariesPanel = () => {
  const [list, setList] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', accountNumber: '', ifsc: '', bank: '' });
  useEffect(() => { API.get('/beneficiary/list').then(r => setList(r.data.data)).catch(() => {}); }, []);
  const add = async (e) => { e.preventDefault(); try { const { data } = await API.post('/beneficiary/add', form); setList(prev => [...prev, data.data]); toast.success('Added'); setShowAdd(false); setForm({ name: '', accountNumber: '', ifsc: '', bank: '' }); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); } };
  const remove = async (id) => { try { await API.delete(`/beneficiary/${id}`); setList(prev => prev.filter(b => b._id !== id)); toast.success('Removed'); } catch { toast.error('Failed'); } };

  return (
    <div className="space-y-4">
      <div className="flex justify-between"><h3 className="font-bold text-lg">Beneficiaries</h3><button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-sm"><FiPlus /> Add</button></div>
      {showAdd && (
        <form onSubmit={add} className="card space-y-3" style={{ background: 'var(--bg-secondary)' }}>
          <div className="grid grid-cols-2 gap-3"><input className="input" placeholder="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /><input className="input" placeholder="Bank *" value={form.bank} onChange={e => setForm({ ...form, bank: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3"><input className="input" placeholder="Account Number *" value={form.accountNumber} onChange={e => setForm({ ...form, accountNumber: e.target.value })} required /><input className="input" placeholder="IFSC *" value={form.ifsc} onChange={e => setForm({ ...form, ifsc: e.target.value })} required /></div>
          <div className="flex gap-2"><button type="submit" className="btn-primary text-sm">Add</button><button type="button" onClick={() => setShowAdd(false)} className="btn-secondary text-sm">Cancel</button></div>
        </form>
      )}
      {list.length === 0 ? <p className="text-center py-6" style={{ color: 'var(--text-muted)' }}>No beneficiaries</p> : list.map(b => (
        <div key={b._id} className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-full gradient-bg flex items-center justify-center text-white font-bold text-sm">{b.name[0]}</div>
          <div className="flex-1 min-w-0"><p className="font-medium text-sm">{b.name}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{b.bank} • ****{b.accountNumber?.slice(-4)}</p></div>
          <button onClick={() => remove(b._id)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"><FiTrash2 size={16} /></button>
        </div>
      ))}
    </div>
  );
};

// KYC PANEL
const KYCPanel = () => {
  const [kyc, setKYC] = useState(null);
  const [form, setForm] = useState({ documentType: 'PAN', documentNumber: '', documentImage: '' });
  const [progress, setProgress] = useState(0);
  useEffect(() => { API.get('/kyc/status').then(r => setKYC(r.data.data)).catch(() => {}); }, []);
  const fileToDataUrl = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  const refresh = () => API.get('/kyc/status').then(r => setKYC(r.data.data));
  const upload = async (e) => {
    e.preventDefault();
    try {
      setProgress(10);
      await API.post('/kyc/upload', form, { onUploadProgress: ev => setProgress(Math.round((ev.loaded * 100) / (ev.total || ev.loaded))) });
      toast.success('Submitted');
      setForm({ documentType: 'PAN', documentNumber: '', documentImage: '' });
      setProgress(0);
      refresh();
    } catch (e) { setProgress(0); toast.error(e.response?.data?.message || 'Failed'); }
  };
  const uploadSelfie = async (selfieImage) => { try { setProgress(10); await API.post('/kyc/selfie', { selfieImage }); toast.success('Selfie uploaded'); setProgress(0); refresh(); } catch (e) { setProgress(0); toast.error(e.response?.data?.message || 'Failed'); } };
  const sc = { NOT_STARTED: 'badge-warning', PENDING: 'badge-warning', SUBMITTED: 'badge-info', APPROVED: 'badge-success', REJECTED: 'badge-danger' };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl" style={{ background: kyc?.status === 'APPROVED' ? 'rgba(72,187,120,0.1)' : 'rgba(236,201,75,0.1)' }}>{kyc?.status === 'APPROVED' ? '✅' : '⏳'}</div>
        <div><p className="font-semibold">Status: <span className={`badge ${sc[kyc?.status] || 'badge-warning'}`}>{kyc?.status || 'NOT_STARTED'}</span></p><p className="text-sm" style={{ color: 'var(--text-muted)' }}>Level: {kyc?.level || 0}/3 | Confidence: {kyc?.confidenceScore || 0}%</p></div>
      </div>
      {kyc?.status !== 'APPROVED' && (
        <div className="card"><h3 className="font-bold mb-3">Upload KYC</h3>
          <form onSubmit={upload} className="space-y-3">
            <select className="input" value={form.documentType} onChange={e => setForm({ ...form, documentType: e.target.value, documentNumber: '', documentImage: '' })}><option value="PROFILE_PHOTO">Profile Photo</option><option value="PAN">PAN Card</option><option value="AADHAAR">Aadhaar</option></select>
            {form.documentType !== 'PROFILE_PHOTO' && <input className="input" placeholder="Document Number" value={form.documentNumber} onChange={e => setForm({ ...form, documentNumber: e.target.value })} required />}
            <input className="input" type="file" accept="image/*" onChange={async e => setForm({ ...form, documentImage: e.target.files?.[0] ? await fileToDataUrl(e.target.files[0]) : '' })} required />
            {form.documentImage && <img src={form.documentImage} alt="Document preview" className="w-full max-h-52 object-contain rounded-xl" style={{ background: 'var(--bg-secondary)' }} />}
            {progress > 0 && <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}><div className="h-full gradient-bg" style={{ width: `${progress}%` }} /></div>}
            <button type="submit" className="btn-primary">Submit</button>
          </form>
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <label className="text-sm font-medium">Selfie Upload</label>
            <input className="input mt-2" type="file" accept="image/*" onChange={async e => { const file = e.target.files?.[0]; if (file) uploadSelfie(await fileToDataUrl(file)); }} />
          </div>
          {kyc?.documents?.length > 0 && <div className="mt-4 grid grid-cols-2 gap-3">{kyc.documents.map(d => <div key={d.type} className="p-2 rounded-xl" style={{ background: 'var(--bg-secondary)' }}><p className="text-xs font-semibold">{d.type}</p>{d.frontImage && <img src={d.frontImage} alt={`${d.type} preview`} className="w-full h-24 object-cover rounded-lg mt-1" />}</div>)}</div>}
          {kyc?.selfieImage && <img src={kyc.selfieImage} alt="Selfie preview" className="mt-3 w-32 h-32 object-cover rounded-xl" />}
        </div>
      )}
    </div>
  );
};

// BILLS PANEL
const BillsPanel = () => {
  const [form, setForm] = useState({ category: 'ELECTRICITY', provider: '', consumerNumber: '', amount: '', pin: '' });
  const pay = async (e) => { e.preventDefault(); try { await API.post('/payment/bill', form); toast.success('Bill paid!'); setForm({ category: 'ELECTRICITY', provider: '', consumerNumber: '', amount: '', pin: '' }); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); } };
  return (
    <div className="card max-w-lg"><h3 className="font-bold text-lg mb-4">Pay Bills</h3>
      <form onSubmit={pay} className="space-y-3">
        <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{['ELECTRICITY', 'WATER', 'GAS', 'INTERNET', 'MOBILE', 'DTH', 'INSURANCE'].map(c => <option key={c}>{c}</option>)}</select>
        <input className="input" placeholder="Provider" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} required />
        <input className="input" placeholder="Consumer Number" value={form.consumerNumber} onChange={e => setForm({ ...form, consumerNumber: e.target.value })} required />
        <input className="input" type="number" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required />
        <input className="input" type="password" maxLength={6} placeholder="Transaction PIN" value={form.pin} onChange={e => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} required />
        <button type="submit" className="btn-primary w-full">Pay Bill</button>
      </form>
    </div>
  );
};

// PASSBOOK PANEL
const PassbookPanel = () => {
  const [passbook, setPassbook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchPassbook = useCallback(() => {
    setLoading(true);
    API.get(`/account/passbook?page=${page}&limit=25`)
      .then(r => setPassbook(r.data.data))
      .catch(e => toast.error(e.response?.data?.message || 'Failed to load passbook'))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(fetchPassbook, [fetchPassbook]);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div><h3 className="font-bold text-lg">Digital Passbook</h3><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{passbook?.account?.accountNumber || 'Account'} • {passbook?.account?.ifsc || 'IFSC'}</p></div>
          <button onClick={fetchPassbook} className="btn-secondary text-sm"><FiRefreshCw size={14} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl" style={{ background: 'var(--bg-secondary)' }}><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Opening Balance</p><p className="font-bold">₹{(passbook?.openingBalance || 0).toLocaleString()}</p></div>
          <div className="p-3 rounded-xl" style={{ background: 'var(--bg-secondary)' }}><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Current Balance</p><p className="font-bold">₹{(passbook?.closingBalance || 0).toLocaleString()}</p></div>
        </div>
      </div>

      <div className="card">
        <h3 className="font-bold mb-3">Entries</h3>
        {loading ? <div className="skeleton h-20" /> : !passbook?.entries?.length ? <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No passbook entries</p> : (
          <div className="space-y-1">
            {passbook.entries.map(entry => {
              const isDebit = entry.signedAmount < 0;
              return (
                <div key={entry.transactionId} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: isDebit ? 'rgba(229,62,62,0.1)' : 'rgba(72,187,120,0.1)' }}>
                    {isDebit ? <FiArrowUpRight className="text-red-500" size={16} /> : <FiArrowDownLeft className="text-green-500" size={16} />}
                  </div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{entry.description}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(entry.date).toLocaleDateString()} • {entry.channel} • {entry.referenceId}</p></div>
                  <div className="text-right"><p className={`text-sm font-bold ${isDebit ? 'text-red-500' : 'text-green-500'}`}>{isDebit ? '-' : '+'}₹{Math.abs(entry.signedAmount).toLocaleString()}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Bal ₹{entry.balance?.toLocaleString()}</p></div>
                </div>
              );
            })}
          </div>
        )}
        {passbook?.pagination?.pages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn-secondary text-sm">Previous</button>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {page} of {passbook.pagination.pages}</span>
            <button disabled={page >= passbook.pagination.pages} onClick={() => setPage(page + 1)} className="btn-secondary text-sm">Next</button>
          </div>
        )}
      </div>
    </div>
  );
};

// STATEMENTS PANEL
const StatementsPanel = () => {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = today.toISOString().split('T')[0];
  const [range, setRange] = useState({ startDate: monthStart, endDate: monthEnd });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadSummary = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams({ ...range, format: 'json' }).toString();
    API.get(`/transaction/statement/download?${q}`)
      .then(r => setSummary(r.data.data.summary))
      .catch(e => toast.error(e.response?.data?.message || 'Failed to load statement summary'))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(loadSummary, [loadSummary]);

  const downloadPDF = async (e) => {
    e.preventDefault();
    if (!range.startDate || !range.endDate) return toast.error('Select date range');
    setLoading(true);
    try {
      const q = new URLSearchParams({ ...range, format: 'pdf' }).toString();
      const response = await API.get(`/transaction/statement/download?${q}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `statement-${range.startDate}-${range.endDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Statement generated');
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to generate statement'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="card max-w-2xl">
        <h3 className="font-bold text-lg mb-4">Monthly Statement</h3>
        <form onSubmit={downloadPDF} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input" type="date" value={range.startDate} onChange={e => setRange({ ...range, startDate: e.target.value })} required />
            <input className="input" type="date" value={range.endDate} onChange={e => setRange({ ...range, endDate: e.target.value })} required />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Generating...' : 'Generate PDF Statement'}</button>
        </form>
      </div>

      <div className="card max-w-2xl">
        <h3 className="font-bold mb-3">Transaction Summary</h3>
        {loading && !summary ? <div className="skeleton h-20" /> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl" style={{ background: 'var(--bg-secondary)' }}><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Transactions</p><p className="font-bold">{summary?.transactionCount || 0}</p></div>
            <div className="p-3 rounded-xl" style={{ background: 'var(--bg-secondary)' }}><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Credits</p><p className="font-bold text-green-500">₹{(summary?.totalCredits || 0).toLocaleString()}</p></div>
            <div className="p-3 rounded-xl" style={{ background: 'var(--bg-secondary)' }}><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Debits</p><p className="font-bold text-red-500">₹{(summary?.totalDebits || 0).toLocaleString()}</p></div>
            <div className="p-3 rounded-xl" style={{ background: 'var(--bg-secondary)' }}><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Net</p><p className="font-bold">₹{(summary?.netMovement || 0).toLocaleString()}</p></div>
          </div>
        )}
      </div>
    </div>
  );
};

// UPI PANEL
const UPIPanel = () => {
  const dispatch = useDispatch();
  const [upiId, setUpiId] = useState('');
  const [history, setHistory] = useState([]);
  const [createForm, setCreateForm] = useState({ upiId: '' });
  const [sendForm, setSendForm] = useState({ upiId: '', amount: '', pin: '', note: '' });
  const [receiveForm, setReceiveForm] = useState({ fromUpiId: '', amount: '', note: '' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const fetchUPI = useCallback(() => {
    setLoading(true);
    API.get('/upi/history')
      .then(r => { setUpiId(r.data.data.upiId || ''); setHistory(r.data.data.transactions || []); })
      .catch(e => toast.error(e.response?.data?.message || 'Failed to load UPI'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(fetchUPI, [fetchUPI]);

  const createUPI = async (e) => {
    e.preventDefault();
    setBusy('create');
    try {
      const payload = createForm.upiId ? { upiId: createForm.upiId } : {};
      const { data } = await API.post('/upi/create', payload);
      setUpiId(data.data.upiId);
      setCreateForm({ upiId: '' });
      toast.success(data.message || 'UPI ID created');
      dispatch(fetchSummary());
      fetchUPI();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setBusy(''); }
  };

  const sendUPI = async (e) => {
    e.preventDefault();
    if (!sendForm.upiId || !sendForm.amount || !sendForm.pin) return toast.error('Fill all required fields');
    setBusy('send');
    try {
      await API.post('/upi/send', { ...sendForm, amount: Number(sendForm.amount) });
      toast.success('UPI payment sent');
      setSendForm({ upiId: '', amount: '', pin: '', note: '' });
      dispatch(fetchSummary());
      fetchUPI();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setBusy(''); }
  };

  const receiveUPI = async (e) => {
    e.preventDefault();
    if (!receiveForm.amount) return toast.error('Amount required');
    setBusy('receive');
    try {
      await API.post('/upi/receive', { ...receiveForm, amount: Number(receiveForm.amount) });
      toast.success('UPI money received');
      setReceiveForm({ fromUpiId: '', amount: '', note: '' });
      dispatch(fetchSummary());
      fetchUPI();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div><h3 className="font-bold text-lg">UPI</h3><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{upiId || 'No UPI ID linked'}</p></div>
          <button onClick={fetchUPI} className="btn-secondary text-sm"><FiRefreshCw size={14} /></button>
        </div>
        <form onSubmit={createUPI} className="flex gap-2">
          <input className="input flex-1" placeholder="yourname@nexbank" value={createForm.upiId} onChange={e => setCreateForm({ upiId: e.target.value.toLowerCase() })} />
          <button type="submit" disabled={busy === 'create'} className="btn-primary text-sm">{busy === 'create' ? 'Creating...' : upiId ? 'Update' : 'Create'}</button>
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="font-bold mb-3">Send Money</h3>
          <form onSubmit={sendUPI} className="space-y-3">
            <input className="input" placeholder="Recipient UPI ID" value={sendForm.upiId} onChange={e => setSendForm({ ...sendForm, upiId: e.target.value.toLowerCase() })} required />
            <input className="input" type="number" placeholder="Amount" value={sendForm.amount} onChange={e => setSendForm({ ...sendForm, amount: e.target.value })} required />
            <input className="input" placeholder="Note" value={sendForm.note} onChange={e => setSendForm({ ...sendForm, note: e.target.value })} />
            <input className="input" type="password" maxLength={6} placeholder="Transaction PIN" value={sendForm.pin} onChange={e => setSendForm({ ...sendForm, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} required />
            <button type="submit" disabled={busy === 'send'} className="btn-primary w-full"><FiSend /> {busy === 'send' ? 'Sending...' : 'Send via UPI'}</button>
          </form>
        </div>

        <div className="card">
          <h3 className="font-bold mb-3">Receive Money</h3>
          <form onSubmit={receiveUPI} className="space-y-3">
            <input className="input" placeholder="From UPI ID (optional)" value={receiveForm.fromUpiId} onChange={e => setReceiveForm({ ...receiveForm, fromUpiId: e.target.value.toLowerCase() })} />
            <input className="input" type="number" placeholder="Amount" value={receiveForm.amount} onChange={e => setReceiveForm({ ...receiveForm, amount: e.target.value })} required />
            <input className="input" placeholder="Note" value={receiveForm.note} onChange={e => setReceiveForm({ ...receiveForm, note: e.target.value })} />
            <button type="submit" disabled={busy === 'receive'} className="btn-primary w-full">{busy === 'receive' ? 'Receiving...' : 'Simulate Receive'}</button>
          </form>
        </div>
      </div>

      <div className="card">
        <h3 className="font-bold mb-3">UPI Transaction History</h3>
        {loading ? <div className="skeleton h-20" /> : history.length === 0 ? <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No UPI transactions</p> : history.map(tx => <TxRow key={tx._id || tx.transactionId} tx={tx} />)}
      </div>
    </div>
  );
};

// AI CHAT
const AIChat = () => {
  const [messages, setMessages] = useState([{ role: 'bot', text: 'Hi! I\'m your NexBank AI assistant. Ask me anything about your account.' }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const prompts = ['What is my balance?', 'Summarize transactions', 'Explain FD plans', 'Loan guidance', 'Card help', 'Support options'];
  const send = async (prompt) => {
    const text = (prompt || input).trim();
    if (!text) return;
    setMessages(p => [...p, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    try {
      const { data } = await API.post('/ai/chat', { message: text });
      setMessages(p => [...p, { role: 'bot', text: data.data.response }]);
    } catch (e) {
      setMessages(p => [...p, { role: 'bot', text: e.response?.data?.message || 'Sorry, I couldn\'t process that.' }]);
    }
    setLoading(false);
  };

  return (
    <div className="card h-[480px] flex flex-col"><h3 className="font-bold mb-3">🤖 AI Banking Assistant</h3>
      <div className="flex-1 overflow-y-auto space-y-3 mb-3">
        {messages.map((m, i) => <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[80%] p-3 rounded-2xl text-sm ${m.role === 'user' ? 'gradient-bg text-white rounded-br-sm' : 'rounded-bl-sm'}`} style={m.role !== 'user' ? { background: 'var(--bg-secondary)' } : {}}>{m.text}</div></div>)}
        {loading && <div className="flex gap-1 pl-3"><div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" /><div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} /><div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} /></div>}
      </div>
      <div className="flex flex-wrap gap-2 mb-3">{prompts.map(p => <button key={p} onClick={() => send(p)} className="btn-secondary text-xs">{p}</button>)}</div>
      <div className="flex gap-2"><input className="input flex-1" placeholder="Ask me anything..." value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} /><button onClick={() => send()} className="btn-primary px-4">Send</button></div>
    </div>
  );
};

// SETTINGS PANEL — Full PIN management
const SettingsPanel = () => {
  const { user } = useSelector(s => s.auth);
  const [section, setSection] = useState('overview');
  const [loading, setLoading] = useState(false);

  // Set PIN state
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  // Change PIN state
  const [currentPin, setCurrentPin] = useState('');
  const [changeNewPin, setChangeNewPin] = useState('');
  const [changeConfirmPin, setChangeConfirmPin] = useState('');

  // Reset PIN state
  const [resetStep, setResetStep] = useState(1);
  const [resetOtp, setResetOtp] = useState('');
  const [resetNewPin, setResetNewPin] = useState('');
  const [resetConfirmPin, setResetConfirmPin] = useState('');

  const setPIN = async () => {
    if (!/^\d{4}$|^\d{6}$/.test(newPin)) return toast.error('PIN must be 4 or 6 digits');
    if (newPin !== confirmPin) return toast.error('PINs don\'t match');
    setLoading(true);
    try { await API.post('/auth/set-pin', { pin: newPin, confirmPin }); toast.success('PIN set!'); setNewPin(''); setConfirmPin(''); setSection('overview'); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    setLoading(false);
  };

  const changePIN = async () => {
    if (!currentPin || !changeNewPin || !changeConfirmPin) return toast.error('Fill all fields');
    if (changeNewPin !== changeConfirmPin) return toast.error('New PINs don\'t match');
    if (!/^\d{4}$|^\d{6}$/.test(changeNewPin)) return toast.error('PIN must be 4 or 6 digits');
    setLoading(true);
    try { await API.post('/auth/change-pin', { currentPin, newPin: changeNewPin, confirmPin: changeConfirmPin }); toast.success('PIN changed!'); setCurrentPin(''); setChangeNewPin(''); setChangeConfirmPin(''); setSection('overview'); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    setLoading(false);
  };

  const requestReset = async () => {
    setLoading(true);
    try { await API.post('/auth/request-pin-reset'); toast.success('OTP sent to email/phone'); setResetStep(2); } catch (e) { toast.error('Failed'); }
    setLoading(false);
  };

  const resetPIN = async () => {
    if (!resetOtp || !resetNewPin || !resetConfirmPin) return toast.error('Fill all fields');
    if (resetNewPin !== resetConfirmPin) return toast.error('PINs don\'t match');
    if (!/^\d{4}$|^\d{6}$/.test(resetNewPin)) return toast.error('PIN must be 4 or 6 digits');
    setLoading(true);
    try { await API.post('/auth/reset-pin-otp', { otp: resetOtp, newPin: resetNewPin, confirmPin: resetConfirmPin }); toast.success('PIN reset!'); setResetStep(1); setResetOtp(''); setResetNewPin(''); setResetConfirmPin(''); setSection('overview'); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    setLoading(false);
  };

  const generatePin = () => {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    setNewPin(pin);
    setConfirmPin(pin);
  };

  const PinInput = ({ value, onChange, placeholder }) => (
    <input className="input text-center text-2xl tracking-[0.5em] max-w-[240px] mx-auto" type="password" maxLength={6} placeholder={placeholder || '••••'} value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} />
  );

  return (
    <div className="max-w-lg space-y-4">
      <div className="card">
        <h3 className="font-bold text-lg mb-3">🔒 Transaction PIN</h3>
        <div className="flex gap-2 mb-4">
          {['overview', 'set', 'change', 'reset'].map(s => (
            <button key={s} onClick={() => setSection(s)} className={`tab text-xs capitalize ${section === s ? 'active' : ''}`}>{s === 'reset' ? 'Reset via OTP' : s === 'change' ? 'Change' : s === 'set' ? 'Set PIN' : 'Info'}</button>
          ))}
        </div>

        {section === 'overview' && (
          <div className="p-4 rounded-xl text-center" style={{ background: 'var(--bg-secondary)' }}>
            <div className="text-4xl mb-2">🔐</div>
            <p className="font-semibold">PIN Status</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Your transaction PIN is stored securely and cannot be viewed by anyone — including us.</p>
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>PIN is hashed with bcrypt. We never display it in plain text.</p>
          </div>
        )}

        {section === 'set' && (
          <div className="space-y-3 text-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Set a new 4 or 6 digit transaction PIN</p>
            <PinInput value={newPin} onChange={setNewPin} placeholder="New PIN" />
            <PinInput value={confirmPin} onChange={setConfirmPin} placeholder="Confirm PIN" />
            <button onClick={generatePin} disabled={loading} className="btn-secondary w-full">Auto-generate secure PIN</button>
            <button onClick={setPIN} disabled={loading} className="btn-primary w-full">{loading ? 'Setting...' : 'Set PIN'}</button>
          </div>
        )}

        {section === 'change' && (
          <div className="space-y-3 text-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Enter current PIN, then choose a new one</p>
            <PinInput value={currentPin} onChange={setCurrentPin} placeholder="Current PIN" />
            <PinInput value={changeNewPin} onChange={setChangeNewPin} placeholder="New PIN" />
            <PinInput value={changeConfirmPin} onChange={setChangeConfirmPin} placeholder="Confirm New" />
            <button onClick={changePIN} disabled={loading} className="btn-primary w-full">{loading ? 'Changing...' : 'Change PIN'}</button>
          </div>
        )}

        {section === 'reset' && (
          <div className="space-y-3 text-center">
            {resetStep === 1 ? (
              <>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>We'll send an OTP to verify your identity</p>
                <button onClick={requestReset} disabled={loading} className="btn-primary w-full">{loading ? 'Sending...' : 'Send OTP'}</button>
              </>
            ) : (
              <>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Enter the 6-digit OTP and your new PIN</p>
                <input className="input text-center tracking-[0.3em]" maxLength={6} placeholder="6-digit OTP" value={resetOtp} onChange={e => setResetOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                <PinInput value={resetNewPin} onChange={setResetNewPin} placeholder="New PIN" />
                <PinInput value={resetConfirmPin} onChange={setResetConfirmPin} placeholder="Confirm" />
                <button onClick={resetPIN} disabled={loading} className="btn-primary w-full">{loading ? 'Resetting...' : 'Reset PIN'}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ANALYTICS
const AnalyticsPanel = () => {
  const { spendingByCategory } = useSelector(s => s.account);
  const chartData = { labels: (spendingByCategory || []).map(d => d._id), datasets: [{ data: (spendingByCategory || []).map(d => d.total), backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#48bb78', '#ecc94b', '#e53e3e', '#4299e1', '#ed8936'], borderWidth: 0 }] };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card"><h3 className="font-bold mb-4">Spending Breakdown</h3>{spendingByCategory?.length > 0 ? <Doughnut data={chartData} options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } } }, cutout: '65%' }} /> : <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No data</p>}</div>
      <div className="card"><h3 className="font-bold mb-4">Insights</h3>{(spendingByCategory || []).map((c, i) => <div key={i} className="flex justify-between p-2 rounded-lg" style={{ background: 'var(--bg-secondary)' }}><span className="text-sm">{c._id}</span><span className="font-semibold text-sm">₹{c.total?.toLocaleString()}</span></div>)}</div>
    </div>
  );
};

// MAIN DASHBOARD
export default function Dashboard() {
  const dispatch = useDispatch();
  const location = useLocation();
  const { user } = useSelector(s => s.auth);
  const { account, balance, availableBalance, recentTransactions, cards, spendingByCategory, summary, loading } = useSelector(s => s.account);
  const { transactions } = useSelector(s => s.transactions);
  const [modal, setModal] = useState(null);

  const tab = (() => { const p = location.pathname.replace('/dashboard', '').replace(/^\//, ''); return p || 'overview'; })();
  const allTx = recentTransactions?.length > 0 ? recentTransactions : transactions || [];

  useEffect(() => { dispatch(fetchSummary()); }, [dispatch]);

  const handleAction = (a) => {
    if (['transfer', 'deposit', 'withdraw'].includes(a)) setModal(a);
    else if (a === 'ai-assistant') {
      window.history.pushState({}, '', '/dashboard/ai-assistant');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else if (a === 'upi') {
      window.history.pushState({}, '', '/dashboard/upi');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  if (loading && !account) return <div className="space-y-4"><div className="skeleton h-8 w-48" /><div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-20" />)}</div></div>;

  const tabs = ['overview', 'transactions', 'passbook', 'statements', 'upi', 'beneficiaries', 'cards', 'loans', 'deposits', 'bills', 'kyc', 'analytics', 'ai-assistant', 'settings'];

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold">Welcome, {user?.firstName} 👋</h1><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Here's your financial overview</p></div>
        <button onClick={() => dispatch(fetchSummary())} className="btn-secondary text-sm"><FiRefreshCw size={14} /></button>
      </div>

      <QuickActions onAction={handleAction} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon="💰" label="Balance" value={`₹${(balance || 0).toLocaleString()}`} color="#667eea" />
        <Stat icon="📊" label="Available" value={`₹${(availableBalance || 0).toLocaleString()}`} color="#48bb78" />
        <Stat icon="💸" label="Spent (30d)" value={`₹${(summary?.totalDebits || 0).toLocaleString()}`} color="#e53e3e" />
        <Stat icon="📈" label="Income (30d)" value={`₹${(summary?.totalCredits || 0).toLocaleString()}`} color="#ecc94b" />
      </div>

      {/* Account Details Card */}
      {account && (
        <div className="card" style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', border: 'none', color: 'white' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><span className="text-lg">🏦</span><span className="font-bold">NexBank Savings Account</span></div>
            <span className="badge badge-success text-xs">ACTIVE</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><p className="text-white/50 text-xs">Account Number</p><p className="font-mono font-bold text-base">{account.accountNumber}</p></div>
            <div><p className="text-white/50 text-xs">Customer ID</p><p className="font-mono font-bold">{user?.customerId || 'N/A'}</p></div>
            <div><p className="text-white/50 text-xs">IFSC Code</p><p className="font-mono">{account.ifsc}</p></div>
            <div><p className="text-white/50 text-xs">UPI ID</p><p className="font-mono text-xs">{account.upiId}</p></div>
          </div>
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="text-white/50 text-xs">Available Balance</p>
            <p className="text-3xl font-bold">₹{(balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>
      )}

      {/* Masked Card */}
      {cards && cards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cards.slice(0, 2).map(card => (
            <div key={card._id} className="rounded-2xl p-4 relative overflow-hidden" style={{ background: card.isVirtual ? 'linear-gradient(135deg, #667eea, #764ba2)' : 'linear-gradient(135deg, #2d3748, #1a202c)' }}>
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-white/5" style={{ transform: 'translate(30%,-30%)' }} />
              <div className="flex justify-between items-start mb-4">
                <span className="text-white text-xs opacity-70">{card.cardNetwork} {card.cardType}</span>
                <span className="text-white text-xs opacity-50">{card.isVirtual ? '📱 Virtual' : '💳 Physical'}</span>
              </div>
              <p className="text-white text-lg tracking-[0.2em] font-mono mb-2">
                {card.cardNumber || 'XXXX XXXX XXXX ****'}
              </p>
              <div className="flex justify-between text-white text-xs">
                <div><span className="opacity-50">VALID THRU </span>{card.expiryMonth}/{card.expiryYear}</div>
                <div>{card.cardHolderName}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map(t => <a key={t} href={`/dashboard/${t === 'overview' ? '' : t}`} onClick={e => { e.preventDefault(); window.history.pushState({}, '', `/dashboard/${t === 'overview' ? '' : t}`); window.dispatchEvent(new PopStateEvent('popstate')); }}
          className={`tab whitespace-nowrap capitalize ${tab === t || (t === 'overview' && tab === '') ? 'active' : ''}`}>{t === 'ai-assistant' ? 'AI Assistant' : t}</a>)}
      </div>

      <div key={tab}>
        {(tab === 'overview' || tab === '') && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 card">
              <h3 className="font-bold mb-3">Recent Transactions</h3>
              {allTx.length > 0 ? allTx.slice(0, 8).map((tx, i) => <TxRow key={tx._id || i} tx={tx} />) :
                <div className="text-center py-8" style={{ color: 'var(--text-muted)' }}><p>No transactions yet</p><button onClick={() => setModal('deposit')} className="btn-primary mt-3">Make a deposit</button></div>}
            </div>
            <div className="space-y-5">
              <div className="card"><h3 className="font-bold mb-3">Spending</h3><AnalyticsPanel /></div>
              <button onClick={() => setModal('transfer')} className="btn-primary w-full"><FiSend /> Send Money</button>
            </div>
          </div>
        )}
        {tab === 'transactions' && <div className="card"><h3 className="font-bold mb-3">Transaction History</h3>{allTx.length > 0 ? allTx.map((tx, i) => <TxRow key={tx._id || i} tx={tx} />) : <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No transactions</p>}</div>}
        {tab === 'passbook' && <PassbookPanel />}
        {tab === 'statements' && <StatementsPanel />}
        {tab === 'upi' && <UPIPanel />}
        {tab === 'transfer' && <TransferModal onClose={() => window.history.pushState({}, '', '/dashboard')} />}
        {tab === 'beneficiaries' && <BeneficiariesPanel />}
        {tab === 'cards' && <CardsPanel />}
        {tab === 'loans' && <LoansPanel />}
        {tab === 'deposits' && <FDPannel />}
        {tab === 'bills' && <BillsPanel />}
        {tab === 'kyc' && <KYCPanel />}
        {tab === 'analytics' && <AnalyticsPanel />}
        {(tab === 'ai-assistant' || tab === 'ai') && <AIChat />}
        {tab === 'settings' && <SettingsPanel />}
      </div>

      {modal === 'transfer' && <TransferModal onClose={() => setModal(null)} />}
      {modal === 'deposit' && <DepositModal onClose={() => setModal(null)} />}
      {modal === 'withdraw' && <WithdrawModal onClose={() => setModal(null)} />}
    </div>
  );
}
