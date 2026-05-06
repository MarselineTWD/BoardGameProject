import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import styles from './page.module.css';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { useCatalogGames } from '../entities/games/hooks/useBoardGameData';
import { useLobby } from '../entities/players/hooks/usePlayers';
import { useLobbyReviews } from '../entities/reviews/hooks/useReviews';
import { Review } from '../entities/reviews/model/types';
import { Badge } from '../shared/ui/Badge';
import { Button } from '../shared/ui/Button';
import { Field } from '../shared/ui/Field';
import { Panel } from '../shared/ui/Panel';
import { Stars } from '../shared/ui/Stars';
import { StatusBox } from '../shared/ui/StatusBox';

interface SessionFormState {
  title: string;
  rating: number;
  sessionMood: string;
  notes: string;
  wouldReplay: boolean;
  playedAt: string;
}

const emptySessionForm: SessionFormState = {
  title: '',
  rating: 4,
  sessionMood: '',
  notes: '',
  wouldReplay: true,
  playedAt: new Date().toISOString().slice(0, 10),
};

export function LobbyPage() {
  const auth = useAuth();
  const lobbyResource = useLobby();
  const catalogResource = useCatalogGames();
  const reviewsResource = useLobbyReviews();
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [gameSearch, setGameSearch] = useState('');
  const [placementDrafts, setPlacementDrafts] = useState<
    Record<number, string>
  >({});
  const [sessionForm, setSessionForm] =
    useState<SessionFormState>(emptySessionForm);

  useEffect(() => {
    setGameSearch(lobbyResource.lobby?.gameName ?? '');
  }, [lobbyResource.lobby?.gameName]);

  useEffect(() => {
    setPlacementDrafts(
      Object.fromEntries(
        lobbyResource.members.map((member) => [
          member.id,
          member.placement ? String(member.placement) : '',
        ]),
      ),
    );
  }, [lobbyResource.members]);

  const invitedPlayerIds = useMemo(
    () =>
      new Set(
        lobbyResource.members
          .map((member) => member.playerId)
          .filter((id): id is number => id !== null),
      ),
    [lobbyResource.members],
  );

  const friendOptions = useMemo(
    () =>
      lobbyResource.availablePlayers.filter(
        (player) => player.isFriend && !invitedPlayerIds.has(player.id),
      ),
    [invitedPlayerIds, lobbyResource.availablePlayers],
  );

  const gameOptions = useMemo(() => {
    const catalog = catalogResource.data ?? [];
    const query = gameSearch.trim().toLowerCase();

    return catalog
      .filter((game) =>
        query ? game.name.toLowerCase().includes(query) : game.is_featured,
      )
      .slice(0, 20);
  }, [catalogResource.data, gameSearch]);

  const selectedGame = useMemo(
    () =>
      (catalogResource.data ?? []).find(
        (game) => game.name.toLowerCase() === gameSearch.trim().toLowerCase(),
      ) ?? null,
    [catalogResource.data, gameSearch],
  );

  if (auth.loading) {
    return (
      <StatusBox
        kind="loading"
        title="Проверяю аккаунт"
        description="Сейчас открою твоё лобби."
      />
    );
  }

  if (!auth.user) {
    return (
      <div className={styles.page}>
        <Panel
          title="Войдите, чтобы открыть лобби"
          description="После входа можно собрать игроков, выбрать игру и записать результат партии."
        >
          <div className={styles.heroActions}>
            <Link to="/auth">
              <Button>Вход и регистрация</Button>
            </Link>
            <Link to="/players">
              <Button variant="secondary">Игроки</Button>
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  if (lobbyResource.loading || catalogResource.loading || reviewsResource.loading) {
    return (
      <StatusBox
        kind="loading"
        title="Открываю лобби"
        description="Загружаю игру, игроков и записи партии."
      />
    );
  }

  if (lobbyResource.error || catalogResource.error || !lobbyResource.lobby) {
    return (
      <StatusBox
        kind="error"
        title="Лобби недоступно"
        description="Попробуй обновить страницу."
      />
    );
  }

  const handleGameSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!gameSearch.trim()) {
      await lobbyResource.updateGame('');
      return;
    }

    if (!selectedGame) {
      return;
    }

    await lobbyResource.updateGame(selectedGame.slug);
  };

  const handleInviteFriend = async (event: FormEvent) => {
    event.preventDefault();

    if (!selectedPlayerId) {
      return;
    }

    await lobbyResource.invitePlayer(Number(selectedPlayerId));
    setSelectedPlayerId('');
  };

  const handleAddGuest = async (event: FormEvent) => {
    event.preventDefault();

    if (!guestName.trim()) {
      return;
    }

    await lobbyResource.addGuest(guestName.trim());
    setGuestName('');
  };

  const handlePlacementBlur = async (memberId: number, currentValue: number | null) => {
    const value = placementDrafts[memberId]?.trim() ?? '';
    const nextValue = value ? Number(value) : null;

    if (nextValue === currentValue) {
      return;
    }

    await lobbyResource.updateMemberPlacement(memberId, nextValue);
  };

  const handleSessionSubmit = async (event: FormEvent) => {
    event.preventDefault();

    await reviewsResource.saveReview({
      gameSlug: lobbyResource.lobby!.gameSlug ?? '',
      gameName: lobbyResource.lobby!.gameName ?? '',
      playersCount: lobbyResource.members.length || 1,
      ...sessionForm,
    });
    setSessionForm(emptySessionForm);
  };

  const renderReview = (review: Review) => (
    <article key={review.id} className={styles.reviewCard}>
      <div className={styles.actions}>
        <Badge tone="dark">{review.gameName}</Badge>
        <Badge>{review.playersCount} игроков</Badge>
        <Badge tone="accent">{review.playedAt}</Badge>
      </div>
      <strong>{review.title}</strong>
      <Stars value={review.rating} />
      {review.sessionMood ? <p>{review.sessionMood}</p> : null}
      {review.notes ? <p className={styles.muted}>{review.notes}</p> : null}
      <div className={styles.actions}>
        <Button
          type="button"
          variant="danger"
          onClick={() => void reviewsResource.deleteReview(review.id)}
        >
          Удалить
        </Button>
      </div>
    </article>
  );

  return (
    <div className={styles.page}>
      <Panel
        title={lobbyResource.lobby.name}
        description="Собери участников, выбери игру и запиши итоги партии."
      >
        <div className={styles.heroActions}>
          <Link to="/finder">
            <Button>Подобрать игру</Button>
          </Link>
          <Link to="/players">
            <Button variant="secondary">Игроки</Button>
          </Link>
        </div>
      </Panel>

      <Panel
        title="Игра для партии"
        description="Выбери игру, чтобы запись партии сохранилась с нужным названием."
      >
        <form className={styles.formGrid} onSubmit={handleGameSubmit}>
          <Field label="Игра">
            <>
              <input
                list="lobby-game-options"
                value={gameSearch}
                onChange={(event) => setGameSearch(event.target.value)}
                placeholder="Начни вводить название"
              />
              <datalist id="lobby-game-options">
                {gameOptions.map((game) => (
                  <option key={game.slug} value={game.name} />
                ))}
              </datalist>
            </>
          </Field>
          <div className={styles.actions}>
            <Button
              type="submit"
              disabled={lobbyResource.saving || (!!gameSearch.trim() && !selectedGame)}
            >
              Сохранить игру
            </Button>
            {lobbyResource.lobby.gameName ? (
              <Badge tone="accent">{lobbyResource.lobby.gameName}</Badge>
            ) : null}
          </div>
        </form>
      </Panel>

      <div className={styles.gridTwo}>
        <Panel title="Пригласить друга">
          <form className={styles.formGrid} onSubmit={handleInviteFriend}>
            <Field label="Друг">
              <select
                value={selectedPlayerId}
                onChange={(event) => setSelectedPlayerId(event.target.value)}
              >
                <option value="">Выбери игрока</option>
                {friendOptions.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} · {player.rating}
                  </option>
                ))}
              </select>
            </Field>
            <div className={styles.actions}>
              <Button
                type="submit"
                disabled={!selectedPlayerId || lobbyResource.saving}
              >
                Пригласить
              </Button>
            </div>
          </form>
        </Panel>

        <Panel title="Добавить гостя">
          <form className={styles.formGrid} onSubmit={handleAddGuest}>
            <Field label="Имя гостя">
              <input
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                placeholder="Например, Дима"
              />
            </Field>
            <div className={styles.actions}>
              <Button
                type="submit"
                disabled={!guestName.trim() || lobbyResource.saving}
              >
                Добавить гостя
              </Button>
            </div>
          </form>
        </Panel>
      </div>

      <Panel title="Участники">
        {lobbyResource.members.length ? (
          <div className={styles.list}>
            {lobbyResource.members.map((member) => (
              <article key={member.id} className={styles.playerRow}>
                <span
                  className={styles.avatar}
                  style={{ backgroundColor: member.avatarColor }}
                  aria-hidden="true"
                >
                  {member.name.slice(0, 1).toUpperCase()}
                </span>
                <div className={styles.list}>
                  <strong>{member.name}</strong>
                  <div className={styles.chipRow}>
                    <Badge tone={member.isGuest ? 'accent' : 'dark'}>
                      {member.isGuest ? 'гость' : 'друг'}
                    </Badge>
                    {member.rating ? (
                      <Badge>{member.rating} рейтинга</Badge>
                    ) : null}
                  </div>
                  <p className={styles.muted}>
                    {member.city || 'Добавлен вручную'}
                  </p>
                </div>
                <Field label="Место">
                  <input
                    type="number"
                    min={1}
                    value={placementDrafts[member.id] ?? ''}
                    onChange={(event) =>
                      setPlacementDrafts((current) => ({
                        ...current,
                        [member.id]: event.target.value,
                      }))
                    }
                    onBlur={() =>
                      void handlePlacementBlur(member.id, member.placement)
                    }
                    placeholder="1"
                  />
                </Field>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => void lobbyResource.removeMember(member.id)}
                >
                  Убрать
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <StatusBox
            kind="empty"
            title="Лобби пустое"
            description="Пригласи друзей или добавь гостей вручную."
          />
        )}
      </Panel>

      <Panel
        title="Запись партии"
        description="После партии сохрани впечатления и результат для выбранной игры."
      >
        <form className={styles.formGrid} onSubmit={handleSessionSubmit}>
          <Field label="Заголовок">
            <input
              value={sessionForm.title}
              onChange={(event) =>
                setSessionForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Например, плотная победа на последнем ходу"
            />
          </Field>
          <Field label="Оценка">
            <Stars
              value={sessionForm.rating}
              onChange={(rating) =>
                setSessionForm((current) => ({ ...current, rating }))
              }
            />
          </Field>
          <Field label="Дата партии">
            <input
              type="date"
              value={sessionForm.playedAt}
              onChange={(event) =>
                setSessionForm((current) => ({
                  ...current,
                  playedAt: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Настроение">
            <input
              value={sessionForm.sessionMood}
              onChange={(event) =>
                setSessionForm((current) => ({
                  ...current,
                  sessionMood: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Повторить?">
            <select
              value={String(sessionForm.wouldReplay)}
              onChange={(event) =>
                setSessionForm((current) => ({
                  ...current,
                  wouldReplay: event.target.value === 'true',
                }))
              }
            >
              <option value="true">Да</option>
              <option value="false">Нет</option>
            </select>
          </Field>
          <Field label="Заметки">
            <textarea
              value={sessionForm.notes}
              onChange={(event) =>
                setSessionForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </Field>
          <div className={styles.actions}>
            <Button
              type="submit"
              disabled={
                reviewsResource.saving ||
                !lobbyResource.lobby.gameSlug ||
                !sessionForm.title.trim()
              }
            >
              Сохранить партию
            </Button>
          </div>
        </form>
        {reviewsResource.error ? (
          <p className={styles.muted}>{reviewsResource.error}</p>
        ) : null}
      </Panel>

      <Panel title="История этого лобби">
        {reviewsResource.reviews.length ? (
          <div className={styles.list}>
            {reviewsResource.reviews.map(renderReview)}
          </div>
        ) : (
          <StatusBox
            kind="empty"
            title="Записей пока нет"
            description="Выбери игру и сохрани первую партию."
          />
        )}
      </Panel>
    </div>
  );
}
