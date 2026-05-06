import { useCallback, useEffect, useState } from 'react';
import { authService } from '../api/auth.service';
import { AuthUser, LoginPayload, RegisterPayload } from '../model/types';
import {
  clearAuthToken,
  getAuthToken,
  setAuthToken,
} from '../../../shared/api/http';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(() => Boolean(getAuthToken()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getAuthToken()) {
      setUser(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const currentUser = await authService.me();
      setUser(currentUser);
      setError(null);
    } catch (requestError) {
      clearAuthToken();
      setUser(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось получить пользователя',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener('meeple-scope-auth', refresh);
    window.addEventListener('storage', refresh);

    return () => {
      window.removeEventListener('meeple-scope-auth', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  const login = async (payload: LoginPayload) => {
    setSaving(true);
    try {
      const response = await authService.login(payload);
      setAuthToken(response.token);
      setUser(response.user);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось войти',
      );
    } finally {
      setSaving(false);
    }
  };

  const register = async (payload: RegisterPayload) => {
    setSaving(true);
    try {
      const response = await authService.register(payload);
      setAuthToken(response.token);
      setUser(response.user);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось зарегистрироваться',
      );
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    setSaving(true);
    try {
      await authService.logout();
      setUser(null);
      setError(null);
    } finally {
      setSaving(false);
    }
  };

  return {
    user,
    loading,
    saving,
    error,
    isAuthenticated: Boolean(user),
    login,
    register,
    logout,
    refresh,
  };
}
