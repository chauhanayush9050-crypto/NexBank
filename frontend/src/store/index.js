import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { api as API, hydrateStoredAuth, restoreSession, clearAuthStorage } from '../lib/api';

const storedAuth = hydrateStoredAuth();

// AUTH
const login = createAsyncThunk('auth/login', async (creds, { rejectWithValue }) => {
  try {
    const { data } = await API.post('/auth/login', creds);
    if (data.data?.tokens?.accessToken) {
      localStorage.setItem('accessToken', data.data.tokens.accessToken);
      localStorage.setItem('refreshToken', data.data.tokens.refreshToken || '');
      localStorage.setItem('user', JSON.stringify(data.data.user));
    }
    return data;
  } catch (e) {
    return rejectWithValue(e.response?.data?.message || 'Login failed');
  }
});

const signup = createAsyncThunk('auth/signup', async (userData, { rejectWithValue }) => {
  try {
    const { data } = await API.post('/auth/signup', userData);
    if (data.data?.tokens?.accessToken) {
      localStorage.setItem('accessToken', data.data.tokens.accessToken);
      localStorage.setItem('refreshToken', data.data.tokens.refreshToken || '');
      localStorage.setItem('user', JSON.stringify(data.data.user));
    }
    return data;
  } catch (e) {
    const backendError = e.response?.data;
    return rejectWithValue(backendError?.errors?.[0] || backendError?.message || 'Signup failed');
  }
});

const restoreAuthSession = createAsyncThunk('auth/restoreSession', async (_, { rejectWithValue }) => {
  try {
    return await restoreSession();
  } catch (error) {
    return rejectWithValue(error?.response?.data?.message || error?.message || 'Session restore failed');
  }
});

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: storedAuth.user,
    accessToken: storedAuth.accessToken,
    isAuthenticated: !!storedAuth.accessToken && !!storedAuth.user,
    loading: false,
    error: null,
    signupData: null,
    restoringSession: false,
  },
  reducers: {
    logout: (state) => {
      state.user = null;
      state.accessToken = null;
      state.isAuthenticated = false;
      state.signupData = null;
      state.restoringSession = false;
      clearAuthStorage();
      localStorage.removeItem('refreshToken');
    },
    setUser: (state, action) => { state.user = action.payload; state.isAuthenticated = true; },
    clearError: (state) => { state.error = null; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (s) => { s.loading = true; s.error = null; })
      .addCase(login.fulfilled, (s, a) => {
        s.loading = false;
        s.isAuthenticated = true;
        s.user = a.payload.data?.user;
        s.accessToken = a.payload.data?.tokens?.accessToken;
      })
      .addCase(login.rejected, (s, a) => { s.loading = false; s.error = a.payload; })
      .addCase(signup.pending, (s) => { s.loading = true; s.error = null; })
      .addCase(signup.fulfilled, (s, a) => {
        s.loading = false;
        s.isAuthenticated = true;
        s.user = a.payload.data?.user;
        s.accessToken = a.payload.data?.tokens?.accessToken;
        s.signupData = a.payload.data;
      })
      .addCase(signup.rejected, (s, a) => { s.loading = false; s.error = a.payload; })
      .addCase(restoreAuthSession.pending, (s) => {
        s.restoringSession = true;
      })
      .addCase(restoreAuthSession.fulfilled, (s, a) => {
        s.restoringSession = false;
        s.isAuthenticated = true;
        s.user = a.payload.user;
        s.accessToken = a.payload.accessToken;
      })
      .addCase(restoreAuthSession.rejected, (s) => {
        s.restoringSession = false;
        s.isAuthenticated = false;
        s.user = null;
        s.accessToken = null;
      });
  },
});

// ACCOUNT
const fetchSummary = createAsyncThunk('account/fetchSummary', async (_, { rejectWithValue }) => {
  try { const { data } = await API.get('/account/summary'); return data.data; }
  catch (e) { return rejectWithValue(e.response?.data?.message || 'Failed'); }
});

const accountSlice = createSlice({
  name: 'account',
  initialState: { account: null, balance: 0, availableBalance: 0, recentTransactions: [], cards: [], loans: [], fixedDeposits: [], recurringDeposits: [], spendingByCategory: [], monthlyTrend: [], summary: {}, loading: false, error: null },
  reducers: { clearAccountError: (s) => { s.error = null; } },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSummary.pending, (s) => { s.loading = true; })
      .addCase(fetchSummary.fulfilled, (s, a) => { s.loading = false; Object.assign(s, a.payload); })
      .addCase(fetchSummary.rejected, (s, a) => { s.loading = false; s.error = a.payload; })
  },
});

