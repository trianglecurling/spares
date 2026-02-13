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
    if (error.response?.status === 503 && error.response?.data?.requiresInstallation) {
      const currentPath = window.location.pathname;
      if (!currentPath.startsWith('/install')) {
        window.location.href = '/install';
      }
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

export const formatApiError = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const serverError = error.response?.data?.error;
    if (typeof serverError === 'string' && serverError.trim().length > 0) {
      return `${fallback}: ${serverError}`;
    }
    const status = error.response?.status;
    if (status) {
      return `${fallback} (status ${status}). Please try again.`;
    }
  }

  if (error instanceof Error && error.message) {
    return `${fallback}: ${error.message}`;
  }

  return fallback;
};

export default api;
