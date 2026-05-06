import { useCallback, useEffect, useMemo, useState } from 'react';
import { reviewsService } from '../api/reviews.service';
import { Review, ReviewPayload } from '../model/types';

function sortReviews(reviews: Review[]) {
  return [...reviews].sort((left, right) =>
    right.playedAt.localeCompare(left.playedAt),
  );
}

function useReviewCollection(
  load: () => Promise<Review[]>,
  create: (payload: ReviewPayload) => Promise<Review>,
) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await load();
      setReviews(sortReviews(data));
      setError(null);
    } catch (currentError: unknown) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : 'Не удалось загрузить записи',
      );
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveReview = async (payload: ReviewPayload, reviewId?: number) => {
    setSaving(true);
    setError(null);

    try {
      const saved = reviewId
        ? await reviewsService.update(reviewId, payload)
        : await create(payload);

      setReviews((current) => {
        const next = reviewId
          ? current.map((review) => (review.id === saved.id ? saved : review))
          : [saved, ...current];

        return sortReviews(next);
      });

      return saved;
    } catch (currentError: unknown) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : 'Не удалось сохранить запись',
      );
      throw currentError;
    } finally {
      setSaving(false);
    }
  };

  const deleteReview = async (reviewId: number) => {
    setSaving(true);
    setError(null);

    try {
      await reviewsService.remove(reviewId);
      setReviews((current) =>
        current.filter((review) => review.id !== reviewId),
      );
    } catch (currentError: unknown) {
      setError(
        currentError instanceof Error
          ? currentError.message
          : 'Не удалось удалить запись',
      );
      throw currentError;
    } finally {
      setSaving(false);
    }
  };

  const averageRating = useMemo(() => {
    if (!reviews.length) {
      return 0;
    }

    return (
      reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    );
  }, [reviews]);

  return {
    reviews,
    loading,
    error,
    saving,
    averageRating,
    reload,
    saveReview,
    deleteReview,
  };
}

export function useReviews() {
  return useReviewCollection(reviewsService.list, reviewsService.create);
}

export function useLobbyReviews() {
  return useReviewCollection(
    reviewsService.listLobby,
    reviewsService.createForLobby,
  );
}