// TRANSACTIONS
const fetchTransactions = createAsyncThunk('tx/fetch', async (params = {}, { rejectWithValue }) => {
  try {
    const q = new URLSearchParams(params).toString();
    const { data } = await API.get(`/transaction/history${q ? `?${q}` : ''}`);
    return data.data;
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Failed'); }
});

const makeTransfer = createAsyncThunk('tx/transfer', async (d, { rejectWithValue }) => {
  try { const { data } = await API.post('/transaction/transfer', d); return data; }
  catch (e) { return rejectWithValue(e.response?.data?.message || 'Transfer failed'); }
});

const makeDeposit = createAsyncThunk('tx/deposit', async (d, { rejectWithValue }) => {
  try { const { data } = await API.post('/transaction/deposit', d); return data; }
  catch (e) { return rejectWithValue(e.response?.data?.message || 'Deposit failed'); }
});

const makeWithdrawal = createAsyncThunk('tx/withdraw', async (d, { rejectWithValue }) => {
  try { const { data } = await API.post('/transaction/withdraw', d); return data; }
  catch (e) { return rejectWithValue(e.response?.data?.message || 'Withdrawal failed'); }
});

const txSlice = createSlice({
  name: 'tx',
  initialState: { transactions: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 }, loading: false, transferLoading: false, error: null, lastTransfer: null },
  reducers: { clearTxError: (s) => { s.error = null; } },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTransactions.pending, (s) => { s.loading = true; })
      .addCase(fetchTransactions.fulfilled, (s, a) => { s.loading = false; s.transactions = a.payload.transactions; s.pagination = a.payload.pagination; })
      .addCase(fetchTransactions.rejected, (s, a) => { s.loading = false; s.error = a.payload; })
      .addCase(makeTransfer.pending, (s) => { s.transferLoading = true; })
      .addCase(makeTransfer.fulfilled, (s, a) => { s.transferLoading = false; s.lastTransfer = a.payload.data; })
      .addCase(makeTransfer.rejected, (s, a) => { s.transferLoading = false; s.error = a.payload; })
      .addCase(makeDeposit.fulfilled, (s, a) => { s.lastTransfer = a.payload.data; })
      .addCase(makeWithdrawal.fulfilled, (s, a) => { s.lastTransfer = a.payload.data; });
  },
});

// NOTIFICATIONS
const fetchNotifications = createAsyncThunk('notif/fetch', async (_, { rejectWithValue }) => {
  try { const { data } = await API.get('/notifications'); return data.data; } catch { return rejectWithValue('Failed'); }
});

const notifSlice = createSlice({
  name: 'notif',
  initialState: { notifications: [], unreadCount: 0, loading: false },
  reducers: {
    addNotification: (s, a) => { s.notifications.unshift(a.payload); s.unreadCount += 1; },
    setUnreadCount: (s, a) => { s.unreadCount = a.payload; },
  },
  extraReducers: (builder) => { builder.addCase(fetchNotifications.fulfilled, (s, a) => { s.notifications = a.payload.notifications; }); },
});

// THEME
const themeSlice = createSlice({
  name: 'theme',
  initialState: { mode: localStorage.getItem('theme') || 'light' },
  reducers: {
    toggleTheme: (s) => { s.mode = s.mode === 'light' ? 'dark' : 'light'; localStorage.setItem('theme', s.mode); document.documentElement.setAttribute('data-theme', s.mode); },
  },
});

// EXPORTS
export const { logout, setUser, clearError } = authSlice.actions;
export const { clearAccountError } = accountSlice.actions;
export const { clearTxError } = txSlice.actions;
export const { addNotification, setUnreadCount } = notifSlice.actions;
export const { toggleTheme } = themeSlice.actions;

export { login, signup, restoreAuthSession, fetchSummary, fetchTransactions, makeTransfer, makeDeposit, makeWithdrawal, fetchNotifications };

export const store = configureStore({
  reducer: { auth: authSlice.reducer, account: accountSlice.reducer, transactions: txSlice.reducer, notifications: notifSlice.reducer, theme: themeSlice.reducer },
  middleware: (gDM) => gDM({ serializableCheck: false }),
});

export default store;
