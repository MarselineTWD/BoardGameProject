import { Link, Outlet } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { rpgService } from '../entities/rpg/api/rpg.service';
import { GameSessionListItem } from '../entities/rpg/model/types';
import {
  notificationsService,
  playersService,
} from '../entities/players/api/players.service';
import { NotificationsState } from '../entities/players/model/types';
import { getAuthToken, localApiBase } from '../shared/api/http';
import { Button } from '../shared/ui/Button';
import styles from './AppLayout.module.css';

const navigationGroups = [
  {
    label: 'Обзор',
    primaryTo: '/',
    links: [
      { to: '/', label: 'Дашборд' },
      { to: '/catalog', label: 'Каталог НРИ' },
      { to: '/finder', label: 'Подбор НРИ' },
    ],
  },
  {
    label: 'Играть',
    primaryTo: '/rpg',
    links: [
      { to: '/rpg', label: 'НРИ' },
      { to: '/lobby', label: 'Лобби' },
      { to: '/players', label: 'Игроки' },
    ],
  },
  {
    label: 'Аккаунт',
    primaryTo: '/profile',
    links: [
      { to: '/profile', label: 'Профиль' },
      { to: '/auth', label: 'Вход' },
    ],
  },
];

export function AppLayout() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<GameSessionListItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationsState | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      setSessions([]);
      setNotifications(null);
      return;
    }

    const reload = () => {
      void rpgService
        .listSessions(String(user.id))
        .then(setSessions)
        .catch(() => setSessions([]));
      void notificationsService
        .get()
        .then(setNotifications)
        .catch(() => setNotifications(null));
    };

    reload();

    const socket = io(localApiBase, {
      auth: { token: getAuthToken() ?? '' },
      transports: ['websocket', 'polling'],
    });
    socket.emit('join-user', user.id);
    socket.on('notification-created', reload);
    socket.on('notifications-updated', reload);

    return () => {
      socket.disconnect();
    };
  }, [user]);

  const respondFriendRequest = async (
    id: number,
    status: 'accepted' | 'declined',
  ) => {
    await playersService.respondFriendRequest(id, status);
    setNotifications(await notificationsService.get());
  };

  const respondLobbyInvitation = async (
    sessionId: string,
    invitationId: string,
    status: 'accepted' | 'declined',
  ) => {
    await rpgService.respondLobbyInvitation(sessionId, invitationId, status);
    setNotifications(await notificationsService.get());
    setSessions(user ? await rpgService.listSessions(String(user.id)) : []);
  };

  const currentLobby = useMemo(
    () =>
      sessions
        .filter((session) => session.status !== 'finished')
        .sort(
          (first, second) =>
            new Date(second.updated_at).getTime() -
            new Date(first.updated_at).getTime(),
        )[0],
    [sessions],
  );
  const lobbyHref = currentLobby
    ? `/lobby?session=${encodeURIComponent(currentLobby.id)}`
    : '/rpg';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Ролевые партии с ведущим</p>
          <h1 className={styles.brand}>Meeple Scope</h1>
          <p className={styles.subtitle}>
            Каталог НРИ, генерация сценариев, персонажи, чат ведущего и карта
            партии.
          </p>
        </div>
        <nav className={styles.nav}>
          {navigationGroups.map((group) => (
            <div key={group.label} className={styles.navGroup}>
              <Link
                to={group.primaryTo}
                className={styles.navLink}
                activeProps={{
                  className: `${styles.navLink} ${styles.navLinkActive}`,
                }}
              >
                {group.label}
              </Link>
              <div className={styles.navDropdown}>
                {group.links.map((item) =>
                  item.to === '/lobby' ? (
                    <a
                      key={item.to}
                      href={lobbyHref}
                      className={styles.dropdownLink}
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={styles.dropdownLink}
                      activeProps={{
                        className: `${styles.dropdownLink} ${styles.dropdownLinkActive}`,
                      }}
                    >
                      {item.label}
                    </Link>
                  ),
                )}
              </div>
            </div>
          ))}
        </nav>
        {user ? (
          <div className={styles.notifications}>
            <button
              type="button"
              className={styles.notificationButton}
              onClick={() => setNotificationsOpen((current) => !current)}
            >
              Уведомления
              {notifications?.unreadCount ? (
                <span>{notifications.unreadCount}</span>
              ) : null}
            </button>
            {notificationsOpen ? (
              <div className={styles.notificationPanel}>
                <strong>Уведомления</strong>
                {notifications?.friendRequests.length ? (
                  notifications.friendRequests.map((request) => (
                    <article key={`friend-${request.id}`}>
                      <p>{request.fromUser.name} хочет добавить вас в друзья.</p>
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void respondFriendRequest(request.id, 'declined')}
                        >
                          Отклонить
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void respondFriendRequest(request.id, 'accepted')}
                        >
                          Принять
                        </Button>
                      </div>
                    </article>
                  ))
                ) : null}
                {notifications?.lobbyInvitations.length ? (
                  notifications.lobbyInvitations.map((invite) => (
                    <article key={`lobby-${invite.id}`}>
                      <p>
                        {invite.fromUser.name || 'Ведущий'} приглашает в лобби
                        "{invite.sessionTitle}".
                      </p>
                      <div>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            void respondLobbyInvitation(
                              invite.sessionId,
                              invite.id,
                              'declined',
                            )
                          }
                        >
                          Отклонить
                        </Button>
                        <Button
                          type="button"
                          onClick={() =>
                            void respondLobbyInvitation(
                              invite.sessionId,
                              invite.id,
                              'accepted',
                            )
                          }
                        >
                          Принять
                        </Button>
                      </div>
                      <a href={`/lobby?session=${encodeURIComponent(invite.sessionId)}`}>
                        Открыть лобби
                      </a>
                    </article>
                  ))
                ) : null}
                {!notifications?.unreadCount ? (
                  <p className={styles.notificationEmpty}>Новых уведомлений нет.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
