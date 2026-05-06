import { Link, Outlet } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { rpgService } from '../entities/rpg/api/rpg.service';
import { GameSessionListItem } from '../entities/rpg/model/types';
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

  useEffect(() => {
    if (!user) {
      setSessions([]);
      return;
    }

    void rpgService
      .listSessions(String(user.id))
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [user]);

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
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
