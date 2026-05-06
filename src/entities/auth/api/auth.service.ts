import { clearAuthToken, localRequest } from '../../../shared/api/http';
import {
  AuthResponse,
  AuthUser,
  LoginPayload,
  RegisterPayload,
} from '../model/types';

export const authService = {
  login(payload: LoginPayload) {
    return localRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  register(payload: RegisterPayload) {
    return localRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  me() {
    return localRequest<AuthUser>('/auth/me');
  },
  async logout() {
    try {
      await localRequest<void>('/auth/logout', {
        method: 'POST',
      });
    } finally {
      clearAuthToken();
    }
  },
};
