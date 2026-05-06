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

function featureLabel(feature: string) {
  return featureLabels[feature] ?? 'Игровой модуль';
}

export function CatalogPage() {
  const [games, setGames] = useState<AvailableGame[]>([]);
  const [search, setSearch] = useState('');
  const [feature, setFeature] = useState('any');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    void rpgService
      .listAvailableGames()
      .then(setGames)
      .catch((requestError) => {
        browserLogger.error('rpg-catalog', 'games load failed', requestError);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  const features = useMemo(
    () =>
      Array.from(new Set(games.flatMap((game) => game.supported_features))).sort(),
    [games],
  );

  const filteredGames = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return games.filter((game) => {
      const matchesSearch =
        !normalizedSearch ||
        game.title.toLowerCase().includes(normalizedSearch) ||
        game.description.toLowerCase().includes(normalizedSearch);
      const matchesFeature =
        feature === 'any' || game.supported_features.includes(feature);

      return matchesSearch && matchesFeature;
    });
  }, [feature, games, search]);

  if (loading) {
    return (
      <StatusBox
        kind="loading"
        title="Открываем каталог НРИ"
        description="Собираем список игр, подходящих для генерации сценария."
      />
    );
  }

  if (error) {
    return (
      <StatusBox
        kind="error"
        title="Каталог пока недоступен"
        description="Ведущий на мгновение замолчал. Попробуйте повторить действие."
      />
    );
  }

  return (
    <div className={styles.page}>
      <Panel
        eyebrow="Каталог НРИ"
        title="Игры для генерации сценария"
        description="Здесь только системы, для которых можно создать сюжет, персонажей, проверки, задания и карту."
      >
        <div className={styles.filterBar}>
          <Field label="Поиск по игре">
            <input
              value={search}
              placeholder="Например, Dungeons & Dragons или Cyberpunk"
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <Field label="Игровой фокус">
            <select
              value={feature}
              onChange={(event) => setFeature(event.target.value)}
            >
              <option value="any">Любой</option>
              {features.map((item) => (
                <option key={item} value={item}>
                  {featureLabel(item)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Panel>

      {filteredGames.length ? (
        <div className={styles.catalogGrid}>
          {filteredGames.map((game) => (
            <Panel key={game.id}>
              <article className={styles.list}>
                <div>
                  <h3 className={styles.gameTitle}>{game.title}</h3>
                  <p className={styles.muted}>{game.description}</p>
                </div>
                <div className={styles.chipRow}>
                  {game.supported_features.map((item) => (
                    <Badge key={item}>{featureLabel(item)}</Badge>
                  ))}
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
          title="Игра не найдена"
          description="Попробуйте изменить поиск или выбрать другой игровой фокус."
        />
      )}
    </div>
  );
}
