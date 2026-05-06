import { useEffect, useMemo, useState } from 'react';
import { AvailableGame } from '../entities/rpg/model/types';
import { rpgService } from '../entities/rpg/api/rpg.service';
import { browserLogger } from '../shared/lib/browserLogger';
import { Badge } from '../shared/ui/Badge';
import { Button } from '../shared/ui/Button';
import { Field } from '../shared/ui/Field';
import { Panel } from '../shared/ui/Panel';
import { StatusBox } from '../shared/ui/StatusBox';
import styles from './page.module.css';

const featureLabels: Record<string, string> = {
  characters: 'Персонажи',
  combat: 'Бой',
  dice: 'Проверки кубиком',
  map: 'Карта',
  quests: 'Задания',
};

const moodMatchers: Record<string, string[]> = {
  fantasy: ['dnd', 'pathfinder'],
  investigation: ['cthulhu', 'vampire'],
  city: ['cyberpunk', 'blades', 'vampire'],
  flexible: ['fate'],
  battle: ['dnd', 'pathfinder', 'warhammer', 'cyberpunk'],
};

function featureLabel(feature: string) {
  return featureLabels[feature] ?? 'Игровой модуль';
}

function scoreGame(game: AvailableGame, mood: string, feature: string) {
  let score = 50;
  const text = `${game.id} ${game.title} ${game.description}`.toLowerCase();

  if (feature !== 'any' && game.supported_features.includes(feature)) {
    score += 30;
  }

  if (mood !== 'any') {
    const matches = moodMatchers[mood] ?? [];
    score += matches.some((item) => text.includes(item)) ? 35 : -10;
  }

  if (game.supported_features.includes('map')) {
    score += 8;
  }

  if (game.supported_features.includes('dice')) {
    score += 8;
  }

  return Math.min(100, Math.max(0, score));
}

export function FinderPage() {
  const [games, setGames] = useState<AvailableGame[]>([]);
  const [mood, setMood] = useState('any');
  const [feature, setFeature] = useState('any');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    void rpgService
      .listAvailableGames()
      .then(setGames)
      .catch((requestError) => {
        browserLogger.error('rpg-finder', 'games load failed', requestError);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const features = useMemo(
    () =>
      Array.from(new Set(games.flatMap((game) => game.supported_features))).sort(),
    [games],
  );

  const recommendations = useMemo(
    () =>
      games
        .map((game) => ({
          game,
          score: scoreGame(game, mood, feature),
        }))
        .filter((item) => item.score > 35)
        .sort((first, second) => second.score - first.score),
    [feature, games, mood],
  );

  if (loading) {
    return (
      <StatusBox
        kind="loading"
        title="Подбираем НРИ"
        description="Сравниваем системы по жанру, бою, проверкам и поддержке карты."
      />
    );
  }

  if (error) {
    return (
      <StatusBox
        kind="error"
        title="Подбор пока недоступен"
        description="Ведущий на мгновение замолчал. Попробуйте повторить действие."
      />
    );
  }

  return (
    <div className={styles.page}>
      <Panel
        eyebrow="Подбор НРИ"
        title="Выберите систему под будущий сценарий"
        description="Подбор показывает игры, для которых уместны сюжет, персонажи, проверки, инвентарь и карта."
      >
        <div className={styles.formGrid}>
          <Field label="Настроение партии">
            <select value={mood} onChange={(event) => setMood(event.target.value)}>
              <option value="any">Любое</option>
              <option value="fantasy">Героическое фэнтези</option>
              <option value="investigation">Тайны и расследование</option>
              <option value="city">Городские интриги</option>
              <option value="battle">Тактические столкновения</option>
              <option value="flexible">Свободный жанр</option>
            </select>
          </Field>
          <Field label="Что важнее всего">
            <select
              value={feature}
              onChange={(event) => setFeature(event.target.value)}
            >
              <option value="any">Без предпочтений</option>
              {features.map((item) => (
                <option key={item} value={item}>
                  {featureLabel(item)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Panel>

      <Panel
        title="На что влияет выбранная игра"
        description="Система задаёт жанр, типы героев, подходящие классы и роли, стиль карты, врагов, проверки кубиком, боевые сцены, инвентарь и тон ответов ведущего."
      />

      {recommendations.length ? (
        <div className={styles.catalogGrid}>
          {recommendations.map(({ game, score }) => (
            <Panel key={game.id}>
              <article className={styles.list}>
                <div className={styles.chipRow}>
                  <Badge tone="accent">Подходит на {score}%</Badge>
                  {game.supported_features.slice(0, 3).map((item) => (
                    <Badge key={item}>{featureLabel(item)}</Badge>
                  ))}
                </div>
                <div>
                  <h3 className={styles.gameTitle}>{game.title}</h3>
                  <p className={styles.muted}>{game.description}</p>
                  <p className={styles.muted}>
                    При генерации эта игра определит завязку, доступные архетипы
                    персонажей, характер проверок, опасности и стиль карты.
                  </p>
                </div>
                <div className={styles.actions}>
                  <a href={`/rpg?game=${encodeURIComponent(game.id)}`}>
                    <Button type="button">Перейти к генерации сценария</Button>
                  </a>
                </div>
              </article>
            </Panel>
          ))}
        </div>
      ) : (
        <StatusBox
          kind="empty"
          title="Подходящей игры не нашлось"
          description="Попробуйте выбрать другое настроение или снять игровой фокус."
        />
      )}
    </div>
  );
}
