import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Don't redirect on 503 (database not configured) - let the app handle it
    if (error.response?.status === 503 && error.response?.data?.requiresInstallation) {
      // Don't redirect, just reject so the calling code can handle it
      return Promise.reject(error);
    }
    
    if (error.response?.status === 401) {
      // Only redirect to login if we're not already on install/login pages
      const currentPath = window.location.pathname;
      if (!currentPath.startsWith('/install') && currentPath !== '/login') {
        localStorage.removeItem('authToken');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

