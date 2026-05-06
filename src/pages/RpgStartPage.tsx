import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { AvailableGame, GameSessionListItem } from '../entities/rpg/model/types';
import { rpgService } from '../entities/rpg/api/rpg.service';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { browserLogger } from '../shared/lib/browserLogger';
import { Badge } from '../shared/ui/Badge';
import { Button } from '../shared/ui/Button';
import { Field } from '../shared/ui/Field';
import { Panel } from '../shared/ui/Panel';
import { StatusBox } from '../shared/ui/StatusBox';
import styles from './page.module.css';

const statusLabels: Record<string, string> = {
  draft: 'Лобби готовится',
  active: 'Игра идёт',
  finished: 'Игра завершена',
};

const featureLabels: Record<string, string> = {
  characters: 'Персонажи',
  combat: 'Бой',
  dice: 'Проверки кубиком',
  map: 'Карта',
  quests: 'Задания',
};

function featureLabel(feature: string) {
  return featureLabels[feature] ?? 'Игровой модуль';
}

function selectedGameFromUrl() {
  return new URLSearchParams(window.location.search).get('game') ?? '';
}

function visibleSession(sessions: GameSessionListItem[]) {
  return sessions
    .filter((session) => session.status !== 'finished')
    .sort(
      (first, second) =>
        new Date(second.updated_at).getTime() -
        new Date(first.updated_at).getTime(),
    )[0];
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';

  if (message.includes('Эта игра пока недоступна')) {
    return 'Эта игра пока недоступна для генерации сценария.';
  }

  if (message.includes('Войдите')) {
    return 'Войдите в аккаунт, чтобы начать игру.';
  }

  return 'Ведущий на мгновение замолчал. Попробуйте повторить действие.';
}

export function RpgStartPage() {
  const { user, loading: authLoading } = useAuth();
  const playerId = user ? String(user.id) : '';
  const [games, setGames] = useState<AvailableGame[]>([]);
  const [sessions, setSessions] = useState<GameSessionListItem[]>([]);
  const [selectedGameId, setSelectedGameId] = useState(selectedGameFromUrl);
  const [theme, setTheme] = useState('');
  const [loadingGames, setLoadingGames] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentSession = useMemo(() => visibleSession(sessions), [sessions]);
  const selectedGame =
    games.find((game) => game.id === selectedGameId) ?? games[0] ?? null;

  useEffect(() => {
    setLoadingGames(true);
    void rpgService
      .listAvailableGames()
      .then((items) => {
        setGames(items);
        setSelectedGameId((current) => current || items[0]?.id || '');
      })
      .catch((requestError) => {
        browserLogger.error('rpg-start', 'games load failed', requestError);
        setError('Ведущий на мгновение замолчал. Попробуйте повторить действие.');
      })
      .finally(() => setLoadingGames(false));
  }, []);

  useEffect(() => {
    if (!playerId) {
      setSessions([]);
      return;
    }

    setLoadingSessions(true);
    void rpgService
      .listSessions(playerId)
      .then(setSessions)
      .catch((requestError) => {
        browserLogger.error('rpg-start', 'sessions load failed', requestError);
        setError('Ведущий на мгновение замолчал. Попробуйте повторить действие.');
      })
      .finally(() => setLoadingSessions(false));
  }, [playerId]);

  const handleStart = async () => {
    if (!selectedGame) {
      setError('Эта игра пока недоступна для генерации сценария.');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const generated = await rpgService.generateCampaign(
        selectedGame.id,
        theme.trim() || `Новая история для ${selectedGame.title}`,
        playerId,
      );
      window.location.href = `/lobby?session=${encodeURIComponent(
        generated.session_id,
      )}`;
    } catch (requestError) {
      browserLogger.error('rpg-start', 'campaign generate failed', requestError);
      setError(safeMessage(requestError));
    } finally {
      setGenerating(false);
    }
  };

  if (authLoading || loadingGames) {
    return (
      <StatusBox
        kind="loading"
        title="Открываем стол"
        description="Готовим список игр и сохранённые партии."
      />
    );
  }

  if (!user) {
    return (
      <div className={styles.page}>
        <Panel
          title="Войдите, чтобы создать лобби"
          description="Партии, персонажи и история игры сохраняются в аккаунте."
        >
          <div className={styles.heroActions}>
            <Link to="/auth">
              <Button type="button">Вход и регистрация</Button>
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  if (currentSession) {
    return (
      <div className={styles.page}>
        <Panel
          eyebrow="Текущее лобби"
          title={currentSession.title}
          description={currentSession.current_scene || currentSession.theme}
          action={
            <a href={`/lobby?session=${encodeURIComponent(currentSession.id)}`}>
              <Button type="button">Перейти в лобби</Button>
            </a>
          }
        >
          <div className={styles.chipRow}>
            <Badge tone="accent">
              {statusLabels[currentSession.status] ?? currentSession.status}
            </Badge>
            <Badge>{currentSession.genre}</Badge>
            <Badge>{currentSession.tone}</Badge>
          </div>
        </Panel>

        <div className={styles.gridTwo}>
          <Panel title="Текущий сценарий">
            <div className={styles.list}>
              <p className={styles.muted}>{currentSession.theme}</p>
              <div className={styles.statsRow}>
                <span>
                  Обновлено:{' '}
                  {new Date(currentSession.updated_at).toLocaleDateString('ru-RU')}
                </span>
                <span>Персонажей: {currentSession.character_count}</span>
              </div>
            </div>
          </Panel>

          <Panel title="Персонажи">
            {currentSession.character_names.length ? (
              <div className={styles.chipRow}>
                {currentSession.character_names.map((name) => (
                  <Badge key={name}>{name}</Badge>
                ))}
              </div>
            ) : (
              <p className={styles.muted}>
                Персонажей пока нет. Их можно создать в лобби.
              </p>
            )}
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Panel
        eyebrow="Новая партия"
        title="Начать игру"
        description="Выберите НРИ-систему, задайте идею истории и перейдите к созданию сценария."
      >
        {error ? <p className={styles.muted}>{error}</p> : null}
        {loadingSessions ? (
          <p className={styles.muted}>Проверяем сохранённые лобби...</p>
        ) : null}
        <div className={styles.formGrid}>
          <Field label="НРИ-система">
            <select
              value={selectedGame?.id ?? ''}
              onChange={(event) => setSelectedGameId(event.target.value)}
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Тематика игры">
            <input
              value={theme}
              maxLength={500}
              placeholder="Город под запретом магии, забытая станция, проклятый особняк"
              onChange={(event) => setTheme(event.target.value)}
            />
          </Field>
        </div>
        {selectedGame ? (
          <div className={styles.reviewCard}>
            <h3 className={styles.gameTitle}>{selectedGame.title}</h3>
            <p className={styles.muted}>{selectedGame.description}</p>
            <p className={styles.muted}>
              Выбор этой игры задаёт жанр, архетипы персонажей, типы проверок,
              опасности, инвентарь и стиль карты.
            </p>
            <div className={styles.chipRow}>
              {selectedGame.supported_features.map((feature) => (
                <Badge key={feature}>{featureLabel(feature)}</Badge>
              ))}
            </div>
          </div>
        ) : null}
        <div className={styles.heroActions}>
          <Button type="button" disabled={generating} onClick={handleStart}>
            {generating ? 'Ведущий готовит сцену...' : 'Начать игру'}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
