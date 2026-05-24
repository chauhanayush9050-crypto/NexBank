import axios from 'axios';

const LIVE_API_URL = 'https://nexbank-wcf0.onrender.com/api';
const isProduction = import.meta.env.PROD;

const resolveBaseUrl = () => {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return isProduction ? LIVE_API_URL : '/api';
};

const clearStoredAuth = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
};

export const API_BASE_URL = resolveBaseUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

let isRefreshing = false;
let refreshPromise = null;

const refreshAccessToken = async () => {
  if (isRefreshing && refreshPromise) return refreshPromise;

  isRefreshing = true;
  refreshPromise = api
    .post('/auth/refresh-token')
    .then(({ data }) => {
      const accessToken = data?.data?.accessToken;
      const refreshToken = data?.data?.refreshToken;

      if (!accessToken) {
        throw new Error('Missing refreshed access token');
      }

      localStorage.setItem('accessToken', accessToken);
      if (refreshToken) {
        localStorage.setItem('refreshToken', refreshToken);
      }

      return accessToken;
    })
    .catch((error) => {
      clearStoredAuth();
      throw error;
    })
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });

  return refreshPromise;
};

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/admin-login') &&
      !originalRequest.url?.includes('/auth/refresh-token')
    ) {
      originalRequest._retry = true;

      try {
        const token = await refreshAccessToken();
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      } catch (refreshError) {
        if (window.location.pathname.startsWith('/admin')) {
          window.location.href = '/admin/login';
        } else {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export const hydrateStoredAuth = () => {
  try {
    return {
      accessToken: localStorage.getItem('accessToken'),
      user: JSON.parse(localStorage.getItem('user') || 'null'),
    };
  } catch {
    clearStoredAuth();
    return { accessToken: null, user: null };
  }
};

export const restoreSession = async () => {
  try {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
      await refreshAccessToken();
    }

    const { data } = await api.get('/auth/profile');
    const user = data?.data?.user || null;

    if (!user) {
      throw new Error('Profile data missing during session restore');
    }

    localStorage.setItem('user', JSON.stringify(user));
    return {
      user,
      accessToken: localStorage.getItem('accessToken'),
    };
  } catch (error) {
    clearStoredAuth();
    throw error;
  }
};

export const clearAuthStorage = clearStoredAuth;
