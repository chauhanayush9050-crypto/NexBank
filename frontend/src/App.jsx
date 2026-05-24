import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { FiMenu, FiBell, FiSun, FiMoon, FiLogOut, FiSettings, FiX, FiHome, FiUsers, FiShield, FiCreditCard, FiDollarSign, FiBarChart2, FiFileText, FiMessageSquare, FiArrowLeft } from 'react-icons/fi';
import { motion } from 'framer-motion';
import { toggleTheme, fetchNotifications, logout as logoutAction, restoreAuthSession } from './store';
import { fetchSummary } from './store';

const Auth = lazy(() => import('./pages/Auth'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Admin = lazy(() => import('./pages/Admin'));

const Loading = () => (
  <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg-primary)' }}>
    <div className="text-center"><div className="w-12 h-12 border-4 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}></div><p className="mt-4" style={{ color: 'var(--text-secondary)' }}>Loading NexBank...</p></div>
  </div>
);

// ============================================
// ROUTE GUARDS
// ============================================
const UserRoute = ({ children }) => {
  const { isAuthenticated, user } = useSelector(s => s.auth);
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (['ADMIN', 'SUPER_ADMIN'].includes(user?.role)) return <Navigate to="/admin" />;
  return children;
};

const AdminRoute = ({ children }) => {
  const { isAuthenticated, user } = useSelector(s => s.auth);
  if (!isAuthenticated) return <Navigate to="/admin/login" />;
  if (!['ADMIN', 'SUPER_ADMIN'].includes(user?.role)) return <Navigate to="/dashboard" />;
  return children;
};

// ============================================
// NOTIFICATION PANEL
// ============================================
const NotifPanel = ({ onClose, notifications }) => (
  <motion.div initial={{ opacity: 0, x: 300 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 300 }} className="fixed right-0 top-0 h-full w-80 md:w-96 z-50 shadow-2xl" style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border)' }}>
    <div className="p-4 flex justify-between" style={{ borderBottom: '1px solid var(--border)' }}><h3 className="font-bold">Notifications</h3><button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100"><FiX size={18} /></button></div>
    <div className="overflow-y-auto h-[calc(100%-60px)] p-3">
      {notifications.length === 0 ? <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}><FiBell size={32} className="mx-auto mb-2 opacity-30" /><p>No notifications</p></div>
        : notifications.map((n, i) => <div key={n._id || i} className={`p-3 rounded-xl mb-2 ${n.isRead ? '' : 'border-l-4'}`} style={{ background: n.isRead ? 'var(--bg-secondary)' : 'rgba(102,126,234,0.08)', borderLeftColor: 'var(--primary)' }}><p className="font-semibold text-sm">{n.title}</p><p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{n.message}</p></div>)}
    </div>
  </motion.div>
);

// ============================================
// USER SIDEBAR
// ============================================
const UserSidebar = ({ isOpen, onClose, user }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const links = [
    { path: '/dashboard', icon: <FiHome size={18} />, label: 'Dashboard' },
    { path: '/dashboard/transactions', icon: <FiFileText size={18} />, label: 'Transactions' },
    { path: '/dashboard/passbook', icon: <FiFileText size={18} />, label: 'Passbook' },
    { path: '/dashboard/statements', icon: <FiFileText size={18} />, label: 'Statements' },
    { path: '/dashboard/transfer', icon: <FiDollarSign size={18} />, label: 'Transfer' },
    { path: '/dashboard/upi', icon: <FiDollarSign size={18} />, label: 'UPI' },
    { path: '/dashboard/beneficiaries', icon: <FiUsers size={18} />, label: 'Beneficiaries' },
    { path: '/dashboard/cards', icon: <FiCreditCard size={18} />, label: 'Cards' },
    { path: '/dashboard/loans', icon: <FiDollarSign size={18} />, label: 'Loans' },
    { path: '/dashboard/deposits', icon: <FiBarChart2 size={18} />, label: 'Deposits' },
    { path: '/dashboard/bills', icon: <FiFileText size={18} />, label: 'Bill Pay' },
    { path: '/dashboard/kyc', icon: <FiShield size={18} />, label: 'KYC' },
    { path: '/dashboard/analytics', icon: <FiBarChart2 size={18} />, label: 'Analytics' },
    { path: '/dashboard/ai-assistant', icon: <FiMessageSquare size={18} />, label: 'AI Assistant' },
    { path: '/dashboard/settings', icon: <FiSettings size={18} />, label: 'Settings' },
  ];
  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="p-5">
          <div className="flex items-center gap-3 mb-6"><div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-white font-bold text-lg">N</div><div><h1 className="text-white font-bold text-lg">NexBank</h1><p className="text-white/40 text-xs">Personal Banking</p></div></div>
          <div className="p-3 rounded-xl glass mb-4"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full gradient-bg flex items-center justify-center text-white text-sm font-bold">{user?.firstName?.[0]}{user?.lastName?.[0]}</div><div className="min-w-0"><p className="text-white text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p><p className="text-white/40 text-xs truncate">{user?.email}</p></div></div></div>
        </div>
        <nav className="px-2 pb-6">
          <p className="text-white/30 text-xs font-semibold uppercase tracking-wider px-5 mb-2">Menu</p>
          {links.map(l => <button key={l.path} onClick={() => { navigate(l.path); onClose(); }} className={`sidebar-link w-full text-left ${location.pathname === l.path ? 'active' : ''}`}>{l.icon}<span>{l.label}</span></button>)}
        </nav>
      </aside>
    </>
  );
};

