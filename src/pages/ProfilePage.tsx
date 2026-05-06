import { FormEvent, useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import styles from './page.module.css';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { useProfile } from '../entities/profile/hooks/useProfile';
import { UserProfile } from '../entities/profile/model/types';
import { rpgService } from '../entities/rpg/api/rpg.service';
import {
  GameSessionListItem,
  GameSessionResponse,
} from '../entities/rpg/model/types';
import { Button } from '../shared/ui/Button';
import { Field } from '../shared/ui/Field';
import { Panel } from '../shared/ui/Panel';
import { StatusBox } from '../shared/ui/StatusBox';

interface ProfileFormState {
  name: string;
  city: string;
  experienceLevel: UserProfile['experienceLevel'];
  preferredPlayers: number;
  maxPlayTime: number;
  bio: string;
  favoriteGenres: string;
}

const statusLabels: Record<string, string> = {
  draft: 'Лобби готовится',
  active: 'Игра идёт',
  finished: 'Игра завершена',
};

export function ProfilePage() {
  const auth = useAuth();
  const profileResource = useProfile();
  const [rpgSessions, setRpgSessions] = useState<GameSessionListItem[]>([]);
  const [rpgSessionDetails, setRpgSessionDetails] = useState<
    Record<string, GameSessionResponse>
  >({});
  const [rpgSessionsLoading, setRpgSessionsLoading] = useState(false);
  const [rpgSessionsError, setRpgSessionsError] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    name: '',
    city: '',
    experienceLevel: 'intermediate',
    preferredPlayers: 4,
    maxPlayTime: 120,
    bio: '',
    favoriteGenres: '',
  });

  useEffect(() => {
    if (!profileResource.profile) {
      return;
    }

    setProfileForm({
      ...profileResource.profile,
      favoriteGenres: profileResource.profile.favoriteGenres.join(', '),
    });
  }, [profileResource.profile]);

  useEffect(() => {
    if (!auth.user) {
      setRpgSessions([]);
      return;
    }

    setRpgSessionsLoading(true);
    setRpgSessionsError(null);
    rpgService
      .listSessions(String(auth.user.id))
      .then(async (sessions) => {
        setRpgSessions(sessions);
        const details = await Promise.allSettled(
          sessions.map((session) =>
            rpgService.getSession(session.id, String(auth.user!.id)),
          ),
        );
        setRpgSessionDetails(
          details.reduce<Record<string, GameSessionResponse>>(
            (accumulator, result, index) => {
              if (result.status === 'fulfilled') {
                accumulator[sessions[index].id] = result.value;
              }
              return accumulator;
            },
            {},
          ),
        );
      })
      .catch(() => {
        setRpgSessionsError(
          'Ведущий на мгновение замолчал. Попробуйте повторить действие.',
        );
      })
      .finally(() => setRpgSessionsLoading(false));
  }, [auth.user]);

  if (auth.loading || profileResource.loading) {
    return (
      <StatusBox
        kind="loading"
        title="Открываю профиль"
        description="Загружаю настройки аккаунта."
      />
    );
  }

  if (!auth.user) {
    return (
      <div className={styles.page}>
        <Panel
          title="Войдите, чтобы открыть профиль"
          description="После входа здесь можно изменить имя, город и игровые предпочтения."
        >
          <div className={styles.heroActions}>
            <Link to="/auth">
              <Button>Вход и регистрация</Button>
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  if (profileResource.error) {
    return (
      <StatusBox
        kind="error"
        title="Профиль временно недоступен"
        description="Попробуй обновить страницу или войти заново."
      />
    );
  }

  const handleProfileSubmit = async (event: FormEvent) => {
    event.preventDefault();

    await profileResource.saveProfile({
      ...profileForm,
      favoriteGenres: profileForm.favoriteGenres
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className={styles.page}>
      <Panel
        title="Профиль"
        description="Эти данные помогают быстрее подобрать игру под твой стиль."
      >
        <form className={styles.formGrid} onSubmit={handleProfileSubmit}>
          <Field label="Имя">
            <input
              value={profileForm.name}
              onChange={(event) =>
                setProfileForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Город">
            <input
              value={profileForm.city}
              onChange={(event) =>
                setProfileForm((current) => ({
                  ...current,
                  city: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Уровень">
            <select
              value={profileForm.experienceLevel}
              onChange={(event) =>
                setProfileForm((current) => ({
                  ...current,
                  experienceLevel: event.target.value as
                    | 'beginner'
                    | 'intermediate'
                    | 'advanced',
                }))
              }
            >
              <option value="beginner">Новичок</option>
              <option value="intermediate">Уверенный игрок</option>
              <option value="advanced">Продвинутый игрок</option>
            </select>
          </Field>
          <Field label="Любимое число игроков">
            <input
              type="number"
              min={1}
              max={8}
              value={profileForm.preferredPlayers}
              onChange={(event) =>
                setProfileForm((current) => ({
                  ...current,
                  preferredPlayers: Number(event.target.value),
                }))
              }
            />
          </Field>
          <Field label="Комфортная длительность">
            <input
              type="number"
              min={30}
              max={240}
              step={15}
              value={profileForm.maxPlayTime}
              onChange={(event) =>
                setProfileForm((current) => ({
                  ...current,
                  maxPlayTime: Number(event.target.value),
                }))
              }
            />
          </Field>
          <Field label="Любимые жанры" hint="через запятую">
            <input
              value={profileForm.favoriteGenres}
              onChange={(event) =>
                setProfileForm((current) => ({
                  ...current,
                  favoriteGenres: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="О себе">
            <textarea
              value={profileForm.bio}
              onChange={(event) =>
                setProfileForm((current) => ({
                  ...current,
                  bio: event.target.value,
                }))
              }
            />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" disabled={profileResource.saving}>
              {profileResource.saving ? 'Сохраняю...' : 'Сохранить профиль'}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel
        title="История игр"
        description="Все ваши ролевые лобби, начатые партии и завершённые истории."
      >
        {rpgSessionsLoading ? (
          <p className={styles.muted}>Загружаю сохранённые кампании...</p>
        ) : null}
        {rpgSessionsError ? (
          <p className={styles.muted}>{rpgSessionsError}</p>
        ) : null}
        {!rpgSessionsLoading && !rpgSessions.length ? (
          <p className={styles.muted}>
            Пока нет сохранённых игр. Создайте первое лобби на странице НРИ.
          </p>
        ) : null}
        <div className={styles.list}>
          {rpgSessions.map((session) => {
            const detail = rpgSessionDetails[session.id];
            const knownLocations =
              detail?.map?.locations.filter(
                (location) => location.visible_to_players !== false,
              ) ?? [];

            return (
              <article key={session.id} className={styles.reviewCard}>
                <div>
                  <h3 className={styles.gameTitle}>{session.title}</h3>
                  <p className={styles.muted}>
                    {session.genre} / {session.tone}
                  </p>
                </div>
                <p>{session.current_scene || session.theme}</p>
                <div className={styles.statsRow}>
                  <span>{statusLabels[session.status] ?? session.status}</span>
                  <span>
                    Обновлено:{' '}
                    {new Date(session.updated_at).toLocaleDateString('ru-RU')}
                  </span>
                </div>
                <div className={styles.historyGrid}>
                  <div>
                    <strong>Персонажи</strong>
                    <p>
                      {detail?.characters.length
                        ? detail.characters
                            .map((character) => {
                              const location = knownLocations.find(
                                (item) => item.id === character.location_id,
                              );
                              return `${character.name}${
                                location ? ` — ${location.name}` : ''
                              }`;
                            })
                            .join(', ')
                        : session.character_names.length
                          ? session.character_names.join(', ')
                          : 'Пока не созданы'}
                    </p>
                  </div>
                  <div>
                    <strong>Открытые места</strong>
                    <p>
                      {knownLocations.length
                        ? knownLocations.map((location) => location.name).join(', ')
                        : 'Пока известна только текущая сцена'}
                    </p>
                  </div>
                  <div>
                    <strong>Задания</strong>
                    <p>
                      {detail?.quests.length
                        ? detail.quests
                            .map((quest) => `${quest.title} — ${quest.status}`)
                            .join(', ')
                        : 'Заданий пока нет'}
                    </p>
                  </div>
                </div>
                <div className={styles.actions}>
                  <a
                    href={`/lobby?session=${encodeURIComponent(
                      session.id,
                    )}&view=history`}
                  >
                    <Button type="button">Просмотреть историю</Button>
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
