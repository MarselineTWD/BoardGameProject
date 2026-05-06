import { localRequest } from '../../../shared/api/http';
import { Review, ReviewPayload } from '../model/types';

export const reviewsService = {
  list() {
    return localRequest<Review[]>('/reviews?_sort=playedAt&_order=desc');
  },
  listLobby() {
    return localRequest<Review[]>('/lobby/reviews');
  },
  create(payload: ReviewPayload) {
    return localRequest<Review>('/reviews', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  createForLobby(
    payload: Pick<
      ReviewPayload,
      'title' | 'rating' | 'sessionMood' | 'notes' | 'wouldReplay' | 'playedAt'
    >,
  ) {
    return localRequest<Review>('/lobby/reviews', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  update(id: number, payload: ReviewPayload) {
    return localRequest<Review>(`/reviews/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ id, ...payload }),
    });
  },
  remove(id: number) {
    return localRequest<void>(`/reviews/${id}`, {
      method: 'DELETE',
    });
  },
};