// ============================================
// ADMIN SIDEBAR — Red themed, completely separate
// ============================================
const AdminSidebar = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const links = [
    { path: '/admin', icon: <FiBarChart2 size={18} />, label: 'Overview', exact: true },
    { path: '/admin/users', icon: <FiUsers size={18} />, label: 'Users' },
    { path: '/admin/kyc', icon: <FiShield size={18} />, label: 'KYC' },
    { path: '/admin/transactions', icon: <FiFileText size={18} />, label: 'Transactions' },
    { path: '/admin/fraud', icon: <FiShield size={18} />, label: 'Fraud Monitor' },
    { path: '/admin/logs', icon: <FiFileText size={18} />, label: 'Audit Logs' },
    { path: '/admin/broadcast', icon: <FiMessageSquare size={18} />, label: 'Broadcast' },
  ];
  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`} style={{ background: '#1a0a0a' }}>
        <div className="p-5">
          <div className="flex items-center gap-3 mb-6"><div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg" style={{ background: '#c53030' }}>🛡️</div><div><h1 className="text-white font-bold text-lg">NexBank</h1><p className="text-red-400 text-xs font-semibold">Admin Portal</p></div></div>
        </div>
        <nav className="px-2 pb-6">
          <p className="text-white/30 text-xs font-semibold uppercase tracking-wider px-5 mb-2">Admin</p>
          {links.map(l => <button key={l.path} onClick={() => { navigate(l.path); onClose(); }} className={`sidebar-link w-full text-left ${location.pathname === l.path ? 'active' : ''}`}>{l.icon}<span>{l.label}</span></button>)}
          <p className="text-white/30 text-xs font-semibold uppercase tracking-wider px-5 mt-4 mb-2">Navigation</p>
          <button onClick={() => { navigate('/dashboard'); onClose(); }} className="sidebar-link w-full text-left"><FiArrowLeft size={18} /><span>Back to User View</span></button>
        </nav>
      </aside>
    </>
  );
};

// ============================================
// NAVBAR — Shows different branding for admin vs user
// ============================================
const Navbar = ({ onMenuClick, user, isAdmin }) => {
  const dispatch = useDispatch();
  const { mode } = useSelector(s => s.theme);
  const { unreadCount, notifications } = useSelector(s => s.notifications);
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    dispatch(logoutAction());
    navigate(isAdmin ? '/admin/login' : '/login');
    setShowProfile(false);
  };

  return (
    <>
      <header className="sticky top-0 z-20" style={{ background: isAdmin ? '#2d0a0a' : 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div className="flex items-center gap-3">
            <button onClick={onMenuClick} className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><FiMenu size={20} /></button>
            <h2 className="hidden md:block font-semibold text-sm" style={{ color: isAdmin ? '#fc8181' : 'var(--text-secondary)' }}>{isAdmin ? '🛡️ Admin Portal' : '🏦 NexBank'}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => dispatch(toggleTheme())} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" style={{ color: 'var(--text-secondary)' }}>{mode === 'light' ? <FiMoon size={18} /> : <FiSun size={18} />}</button>
            <button onClick={() => setShowNotif(true)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 relative" style={{ color: 'var(--text-secondary)' }}><FiBell size={18} />{unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">{unreadCount}</span>}</button>
            <div className="relative">
              <button onClick={() => setShowProfile(!showProfile)} className="flex items-center gap-2 p-1.5 pr-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold ${isAdmin ? '' : 'gradient-bg'}`} style={isAdmin ? { background: '#c53030' } : {}}>{user?.firstName?.[0]}{user?.lastName?.[0]}</div>
                <span className="hidden sm:block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{user?.firstName}</span>
              </button>
              {showProfile && (
                <div className="absolute right-0 top-12 w-52 rounded-xl shadow-xl p-2 z-50" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <div className="px-4 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Role: <span className="font-bold">{user?.role}</span></div>
                  <hr style={{ borderColor: 'var(--border)' }} />
                  <button onClick={handleLogout} className="flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-sm text-red-500 w-full"><FiLogOut size={16} /> Logout</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  );
};

