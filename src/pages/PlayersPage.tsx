import { FormEvent, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import styles from './page.module.css';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { usePlayers } from '../entities/players/hooks/usePlayers';
import { Player, PlayerSkillLevel } from '../entities/players/model/types';
import { Badge } from '../shared/ui/Badge';
import { Button } from '../shared/ui/Button';
import { Field } from '../shared/ui/Field';
import { Panel } from '../shared/ui/Panel';
import { StatusBox } from '../shared/ui/StatusBox';

const skillLabels: Record<PlayerSkillLevel, string> = {
  casual: 'Любитель',
  intermediate: 'Уверенный',
  advanced: 'Продвинутый',
  expert: 'Эксперт',
};

function getFriendshipLabel(player: Player) {
  if (player.friendshipStatus === 'self') {
    return 'это вы';
  }

  if (player.friendshipStatus === 'accepted') {
    return 'друг';
  }

  if (player.friendshipStatus === 'outgoing') {
    return 'заявка отправлена';
  }

  if (player.friendshipStatus === 'incoming') {
    return 'ждёт ответа';
  }

  return 'не в друзьях';
}

export function PlayersPage() {
  const auth = useAuth();
  const playersResource = usePlayers();
  const [identifier, setIdentifier] = useState('');

  const topPlayers = useMemo(
    () =>
      [...playersResource.players].sort(
        (left, right) => right.rating - left.rating,
      ),
    [playersResource.players],
  );

  const currentUserPlayer = topPlayers.find((player) => player.isCurrentUser);

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();

    if (!identifier.trim()) {
      return;
    }

    await playersResource.searchByIdentifier(identifier);
  };

  const incomingRequestFor = (playerId: number) =>
    playersResource.friendRequests.incoming.find(
      (request) => request.fromUser.id === playerId,
    );

  if (playersResource.loading || auth.loading) {
    return (
      <StatusBox
        kind="loading"
        title="Загружаю рейтинг игроков"
        description="Собираем игроков, заявки в друзья и общую статистику."
      />
    );
  }

  if (playersResource.error) {
    return (
      <StatusBox
        kind="error"
        title="Рейтинг игроков недоступен"
        description="Ведущий на мгновение замолчал. Попробуйте повторить действие."
      />
    );
  }

  const renderFriendAction = (player: Player) => {
    const incoming = incomingRequestFor(player.id);

    if (!auth.user) {
      return (
        <Link to="/auth">
          <Button type="button" variant="secondary">
            Войти
          </Button>
        </Link>
      );
    }

    if (player.friendshipStatus === 'none') {
      return (
        <Button
          type="button"
          variant="secondary"
          disabled={playersResource.saving}
          onClick={() =>
            void playersResource.sendFriendRequest(player.friendCode)
          }
        >
          Отправить заявку
        </Button>
      );
    }

    if (player.friendshipStatus === 'incoming' && incoming) {
      return (
        <div className={styles.actions}>
          <Button
            type="button"
            disabled={playersResource.saving}
            onClick={() =>
              void playersResource.respondFriendRequest(incoming.id, 'accepted')
            }
          >
            Принять
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={playersResource.saving}
            onClick={() =>
              void playersResource.respondFriendRequest(incoming.id, 'declined')
            }
          >
            Отклонить
          </Button>
        </div>
      );
    }

    return (
      <Badge tone={player.isFriend ? 'dark' : 'accent'}>
        {getFriendshipLabel(player)}
      </Badge>
    );
  };

  return (
    <div className={styles.page}>
      <Panel
        eyebrow="Игроки"
        title="Топ игроков и друзья"
        description="Рейтинг хранится на сервере, а дружба появляется только после заявки и принятия вторым пользователем."
      >
        <div className={styles.heroActions}>
          <Link to="/lobby">
            <Button>Открыть лобби</Button>
          </Link>
          <Link to="/auth">
            <Button variant="secondary">
              {auth.user ? 'Аккаунт' : 'Вход и регистрация'}
            </Button>
          </Link>
        </div>
      </Panel>

      <div className={styles.gridTwo}>
        <Panel
          title="Поиск по идентификатору"
          description="Введи friend-code игрока. Заявка попадёт именно ему в список входящих."
        >
          {auth.user ? (
            <form className={styles.formGrid} onSubmit={handleSearch}>
              <Field
                label="Ваш идентификатор"
                hint="Его можно дать другому игроку для поиска."
              >
                <input readOnly value={auth.user.friendCode} />
              </Field>
              <Field label="Идентификатор друга">
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="Например, 1000000004"
                />
              </Field>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  disabled={playersResource.saving || !identifier.trim()}
                >
                  Найти игрока
                </Button>
              </div>
            </form>
          ) : (
            <StatusBox
              kind="empty"
              title="Нужен аккаунт"
              description="Войди или зарегистрируйся, чтобы искать друзей по идентификатору и отправлять заявки."
            />
          )}

          {playersResource.searchError ? (
            <p className={styles.muted}>{playersResource.searchError}</p>
          ) : null}
          {playersResource.operationError ? (
            <p className={styles.muted}>{playersResource.operationError}</p>
          ) : null}

          {playersResource.searchResult ? (
            <article
              className={`${styles.playerRow} ${styles.playerRowCompact}`}
            >
              <span
                className={styles.avatar}
                style={{
                  backgroundColor: playersResource.searchResult.avatarColor,
                }}
                aria-hidden="true"
              >
                {playersResource.searchResult.name.slice(0, 1).toUpperCase()}
              </span>
              <div className={styles.list}>
                <strong>{playersResource.searchResult.name}</strong>
                <div className={styles.chipRow}>
                  <Badge tone="accent">
                    {playersResource.searchResult.friendCode}
                  </Badge>
                  <Badge>{playersResource.searchResult.rating} рейтинга</Badge>
                  <Badge>
                    {getFriendshipLabel(playersResource.searchResult)}
                  </Badge>
                </div>
              </div>
              {renderFriendAction(playersResource.searchResult)}
            </article>
          ) : null}
        </Panel>

        <Panel
          title="Заявки"
          description="Входящие заявки нужно принять или отклонить, исходящие ждут решения другого игрока."
        >
          {auth.user ? (
            <div className={styles.list}>
              <div className={styles.metrics}>
                <div className={styles.metricCard}>
                  <p className={styles.metricValue}>
                    {playersResource.friends.length}
                  </p>
                  <p className={styles.metricLabel}>друзей</p>
                </div>
                <div className={styles.metricCard}>
                  <p className={styles.metricValue}>
                    {playersResource.friendRequests.incoming.length}
                  </p>
                  <p className={styles.metricLabel}>входящих заявок</p>
                </div>
              </div>

              {playersResource.friendRequests.incoming.map((request) => (
                <article
                  key={request.id}
                  className={`${styles.playerRow} ${styles.playerRowCompact}`}
                >
                  <span
                    className={styles.avatar}
                    style={{ backgroundColor: request.fromUser.avatarColor }}
                    aria-hidden="true"
                  >
                    {request.fromUser.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className={styles.list}>
                    <strong>{request.fromUser.name}</strong>
                    <div className={styles.chipRow}>
                      <Badge tone="accent">{request.fromUser.friendCode}</Badge>
                      <Badge>{request.fromUser.rating} рейтинга</Badge>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      disabled={playersResource.saving}
                      onClick={() =>
                        void playersResource.respondFriendRequest(
                          request.id,
                          'accepted',
                        )
                      }
                    >
                      Принять
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={playersResource.saving}
                      onClick={() =>
                        void playersResource.respondFriendRequest(
                          request.id,
                          'declined',
                        )
                      }
                    >
                      Отклонить
                    </Button>
                  </div>
                </article>
              ))}

              {playersResource.friendRequests.outgoing.map((request) => (
                <article
                  key={request.id}
                  className={`${styles.playerRow} ${styles.playerRowCompact}`}
                >
                  <span
                    className={styles.avatar}
                    style={{ backgroundColor: request.toUser.avatarColor }}
                    aria-hidden="true"
                  >
                    {request.toUser.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className={styles.list}>
                    <strong>{request.toUser.name}</strong>
                    <div className={styles.chipRow}>
                      <Badge tone="accent">{request.toUser.friendCode}</Badge>
                      <Badge>заявка отправлена</Badge>
                    </div>
                  </div>
                </article>
              ))}

              {!playersResource.friendRequests.incoming.length &&
              !playersResource.friendRequests.outgoing.length ? (
                <p className={styles.muted}>Активных заявок пока нет.</p>
              ) : null}
            </div>
          ) : (
            <StatusBox
              kind="empty"
              title="Заявки появятся после входа"
              description="Сервер показывает входящие и исходящие заявки только текущему пользователю."
            />
          )}
        </Panel>
      </div>

      <Panel
        eyebrow="GET /players"
        title="Рейтинг игроков"
        description="Сортировка идёт по серверному рейтингу. В лобби можно приглашать только принятых друзей."
      >
        <div className={styles.list}>
          {topPlayers.map((player, index) => (
            <article key={player.id} className={styles.playerRow}>
              <span className={styles.leaderboardRank}>#{index + 1}</span>
              <span
                className={styles.avatar}
                style={{ backgroundColor: player.avatarColor }}
                aria-hidden="true"
              >
                {player.name.slice(0, 1).toUpperCase()}
              </span>
              <div className={styles.list}>
                <strong>
                  {player.name}
                  {currentUserPlayer?.id === player.id ? ' · вы' : ''}
                </strong>
                <div className={styles.chipRow}>
                  <Badge tone="accent">{player.rating} рейтинга</Badge>
                  <Badge>{skillLabels[player.skillLevel]}</Badge>
                  <Badge>
                    {player.wins}/{player.gamesPlayed} побед
                  </Badge>
                  <Badge>{getFriendshipLabel(player)}</Badge>
                </div>
                <p className={styles.muted}>
                  {player.city || 'Город не указан'}
                </p>
              </div>
              {renderFriendAction(player)}
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
