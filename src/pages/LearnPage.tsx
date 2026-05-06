import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import styles from './page.module.css';
import { gamesService } from '../entities/games/api/games.service';
import {
  useBoardGame,
  useGameNightThemes,
  useProgressionPaths,
} from '../entities/games/hooks/useBoardGameData';
import { Panel } from '../shared/ui/Panel';
import { StatusBox } from '../shared/ui/StatusBox';
import { Badge } from '../shared/ui/Badge';
import { Field } from '../shared/ui/Field';
import { Button } from '../shared/ui/Button';
import { GameCover } from '../shared/ui/GameCover';
import { formatPlayers, formatTime, toNumber } from '../shared/lib/format';
import { GeneratedLearningPlan } from '../entities/games/model/types';

export function LearnPage() {
  const { slug } = useParams({ from: '/learn/$slug' });
  const gameResource = useBoardGame(slug);
  const themesResource = useGameNightThemes();
  const pathsResource = useProgressionPaths();
  const [themeSlug, setThemeSlug] = useState('any');
  const [goal, setGoal] = useState('показать игру новым людям');
  const [generatedPlan, setGeneratedPlan] =
    useState<GeneratedLearningPlan | null>(null);
  const [generationLoading, setGenerationLoading] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const selectedTheme = useMemo(
    () =>
      themeSlug === 'any'
        ? null
        : (themesResource.data?.find((theme) => theme.slug === themeSlug) ??
          null),
    [themeSlug, themesResource.data],
  );

  const matchingPath = useMemo(() => {
    if (!pathsResource.data || !gameResource.data) {
      return null;
    }

    const weight = toNumber(gameResource.data.bgg_weight) ?? 2.5;

    return (
      [...pathsResource.data].sort((left, right) => {
        const leftGap = Math.abs(Number(left.difficulty_end) - weight);
        const rightGap = Math.abs(Number(right.difficulty_end) - weight);
        return leftGap - rightGap;
      })[0] ?? null
    );
  }, [gameResource.data, pathsResource.data]);

  if (gameResource.loading || themesResource.loading || pathsResource.loading) {
    return (
      <StatusBox
        kind="loading"
        title="Готовлю учебную карточку"
        description="Подтягиваю детали игры из локальной базы, маршруты развития и сценарии вечеров."
      />
    );
  }

  if (
    gameResource.error ||
    themesResource.error ||
    pathsResource.error ||
    !gameResource.data
  ) {
    return (
      <StatusBox
        kind="error"
        title="Учебная карточка недоступна"
        description="Не получилось получить данные по этой игре из локального REST API или резервного внешнего источника."
      />
    );
  }

  const game = gameResource.data;

  const handleGenerate = async () => {
    setGenerationLoading(true);
    setGenerationError(null);

    try {
      const plan = await gamesService.generateLearningPlan({
        slug: game.slug,
        goal,
        themeSlug,
      });
      setGeneratedPlan(plan);
    } catch (error) {
      setGenerationError(
        error instanceof Error
          ? error.message
          : 'Не удалось сгенерировать правила и сценарий',
      );
    } finally {
      setGenerationLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <Panel
        eyebrow="Маршрут обучения"
        title={game.name}
        description={game.meta_description || game.description.slice(0, 200)}
      >
        <div className={styles.gridTwo}>
          <GameCover className={styles.gameCover} game={game} />
          <div className={styles.list}>
            <div className={styles.chipRow}>
              <Badge tone="accent">
                BGG {toNumber(game.bgg_rating) ?? '—'}
              </Badge>
              <Badge>#{game.bgg_rank ?? '—'}</Badge>
              <Badge tone="dark">{game.year_published ?? '—'}</Badge>
            </div>
            <div className={styles.keyFacts}>
              <div className={styles.fact}>
                <span className={styles.factLabel}>Игроки</span>
                <span className={styles.factValue}>
                  {formatPlayers(game.min_players, game.max_players)}
                </span>
              </div>
              <div className={styles.fact}>
                <span className={styles.factLabel}>Время</span>
                <span className={styles.factValue}>
                  {formatTime(game.playing_time_min, game.playing_time_max)}
                </span>
              </div>
              <div className={styles.fact}>
                <span className={styles.factLabel}>Сложность</span>
                <span className={styles.factValue}>
                  {game.bgg_weight ?? '—'}/5
                </span>
              </div>
              <div className={styles.fact}>
                <span className={styles.factLabel}>Возраст</span>
                <span className={styles.factValue}>{game.min_age ?? '—'}+</span>
              </div>
            </div>
            <p className={styles.muted}>{game.description}</p>
          </div>
        </div>
      </Panel>

      <div className={styles.gridTwo}>
        <Panel
          title="AI-генерация правил"
          description="Сервер берёт локальную карточку игры, BGG XML API2 контекст и отправляет запрос в локальную модель Ollama."
        >
          <div className={styles.formGrid}>
            <Field label="Сценарий вечера">
              <select
                value={themeSlug}
                onChange={(event) => setThemeSlug(event.target.value)}
              >
                <option value="any">Любой сценарий</option>
                {themesResource.data!.slice(0, 10).map((theme) => (
                  <option key={theme.slug} value={theme.slug}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Цель объяснения">
              <input
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
              />
            </Field>
            <div className={styles.actions}>
              <Button
                type="button"
                disabled={generationLoading}
                onClick={() => void handleGenerate()}
              >
                {generationLoading ? 'Генерирую...' : 'Сгенерировать'}
              </Button>
            </div>
          </div>
          <p className={styles.muted}>
            Локальная модель по умолчанию: qwen2.5:1.5b. Она запускается через
            Ollama на ноутбуке и не требует внешнего API-ключа.
          </p>
          {generationError ? (
            <StatusBox
              kind="error"
              title="AI-генерация недоступна"
              description={generationError}
            />
          ) : null}
        </Panel>

        <Panel
          title="Источники генерации"
          description="Здесь видно, откуда сервер взял контекст для правил и сценария."
        >
          <div className={styles.chipRow}>
            <Badge tone="dark">PostgreSQL</Badge>
            <Badge tone="accent">BGG XML API2</Badge>
            <Badge>Ollama</Badge>
          </div>
          <ul className={styles.warningList}>
            {matchingPath ? (
              <li>
                Для роста игрока рядом подходит маршрут{' '}
                <strong>{matchingPath.name}</strong>.
              </li>
            ) : null}
            {generatedPlan?.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
            {generatedPlan ? (
              <li>
                BGG контекст:{' '}
                {generatedPlan.usedBgg
                  ? 'получен'
                  : 'не получен, использована локальная база'}
              </li>
            ) : (
              <li>
                Нажми генерацию, чтобы получить структурированное объяснение
                правил и сценарий вечера.
              </li>
            )}
          </ul>
        </Panel>
      </div>

      <Panel
        eyebrow="Правила"
        title="Как объяснять игру"
        description="Это не статичная заготовка: текст приходит с backend endpoint /ai/learning-plan после запроса к локальной AI-модели."
      >
        {generatedPlan ? (
          <div className={styles.gridTwo}>
            <div className={styles.reviewCard}>
              <Badge tone="accent">{generatedPlan.model}</Badge>
              <strong>Цель партии</strong>
              <p className={styles.muted}>{generatedPlan.rules.objective}</p>
              <strong>Структура хода</strong>
              <ul className={styles.warningList}>
                {generatedPlan.rules.turnStructure.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <strong>Ключевые блоки правил</strong>
              <ul className={styles.warningList}>
                {generatedPlan.rules.keyRules.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className={styles.reviewCard}>
              <strong>Учебный первый раунд</strong>
              <ul className={styles.warningList}>
                {generatedPlan.rules.firstRoundWalkthrough.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <strong>Типичные ошибки</strong>
              <ul className={styles.warningList}>
                {generatedPlan.rules.commonMistakes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <StatusBox
            kind="empty"
            title="Правила ещё не сгенерированы"
            description="Нажми кнопку генерации выше: сервер соберёт контекст из БД и BGG, затем отправит его в локальную модель."
          />
        )}
      </Panel>

      <Panel
        eyebrow="Генератор сценария"
        title="Сценарий вечера под конкретную игру"
        description="Сценарий генерируется той же AI-моделью под выбранную цель и тему вечера."
      >
        {generatedPlan ? (
          <div className={styles.gridTwo}>
            <div className={styles.reviewCard}>
              <Badge tone="accent">{generatedPlan.scenario.title}</Badge>
              <p className={styles.muted}>{generatedPlan.scenario.setup}</p>
              <p className={styles.muted}>
                {selectedTheme?.playlist_concept ??
                  'Тема не фиксирована: модель выбирает формат из параметров игры.'}
              </p>
            </div>
            <div className={styles.reviewCard}>
              <strong>Готовый сценарий</strong>
              <ul className={styles.warningList}>
                {generatedPlan.scenario.timeline.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <strong>Заметки ведущего</strong>
              <ul className={styles.warningList}>
                {generatedPlan.scenario.hostNotes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <StatusBox
            kind="empty"
            title="Сценарий ждёт запроса"
            description="Выбери тему, уточни цель объяснения и запусти генерацию."
          />
        )}
      </Panel>
    </div>
  );
}
