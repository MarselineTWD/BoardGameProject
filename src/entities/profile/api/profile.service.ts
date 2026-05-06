import { localRequest } from '../../../shared/api/http';
import { UserProfile } from '../model/types';

export const profileService = {
  get() {
    return localRequest<UserProfile>('/profile/me');
  },
  update(payload: Partial<UserProfile>) {
    return localRequest<UserProfile>('/profile/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};
