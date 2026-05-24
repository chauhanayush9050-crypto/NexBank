import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiUsers, FiDollarSign, FiAlertTriangle, FiCheck, FiX, FiSearch, FiEye, FiLock, FiUnlock, FiShield, FiTrash2 } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { api as API } from '../lib/api';

const Stat = ({ icon: Icon, label, value, color }) => (
  <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="card p-4 flex items-center gap-4">
    <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${color}15`, color }}><Icon size={22} /></div>
    <div><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</p><p className="text-xl font-bold">{value}</p></div>
  </motion.div>
);

const Badge = ({ type }) => {
  const map = { ACTIVE: 'badge-success', FROZEN: 'badge-danger', BLOCKED: 'badge-danger', COMPLETED: 'badge-success', PENDING: 'badge-warning', FAILED: 'badge-danger', APPROVED: 'badge-success', REJECTED: 'badge-danger' };
  return <span className={`badge text-xs ${map[type] || 'badge-info'}`}>{type}</span>;
};

// USERS MANAGEMENT
function UsersPanel() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 0 });
  const [search, setSearch] = useState('');
  const [viewUser, setViewUser] = useState(null);

  const fetch = (page = 1) => API.get(`/admin/users?page=${page}&search=${search}`).then(r => { setUsers(r.data.data.users); setPagination(r.data.data.pagination); }).catch(() => {});
  useEffect(() => { fetch(); }, [search]);

  const freeze = async (id) => { const r = prompt('Reason:'); if (!r) return; try { await API.post(`/admin/freeze/${id}`, { reason: r }); toast.success('Frozen'); fetch(pagination.page); } catch { toast.error('Failed'); } };
  const unfreeze = async (id) => { try { await API.post(`/admin/unfreeze/${id}`); toast.success('Unfrozen'); fetch(pagination.page); } catch { toast.error('Failed'); } };
  const deleteUser = async (id) => { if (!confirm('⚠️ Permanently deactivate this user? This blocks all access.')) return; try { await API.delete(`/admin/users/${id}`); toast.success('User deactivated'); fetch(pagination.page); } catch { toast.error('Failed'); } };
  const promoteAdmin = async (id) => { if (!confirm('🔒 Promote this user to Admin? They will gain full admin access.')) return; try { await API.post(`/admin/promote/${id}`, { reason: 'Promoted by admin' }); toast.success('User promoted to Admin'); fetch(pagination.page); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); } };
  const demoteAdmin = async (id) => { if (!confirm('⚠️ Remove admin access from this user?')) return; try { await API.post(`/admin/demote/${id}`, { reason: 'Demoted by super admin' }); toast.success('Admin access removed'); fetch(pagination.page); } catch (e) { toast.error(e.response?.data?.message || 'Failed'); } };

  return (
    <div className="space-y-4">
      <div className="relative"><FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" /><input className="input pl-11" placeholder="Search by name, email, phone..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr style={{ background: 'var(--bg-secondary)' }}>
              <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>User</th>
              <th className="text-left p-3 font-semibold hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Email</th>
              <th className="text-left p-3 font-semibold hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>Account</th>
              <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Balance</th>
              <th className="text-left p-3 font-semibold hidden md:table-cell" style={{ color: 'var(--text-secondary)' }}>Status</th>
              <th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Actions</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u._id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-3"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded-full gradient-bg flex items-center justify-center text-white text-xs font-bold">{u.firstName?.[0]}{u.lastName?.[0]}</div><div><p className="font-medium text-sm">{u.firstName} {u.lastName}</p><p className="text-xs md:hidden" style={{ color: 'var(--text-muted)' }}>{u.email}</p></div></div></td>
                  <td className="p-3 hidden md:table-cell text-sm">{u.email}</td>
                  <td className="p-3 hidden lg:table-cell font-mono text-xs">{u.account?.accountNumber || 'N/A'}</td>
                  <td className="p-3 font-semibold text-sm">₹{u.account?.balance?.toLocaleString() || 0}</td>
                  <td className="p-3 hidden md:table-cell">
                    <Badge type={u.isFrozen ? 'FROZEN' : u.isActive ? 'ACTIVE' : 'BLOCKED'} />
                    <span className="ml-1 badge badge-info text-xs">{u.role}</span>
                  </td>
                  <td className="p-3"><div className="flex gap-1">
                    <button onClick={() => API.get(`/admin/users/${u._id}`).then(r => setViewUser(r.data.data))} className="p-1.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500" title="View"><FiEye size={15} /></button>
                    {u.isFrozen ? <button onClick={() => unfreeze(u._id)} className="p-1.5 rounded hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500" title="Unfreeze"><FiUnlock size={15} /></button>
                      : <button onClick={() => freeze(u._id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="Freeze"><FiLock size={15} /></button>}
                    {u.role === 'USER' && <button onClick={() => promoteAdmin(u._id)} className="text-xs px-2 py-1 rounded bg-purple-500/10 text-purple-400 hover:bg-purple-500/20" title="Make Admin">👑 Admin</button>}
                    {u.role === 'ADMIN' && <button onClick={() => demoteAdmin(u._id)} className="text-xs px-2 py-1 rounded bg-orange-500/10 text-orange-400 hover:bg-orange-500/20" title="Remove Admin">↩️ Remove</button>}
                    <button onClick={() => deleteUser(u._id)} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="Delete"><FiTrash2 size={15} /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between p-3" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{users.length} of {pagination.total} users</p>
          <div className="flex gap-1">{Array.from({ length: Math.min(pagination.pages, 5) }, (_, i) => <button key={i} onClick={() => fetch(i + 1)} className={`w-7 h-7 rounded text-xs ${pagination.page === i + 1 ? 'gradient-bg text-white' : ''}`} style={pagination.page !== i + 1 ? { background: 'var(--bg-secondary)' } : {}}>{i + 1}</button>)}</div>
        </div>
      </div>

      {viewUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setViewUser(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="modal-content max-w-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-3">User Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Name</p><p className="font-semibold">{viewUser.user?.firstName} {viewUser.user?.lastName}</p></div>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Email</p><p className="font-semibold">{viewUser.user?.email}</p></div>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Phone</p><p>{viewUser.user?.phone}</p></div>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Account</p><p className="font-mono">{viewUser.account?.accountNumber}</p></div>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Balance</p><p className="font-bold text-lg">₹{viewUser.account?.balance?.toLocaleString()}</p></div>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>KYC</p><Badge type={viewUser.user?.isKYCVerified ? 'APPROVED' : 'PENDING'} /></div>
            </div>
            {viewUser.cards && <div className="mt-3"><p className="text-xs font-semibold mb-1">Cards: {viewUser.cards.length}</p>{viewUser.cards.map(c => <span key={c._id} className="badge badge-info text-xs mr-1">{c.cardType} ••••{c.cardNumber?.slice(-4)} {c.status}</span>)}</div>}
            <button onClick={() => setViewUser(null)} className="btn-secondary w-full mt-4 text-sm">Close</button>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// KYC MANAGEMENT
function KycPanel() {
  const [kycs, setKYCs] = useState([]);
  useEffect(() => { API.get('/admin/kyc/pending').then(r => setKYCs(r.data.data.kycs)).catch(() => {}); }, []);
  const approve = async (id) => { try { await API.post(`/admin/kyc/approve/${id}`, { remarks: 'Approved' }); toast.success('KYC Approved'); setKYCs(p => p.filter(k => k._id !== id)); } catch { toast.error('Failed'); } };
  const reject = async (id) => { const reason = prompt('Rejection reason:'); if (!reason) return; try { await API.post(`/admin/kyc/reject/${id}`, { reason }); toast.success('KYC Rejected'); setKYCs(p => p.filter(k => k._id !== id)); } catch { toast.error('Failed'); } };

  return (
    <div className="card"><h3 className="font-bold text-lg mb-4">Pending KYC</h3>
      {kycs.length === 0 ? <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>No pending KYC 🎉</p> : kycs.map(k => (
        <div key={k._id} className="flex items-center justify-between p-3 rounded-xl mb-2" style={{ background: 'var(--bg-secondary)' }}>
          <div><p className="font-semibold text-sm">{k.userId?.firstName} {k.userId?.lastName}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.userId?.email} | Docs: {k.documents?.map(d => d.type).join(', ') || 'None'}</p></div>
          <div className="flex gap-2"><button onClick={() => approve(k._id)} className="btn-primary text-xs py-1.5 px-3"><FiCheck size={14} /></button><button onClick={() => reject(k._id)} className="btn-danger text-xs py-1.5 px-3"><FiX size={14} /></button></div>
        </div>
      ))}
    </div>
  );
}

// ALL TRANSACTIONS
function TxPanel() {
  const [txs, setTxs] = useState([]);
  const [page, setPage] = useState(1);
  const fetch = (p = 1) => { setPage(p); API.get(`/admin/transactions?page=${p}&limit=30`).then(r => setTxs(r.data.data.transactions)).catch(() => {}); };
  useEffect(fetch, []);
  return (
    <div className="card overflow-hidden p-0"><div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr style={{ background: 'var(--bg-secondary)' }}><th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>TXN ID</th><th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>From</th><th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>To</th><th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Amount</th><th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Type</th><th className="text-left p-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>Status</th></tr></thead>
        <tbody>{txs.map(t => <tr key={t._id} className="border-t" style={{ borderColor: 'var(--border)' }}><td className="p-3 font-mono text-xs">{t.transactionId?.slice(0, 14)}...</td><td className="p-3 font-mono text-xs">{t.fromAccount?.slice(0, 10)}</td><td className="p-3 font-mono text-xs">{t.toAccount?.slice(0, 10)}</td><td className="p-3 font-semibold">₹{t.amount?.toLocaleString()}</td><td className="p-3"><span className="badge badge-primary text-xs">{t.channel}</span></td><td className="p-3"><Badge type={t.status} /></td></tr>)}</tbody>
      </table>
    </div></div>
  );
}

// FRAUD MONITOR
function FraudPanel() {
  const [data, setData] = useState(null);
  useEffect(() => { API.get('/admin/fraud').then(r => setData(r.data.data)).catch(() => {}); }, []);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={FiDollarSign} label="High Value" value={data?.summary?.highValueCount || 0} color="#e53e3e" />
        <Stat icon={FiAlertTriangle} label="Failed TX" value={data?.summary?.failedCount || 0} color="#ecc94b" />
        <Stat icon={FiUsers} label="Suspicious" value={data?.summary?.suspiciousCount || 0} color="#764ba2" />
        <Stat icon={FiShield} label="Anomalies" value={data?.summary?.anomalyCount || 0} color="#4299e1" />
      </div>
      <div className="card"><h3 className="font-bold mb-3">Suspicious Accounts</h3>
        {data?.suspiciousAccounts?.length > 0 ? data.suspiciousAccounts.map((s, i) => <div key={i} className="flex justify-between p-3 rounded-xl mb-1" style={{ background: 'var(--bg-secondary)' }}><span className="font-mono text-sm">{s._id}</span><span className="text-sm">{s.count} txns | ₹{s.totalAmount?.toLocaleString()}</span></div>) : <p className="text-center py-4" style={{ color: 'var(--text-muted)' }}>All clear</p>}
      </div>
    </div>
  );
}

// AUDIT LOGS
function LogsPanel() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { API.get('/admin/logs?limit=40').then(r => setLogs(r.data.data.logs)).catch(() => {}); }, []);
  const sc = { INFO: 'badge-info', WARN: 'badge-warning', ERROR: 'badge-danger', CRITICAL: 'badge-danger' };
  return (
    <div className="card"><h3 className="font-bold text-lg mb-3">Audit Logs</h3>
      <div className="space-y-1">{logs.map(l => <div key={l._id} className="flex items-start gap-2 p-2 rounded-lg text-sm" style={{ background: 'var(--bg-secondary)' }}><span className={`badge text-xs ${sc[l.severity]}`}>{l.severity}</span><div className="flex-1 min-w-0"><p className="font-medium text-xs">{l.action}</p><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{l.userId?.firstName || 'System'} • {l.category} • {new Date(l.createdAt).toLocaleString()}</p></div><span className="badge badge-primary text-xs">{l.category}</span></div>)}</div>
    </div>
  );
}

// BROADCAST
function BroadcastPanel() {
  const [form, setForm] = useState({ title: '', message: '', type: 'SYSTEM', priority: 'MEDIUM' });
  const send = async (e) => { e.preventDefault(); try { const { data } = await API.post('/admin/broadcast', form); toast.success(`Sent to ${data.message}`); setForm({ title: '', message: '', type: 'SYSTEM', priority: 'MEDIUM' }); } catch { toast.error('Failed'); } };
  return (
    <div className="card max-w-lg"><h3 className="font-bold text-lg mb-4">📢 Broadcast Notification</h3>
      <form onSubmit={send} className="space-y-3">
        <input className="input" placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required />
        <textarea className="input" rows={3} placeholder="Message" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} required />
        <div className="grid grid-cols-2 gap-3">
          <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="SYSTEM">System</option><option value="PROMOTION">Promotion</option><option value="SECURITY">Security</option></select>
          <select className="input" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select>
        </div>
        <button type="submit" className="btn-primary w-full">Send to All Users</button>
      </form>
    </div>
  );
}

// MAIN ADMIN
export default function Admin() {
  const [tab, setTab] = useState('overview');
  const [analytics, setAnalytics] = useState(null);
  useEffect(() => { API.get('/admin/analytics').then(r => setAnalytics(r.data.data)).catch(() => {}); }, []);

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'kyc', label: 'KYC', icon: '📋' },
    { id: 'transactions', label: 'Transactions', icon: '💳' },
    { id: 'fraud', label: 'Fraud Monitor', icon: '🛡️' },
    { id: 'logs', label: 'Logs', icon: '📝' },
    { id: 'broadcast', label: 'Broadcast', icon: '📢' },
  ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <h1 className="text-xl font-bold">🛡️ Admin Portal</h1>

      <div className="flex gap-2 overflow-x-auto pb-2">{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={`tab whitespace-nowrap ${tab === t.id ? 'active' : ''}`}>{t.icon} {t.label}</button>)}</div>

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={FiUsers} label="Total Users" value={analytics?.users?.total || 0} color="#667eea" />
            <Stat icon={FiDollarSign} label="Total Volume" value={`₹${((analytics?.transactions?.totalVolume || 0) / 100000).toFixed(1)}L`} color="#48bb78" />
            <Stat icon={FiShield} label="Today TX" value={analytics?.transactions?.today || 0} color="#ecc94b" />
            <Stat icon={FiAlertTriangle} label="Frozen" value={analytics?.users?.frozen || 0} color="#e53e3e" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card"><h3 className="font-bold mb-2">Users</h3><div className="space-y-1 text-sm"><div className="flex justify-between"><span>Total</span><span className="font-bold">{analytics?.users?.total || 0}</span></div><div className="flex justify-between"><span>Active</span><span className="font-bold text-green-500">{analytics?.users?.active || 0}</span></div><div className="flex justify-between"><span>Frozen</span><span className="font-bold text-red-500">{analytics?.users?.frozen || 0}</span></div></div></div>
            <div className="card"><h3 className="font-bold mb-2">Transactions</h3><div className="space-y-1 text-sm"><div className="flex justify-between"><span>Total</span><span className="font-bold">{analytics?.transactions?.total || 0}</span></div><div className="flex justify-between"><span>Volume</span><span className="font-bold">₹{(analytics?.transactions?.totalVolume || 0).toLocaleString()}</span></div><div className="flex justify-between"><span>Active Loans</span><span className="font-bold">{analytics?.loans?.active || 0}</span></div></div></div>
            <div className="card"><h3 className="font-bold mb-2">Quick Actions</h3><div className="space-y-2"><button onClick={() => setTab('users')} className="btn-secondary text-sm w-full">👥 Manage Users</button><button onClick={() => setTab('kyc')} className="btn-secondary text-sm w-full">📋 Review KYC</button><button onClick={() => setTab('fraud')} className="btn-secondary text-sm w-full">🛡️ Fraud Monitor</button></div></div>
          </div>
        </div>
      )}
      {tab === 'users' && <UsersPanel />}
      {tab === 'kyc' && <KycPanel />}
      {tab === 'transactions' && <TxPanel />}
      {tab === 'fraud' && <FraudPanel />}
      {tab === 'logs' && <LogsPanel />}
      {tab === 'broadcast' && <BroadcastPanel />}
    </div>
  );
}
