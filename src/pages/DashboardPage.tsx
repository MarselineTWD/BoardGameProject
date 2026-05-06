import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { GameSessionListItem } from '../entities/rpg/model/types';
import { rpgService } from '../entities/rpg/api/rpg.service';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { browserLogger } from '../shared/lib/browserLogger';
import { Badge } from '../shared/ui/Badge';
import { Button } from '../shared/ui/Button';
import { Panel } from '../shared/ui/Panel';
import { StatusBox } from '../shared/ui/StatusBox';
import styles from './page.module.css';

const statusLabels: Record<string, string> = {
  draft: 'Готовится',
  active: 'Идёт',
  finished: 'Завершена',
};

function sessionDurationMs(session: GameSessionListItem) {
  const startedAt = new Date(session.created_at).getTime();
  const updatedAt = new Date(session.updated_at).getTime();

  if (!Number.isFinite(startedAt) || !Number.isFinite(updatedAt)) {
    return 0;
  }

  return Math.max(0, updatedAt - startedAt);
}

function formatDuration(ms: number) {
  if (ms <= 0) {
    return '0 мин';
  }

  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) {
    return `${minutes} мин`;
  }

  if (!minutes) {
    return `${hours} ч`;
  }

  return `${hours} ч ${minutes} мин`;
}

export function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const playerId = user ? String(user.id) : '';
  const [sessions, setSessions] = useState<GameSessionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!playerId) {
      setSessions([]);
      return;
    }

    setLoading(true);
    void rpgService
      .listSessions(playerId)
      .then(setSessions)
      .catch((requestError) => {
        browserLogger.error('rpg-dashboard', 'sessions load failed', requestError);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [playerId]);

  const stats = useMemo(() => {
    const finished = sessions.filter((session) => session.status === 'finished');
    const characterCount = sessions.reduce(
      (total, session) => total + session.character_count,
      0,
    );
    const durations = sessions.map(sessionDurationMs);
    const totalDuration = durations.reduce((total, duration) => total + duration, 0);
    const longestDuration = durations.length ? Math.max(...durations) : 0;
    const averageDuration = sessions.length ? totalDuration / sessions.length : 0;

    return {
      finished: finished.length,
      characters: characterCount,
      total: sessions.length,
      longestDuration,
      totalDuration,
      averageDuration,
      recent: [...sessions]
        .sort(
          (first, second) =>
            new Date(second.updated_at).getTime() -
            new Date(first.updated_at).getTime(),
        )
        .slice(0, 4),
    };
  }, [sessions]);

  if (authLoading || loading) {
    return (
      <StatusBox
        kind="loading"
        title="Собираем статистику партий"
        description="Смотрим завершённые истории, продолжительность партий и созданных героев."
      />
    );
  }

  if (!user) {
    return (
      <div className={styles.page}>
        <Panel
          eyebrow="Статистика партий"
          title="Войдите, чтобы увидеть историю игр"
          description="После входа здесь появятся сыгранные партии, длительность историй и ваши персонажи."
        >
          <div className={styles.heroActions}>
            <Link to="/auth">
              <Button type="button">Вход и регистрация</Button>
            </Link>
            <Link to="/catalog">
              <Button type="button" variant="secondary">
                Смотреть каталог НРИ
              </Button>
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  if (error) {
    return (
      <StatusBox
        kind="error"
        title="Статистика пока недоступна"
        description="Ведущий на мгновение замолчал. Попробуйте повторить действие."
      />
    );
  }

  return (
    <div className={styles.page}>
      <Panel
        eyebrow="Статистика партий"
        title="Статистика сыгранных игр"
        description="Здесь видно, сколько историй завершено, какая партия длилась дольше всех и сколько героев уже создано."
      >
        <div className={styles.heroActions}>
          <Link to="/rpg">
            <Button type="button">Перейти к НРИ</Button>
          </Link>
          <Link to="/profile">
            <Button type="button" variant="secondary">
              История игр
            </Button>
          </Link>
        </div>
      </Panel>

      <div className={styles.metrics}>
        <div className={styles.metricCard}>
          <p className={styles.metricValue}>{stats.finished}</p>
          <p className={styles.metricLabel}>завершённых историй</p>
        </div>
        <div className={styles.metricCard}>
          <p className={styles.metricValue}>{formatDuration(stats.longestDuration)}</p>
          <p className={styles.metricLabel}>самая длинная игра</p>
        </div>
        <div className={styles.metricCard}>
          <p className={styles.metricValue}>{formatDuration(stats.totalDuration)}</p>
          <p className={styles.metricLabel}>всего за столом</p>
        </div>
        <div className={styles.metricCard}>
          <p className={styles.metricValue}>{formatDuration(stats.averageDuration)}</p>
          <p className={styles.metricLabel}>средняя партия</p>
        </div>
        <div className={styles.metricCard}>
          <p className={styles.metricValue}>{stats.characters}</p>
          <p className={styles.metricLabel}>созданных персонажей</p>
        </div>
        <div className={styles.metricCard}>
          <p className={styles.metricValue}>{stats.total}</p>
          <p className={styles.metricLabel}>историй в хронике</p>
        </div>
      </div>

      <Panel title="Последние партии">
        {stats.recent.length ? (
          <div className={styles.list}>
            {stats.recent.map((session) => (
              <article key={session.id} className={styles.reviewCard}>
                <div className={styles.chipRow}>
                  <Badge tone="accent">
                    {statusLabels[session.status] ?? session.status}
                  </Badge>
                  <Badge>{session.genre}</Badge>
                  <Badge>{session.tone}</Badge>
                </div>
                <div>
                  <h3 className={styles.gameTitle}>{session.title}</h3>
                  <p className={styles.muted}>
                    {session.current_scene || session.theme}
                  </p>
                </div>
                <div className={styles.statsRow}>
                  <span>Персонажей: {session.character_count}</span>
                  <span>
                    Обновлено:{' '}
                    {new Date(session.updated_at).toLocaleDateString('ru-RU')}
                  </span>
                </div>
                <div className={styles.actions}>
                  <a
                    href={
                      session.status === 'finished'
                        ? `/lobby?session=${encodeURIComponent(
                            session.id,
                          )}&view=history`
                        : `/lobby?session=${encodeURIComponent(session.id)}`
                    }
                  >
                    <Button type="button">
                      {session.status === 'finished'
                        ? 'Просмотреть историю'
                        : 'Перейти в лобби'}
                    </Button>
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <StatusBox
            kind="empty"
            title="Пока нет партий"
            description="Начните первую НРИ-историю, и статистика появится здесь."
          />
        )}
      </Panel>
    </div>
  );
}