// ============================================
// MAIN APP
// ============================================
export default function App() {
  const dispatch = useDispatch();
  const { isAuthenticated, user, accessToken, restoringSession } = useSelector(s => s.auth);
  const { mode } = useSelector(s => s.theme);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const [restoreAttempted, setRestoreAttempted] = useState(false);

  useEffect(() => { document.documentElement.setAttribute('data-theme', mode); }, [mode]);
  useEffect(() => {
    if (!restoreAttempted && (accessToken || localStorage.getItem('refreshToken'))) {
      setRestoreAttempted(true);
      dispatch(restoreAuthSession());
    }
  }, [accessToken, dispatch, restoreAttempted]);
  useEffect(() => { if (isAuthenticated) { dispatch(fetchNotifications()); } }, [isAuthenticated, dispatch]);
  useEffect(() => { if (isAuthenticated && user?.role === 'USER') { dispatch(fetchSummary()); } }, [isAuthenticated, user?.role, dispatch]);
  useEffect(() => { setSidebarOpen(false); }, [location]);

  const isAdmin = location.pathname.startsWith('/admin');

  if (restoringSession) {
    return <Loading />;
  }

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* ---- USER AUTH ---- */}
        <Route path="/login" element={isAuthenticated && user?.role === 'USER' ? <Navigate to="/dashboard" /> : isAuthenticated && ['ADMIN','SUPER_ADMIN'].includes(user?.role) ? <Navigate to="/admin" /> : <Auth />} />
        <Route path="/signup" element={isAuthenticated ? <Navigate to="/dashboard" /> : <Auth />} />
        <Route path="/forgot-password" element={<Auth />} />

        {/* ---- ADMIN AUTH (NO SIGNUP — PRE-CREATED ONLY) ---- */}
        <Route path="/admin/login" element={isAuthenticated && ['ADMIN','SUPER_ADMIN'].includes(user?.role) ? <Navigate to="/admin" /> : <Auth isAdmin />} />
        {/* Legacy redirect */}
        <Route path="/admin-login" element={<Navigate to="/admin/login" replace />} />

        {/* ---- USER DASHBOARD ---- */}
        <Route path="/dashboard/*" element={
          <UserRoute>
            <div className="flex min-h-screen">
              <UserSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} user={user} />
              <div className="flex-1 main-content">
                <Navbar onMenuClick={() => setSidebarOpen(true)} user={user} isAdmin={false} />
                <main className="p-4 md:p-6" style={{ background: 'var(--bg-secondary)', minHeight: 'calc(100vh - 57px)' }}><Dashboard /></main>
              </div>
            </div>
          </UserRoute>
        } />

        {/* ---- ADMIN PORTAL ---- */}
        <Route path="/admin/*" element={
          <AdminRoute>
            <div className="flex min-h-screen">
              <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
              <div className="flex-1 main-content">
                <Navbar onMenuClick={() => setSidebarOpen(true)} user={user} isAdmin={true} />
                <main className="p-4 md:p-6" style={{ background: '#0f0a0a', minHeight: 'calc(100vh - 57px)' }}><Admin /></main>
              </div>
            </div>
          </AdminRoute>
        } />

        {/* ---- DEFAULT ---- */}
        <Route path="/" element={<Navigate to={isAuthenticated ? (['ADMIN','SUPER_ADMIN'].includes(user?.role) ? '/admin' : '/dashboard') : '/login'} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Suspense>
  );
}
