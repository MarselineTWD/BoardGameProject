import { useEffect, useState } from 'react';
import { profileService } from '../api/profile.service';
import { UserProfile } from '../model/types';

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    profileService
      .get()
      .then((data) => {
        if (!active) {
          return;
        }

        setProfile(data);
        setError(null);
      })
      .catch((currentError: unknown) => {
        if (!active) {
          return;
        }

        setError(
          currentError instanceof Error
            ? currentError.message
            : 'Не удалось загрузить профиль',
        );
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const saveProfile = async (payload: Partial<UserProfile>) => {
    setSaving(true);
    setError(null);

    try {
      const updated = await profileService.update(payload);
      setProfile(updated);
      return updated;
    } catch (currentError: unknown) {
      const message =
        currentError instanceof Error
          ? currentError.message
          : 'Не удалось сохранить профиль';
      setError(message);
      throw currentError;
    } finally {
      setSaving(false);
    }
  };

  return {
    profile,
    loading,
    error,
    saving,
    saveProfile,
  };
}
