import { FormEvent, useState } from 'react';
import { Link } from '@tanstack/react-router';
import styles from './page.module.css';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { PlayerSkillLevel } from '../entities/players/model/types';
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

export function AuthPage() {
  const auth = useAuth();
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: '',
  });
  const [registerForm, setRegisterForm] = useState({
    email: '',
    password: '',
  });

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    await auth.login({
      email: loginForm.email.trim(),
      password: loginForm.password,
    });
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    await auth.register({
      email: registerForm.email.trim(),
      password: registerForm.password,
    });
  };

  if (auth.loading) {
    return (
      <StatusBox
        kind="loading"
        title="Проверяю сессию"
        description="Проверяем, открыт ли ваш игровой профиль."
      />
    );
  }

  return (
    <div className={styles.page}>
      <Panel
        eyebrow="Аккаунт игрока"
        title="Вход и регистрация"
        description="Аккаунт нужен для лобби, истории игр, друзей и сохранённых персонажей."
      >
        {auth.user ? (
          <div className={styles.heroActions}>
            <Link to="/players">
              <Button>Перейти к друзьям</Button>
            </Link>
            <Link to="/lobby">
              <Button variant="secondary">Открыть лобби</Button>
            </Link>
            <Button
              type="button"
              variant="ghost"
              disabled={auth.saving}
              onClick={() => void auth.logout()}
            >
              Выйти
            </Button>
          </div>
        ) : null}
      </Panel>

      {auth.user ? (
        <Panel
          title="Текущий аккаунт"
          description="Этот идентификатор нужен для поиска друзьями."
        >
          <article className={`${styles.playerRow} ${styles.playerRowCompact}`}>
            <span
              className={styles.avatar}
              style={{ backgroundColor: auth.user.avatarColor }}
              aria-hidden="true"
            >
              {auth.user.name.slice(0, 1).toUpperCase()}
            </span>
            <div className={styles.list}>
              <strong>{auth.user.name}</strong>
              <div className={styles.chipRow}>
                <Badge tone="accent">{auth.user.friendCode}</Badge>
                <Badge>{auth.user.rating} рейтинга</Badge>
                <Badge>{skillLabels[auth.user.skillLevel]}</Badge>
              </div>
              <p className={styles.muted}>
                {auth.user.email}
                {auth.user.city ? ` · ${auth.user.city}` : ''}
              </p>
            </div>
          </article>
        </Panel>
      ) : (
        <div className={styles.gridTwo}>
          <Panel
            title="Войти"
            description="Для входа используй почту и пароль от зарегистрированного аккаунта."
          >
            <form className={styles.formGrid} onSubmit={handleLogin}>
              <Field label="Почта">
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Пароль">
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  disabled={
                    auth.saving ||
                    !loginForm.email.trim() ||
                    loginForm.password.length < 6
                  }
                >
                  Войти
                </Button>
              </div>
            </form>
          </Panel>

          <Panel
            title="Создать аккаунт"
            description="Укажи почту и пароль. Имя и идентификатор для друзей сервер создаст автоматически."
          >
            <form className={styles.formGrid} onSubmit={handleRegister}>
              <Field label="Почта">
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Пароль">
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                />
              </Field>
              <div className={styles.actions}>
                <Button
                  type="submit"
                  disabled={
                    auth.saving ||
                    !registerForm.email.trim() ||
                    registerForm.password.length < 6
                  }
                >
                  Зарегистрироваться
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      )}

      {auth.error ? (
        <StatusBox
          kind="error"
          title="Не удалось выполнить действие"
          description={auth.error}
        />
      ) : null}
    </div>
  );
}
