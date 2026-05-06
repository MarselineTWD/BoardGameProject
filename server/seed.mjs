import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { closePool, connectionString, pool } from './db.mjs';

const CSV_PATH = resolve(process.argv[2] ?? 'data/bgg_dataset.csv');
const SOURCE_URL =
  'https://raw.githubusercontent.com/jalwz17/Board-Game-Data-Analysis/main/bgg_dataset.csv';

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === ';' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(headerLine);

  return lines.filter(Boolean).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    );
  });
}

function toNumber(value) {
  if (!value) {
    return null;
  }

  const normalized = Number(String(value).replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : null;
}

function toInteger(value) {
  const numberValue = toNumber(value);
  return numberValue === null ? null : Math.trunc(numberValue);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function slugify(value, fallback) {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildBestPlayerCounts(minPlayers, maxPlayers) {
  if (minPlayers <= 0 || maxPlayers <= 0) {
    return [];
  }

  if (minPlayers === maxPlayers) {
    return [minPlayers];
  }

  const middle = Math.round((minPlayers + maxPlayers) / 2);
  return [...new Set([middle, Math.min(maxPlayers, middle + 1)])].filter(
    (count) => count >= minPlayers && count <= maxPlayers,
  );
}

function inferDna(
  mechanics,
  domains,
  complexity,
  playTime,
  minPlayers,
  maxPlayers,
  rating,
) {
  const mechanicsText = mechanics.join(' ').toLowerCase();
  const domainsText = domains.join(' ').toLowerCase();
  const hasLuck =
    mechanicsText.includes('dice') ||
    mechanicsText.includes('push your luck') ||
    mechanicsText.includes('random') ||
    mechanicsText.includes('roll');
  const hasInteraction =
    mechanicsText.includes('negotiation') ||
    mechanicsText.includes('take that') ||
    mechanicsText.includes('voting') ||
    mechanicsText.includes('auction') ||
    mechanicsText.includes('trading') ||
    maxPlayers >= 5;

  const complexityScore = complexity ? clamp(complexity * 20, 10, 100) : null;
  const ratingScore = rating ? clamp(rating * 11, 35, 100) : 55;
  const playerRange = Math.max(0, maxPlayers - minPlayers);

  return {
    strategy:
      domainsText.includes('strategy') || domainsText.includes('wargames')
        ? 82
        : 58,
    luck: hasLuck ? 72 : 34,
    interaction: hasInteraction ? 76 : 44,
    complexity: complexityScore,
    length: playTime ? clamp((playTime / 240) * 100, 8, 100) : null,
    scaling: clamp(45 + playerRange * 8, 35, 95),
    replayability: ratingScore,
    accessibility: complexity ? clamp(105 - complexity * 19, 20, 95) : 62,
  };
}

function buildDescription(name, year, mechanics, domains) {
  const yearPart = year ? `, опубликованная в ${year} году` : '';
  const mechanicsPart = mechanics.length
    ? ` Основные механики: ${mechanics.slice(0, 5).join(', ')}.`
    : '';
  const domainsPart = domains.length
    ? ` Направления: ${domains.join(', ')}.`
    : '';

  return `${name} - настольная игра${yearPart}. Данные карточки импортированы в локальную PostgreSQL-базу из открытого BGG-датасета.${mechanicsPart}${domainsPart}`;
}

function buildGame(row, index, usedSlugs) {
  const bggId = toInteger(row.ID);
  const name = row.Name.trim();
  const year = toInteger(row['Year Published']);
  const minPlayers = toInteger(row['Min Players']) ?? 1;
  const maxPlayers = Math.max(
    minPlayers,
    toInteger(row['Max Players']) ?? minPlayers,
  );
  const playTime = toInteger(row['Play Time']);
  const minAge = toInteger(row['Min Age']);
  const usersRated = toInteger(row['Users Rated']) ?? 0;
  const rating = toNumber(row['Rating Average']);
  const rank = toInteger(row['BGG Rank']);
  const complexity = toNumber(row['Complexity Average']);
  const mechanics = splitList(row.Mechanics);
  const domains = splitList(row.Domains);
  const baseSlug = slugify(name, `bgg-${bggId ?? index + 1}`);
  let slug = baseSlug;
  let duplicateIndex = 2;

  while (usedSlugs.has(slug)) {
    slug = `${baseSlug}-${duplicateIndex}`;
    duplicateIndex += 1;
  }

  usedSlugs.add(slug);

  const dna = inferDna(
    mechanics,
    domains,
    complexity,
    playTime,
    minPlayers,
    maxPlayers,
    rating,
  );
  const timeValue = playTime && playTime > 0 ? playTime : null;
  const description = buildDescription(name, year, mechanics, domains);

  return {
    slug,
    name,
    year_published: year,
    bgg_id: bggId,
    bgg_rating: rating === null ? null : rating.toFixed(2),
    bgg_rank: rank,
    bgg_weight: complexity === null ? null : complexity.toFixed(2),
    bgg_num_ratings: usersRated,
    min_players: minPlayers,
    max_players: maxPlayers,
    best_player_counts: buildBestPlayerCounts(minPlayers, maxPlayers),
    playing_time_min: timeValue,
    playing_time_max: timeValue,
    min_age: minAge,
    dna_strategy: dna.strategy,
    dna_luck: dna.luck,
    dna_interaction: dna.interaction,
    dna_complexity: dna.complexity,
    dna_length: dna.length,
    dna_scaling: dna.scaling,
    dna_replayability: dna.replayability,
    dna_accessibility: dna.accessibility,
    wikidata_id: '',
    thumbnail_url: '',
    image_url: '',
    is_featured: Boolean(
      (rank && rank <= 1000) || usersRated >= 5000 || (rating && rating >= 7.5),
    ),
    is_expansion: false,
    description,
    meta_description: `${name} (${year ?? 'год неизвестен'}) - ${minPlayers}-${maxPlayers} игроков, ${timeValue ?? 'нет данных'} мин, сложность ${complexity?.toFixed(1) ?? 'нет данных'}/5, рейтинг ${rating?.toFixed(1) ?? 'нет данных'}.`,
    source: 'boardgamegeek-csv',
  };
}

function buildTaxonomy(items, type) {
  const counts = new Map();

  for (const itemList of items) {
    for (const item of itemList) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, gameCount]) => ({
      slug: slugify(name, `${type}-${gameCount}`),
      name,
      description:
        type === 'mechanic'
          ? `Механика встречается в ${gameCount} играх локального каталога.`
          : `Категория встречается в ${gameCount} играх локального каталога.`,
      bgg_id: null,
      ...(type === 'category'
        ? { category_type: 'style' }
        : { parent_slug: null, depth: 0, complexity_tendency: 'mixed' }),
      game_count: gameCount,
      meta_description: `${name}: ${gameCount} игр в локальной базе Meeple Scope.`,
    }));
}

function buildStaticProgressionPaths() {
  return [
    {
      slug: 'family-to-gateway',
      name: 'От семейных игр к gateway',
      description:
        'Маршрут для игроков, которые хотят перейти от простых партий к первым осознанным стратегиям.',
      difficulty_start: '1.2',
      difficulty_end: '2.2',
      target_audience: 'Новички и семейные компании',
      primary_mechanic_slug: 'set-collection',
      primary_category_slug: 'family-games',
      meta_description: 'Плавный вход в современное настольное хобби.',
    },
    {
      slug: 'gateway-to-euro',
      name: 'От gateway к евро',
      description:
        'Подборка для роста в планирование, экономику, worker placement и оптимизацию действий.',
      difficulty_start: '2.0',
      difficulty_end: '3.2',
      target_audience: 'Игроки с несколькими десятками партий',
      primary_mechanic_slug: 'worker-placement',
      primary_category_slug: 'strategy-games',
      meta_description: 'Маршрут в средние стратегические игры.',
    },
    {
      slug: 'euro-to-heavy',
      name: 'К тяжёлым стратегиям',
      description:
        'Маршрут для компаний, которым уже комфортны длинные партии и плотные системы решений.',
      difficulty_start: '3.0',
      difficulty_end: '4.4',
      target_audience: 'Опытные игроки',
      primary_mechanic_slug: 'variable-player-powers',
      primary_category_slug: 'strategy-games',
      meta_description: 'Переход к комплексным играм и кампаниям.',
    },
  ];
}

function buildStaticGameNightThemes() {
  return [
    {
      slug: 'all-day-gaming',
      name: 'Большой игровой день',
      description:
        'Длинный формат с несколькими партиями, перерывами и финальной игрой вечера.',
      player_count_min: 3,
      player_count_max: 6,
      duration_hours: '4-8',
      vibe: 'марафон',
      playlist_concept:
        'Начать с лёгкой игры, затем перейти к главной стратегии и закончить коротким филлером.',
      meta_description: 'Сценарий для длинной игровой встречи.',
    },
    {
      slug: 'newcomer-table',
      name: 'Стол для новичков',
      description:
        'Вечер, где правила объясняются быстро, а первая партия не пугает сложностью.',
      player_count_min: 2,
      player_count_max: 5,
      duration_hours: '1.5-3',
      vibe: 'дружелюбный вход',
      playlist_concept:
        'Выбрать игры с низкой сложностью, коротким ходом и понятной целью победы.',
      meta_description: 'Сценарий для знакомства с настольными играми.',
    },
    {
      slug: 'strategy-focus',
      name: 'Стратегический вечер',
      description:
        'Формат для компании, которая хочет меньше случайности и больше планирования.',
      player_count_min: 2,
      player_count_max: 4,
      duration_hours: '2-5',
      vibe: 'вдумчивый',
      playlist_concept:
        'Оставить одну главную игру, заранее раздать правила и дать время на разбор стратегии.',
      meta_description: 'Сценарий для плотной стратегической партии.',
    },
  ];
}

function buildStaticTools() {
  return [
    {
      slug: 'local-catalog-finder',
      name: 'Локальный подборщик',
      description:
        'Считает score по игрокам, времени, сложности, рейтингу и DNA-показателям.',
      tool_type: 'recommendation',
      icon: 'search',
      is_published: true,
      meta_description: 'Инструмент персонального подбора игр.',
    },
    {
      slug: 'rules-scenario-generator',
      name: 'Генератор сценария объяснения',
      description:
        'Собирает план объяснения правил и сценарий вечера из карточки игры.',
      tool_type: 'learning',
      icon: 'book-open',
      is_published: true,
      meta_description: 'Инструмент обучения настольным играм.',
    },
  ];
}

function buildStaticProfiles() {
  return [
    {
      id: 1,
      name: 'Мария',
      city: 'Екатеринбург',
      experienceLevel: 'intermediate',
      preferredPlayers: 4,
      maxPlayTime: 120,
      bio: 'Люблю евро, кооперативы и вечера, где можно быстро объяснить правила новым людям.',
      favoriteGenres: ['семейная стратегия', 'кооператив', 'экономика'],
    },
  ];
}

function buildStaticReviews() {
  return [
    {
      id: 1,
      gameSlug: 'catan',
      gameName: 'Catan',
      title: 'Отличный вход в хобби',
      rating: 4,
      sessionMood: 'Домашний семейный вечер',
      notes:
        'Лучше всего заходит вчетвером, особенно если нужна игра для новичков.',
      wouldReplay: true,
      playedAt: '2026-04-06',
      playersCount: 4,
    },
    {
      id: 2,
      gameSlug: 'elysium',
      gameName: 'Elysium',
      title: 'Красивые комбо, но требует фокуса',
      rating: 5,
      sessionMood: 'Спокойный стратегический вечер',
      notes:
        'Подходит, когда хочется карточных связок и не слишком долгой партии.',
      wouldReplay: true,
      playedAt: '2026-04-11',
      playersCount: 3,
    },
  ];
}

function buildStaticUsers() {
  const demoPasswordHash =
    'demo$9f4a6ff2c14d8c87$5c22b9cb6c8f6e9a894f4f7e4f3c88bbd388cd5eb1c195225a70fb062e96cf8a';

  return [
    {
      id: 1,
      email: 'maria@example.com',
      username: 'maria',
      passwordHash: demoPasswordHash,
      name: 'Мария',
      city: 'Екатеринбург',
      skillLevel: 'intermediate',
      rating: 1240,
      gamesPlayed: 18,
      wins: 7,
      avatarColor: '#153d45',
      friendCode: '1000000001',
    },
    {
      id: 2,
      email: 'artem@example.com',
      username: 'artem',
      passwordHash: demoPasswordHash,
      name: 'Артём',
      city: 'Екатеринбург',
      skillLevel: 'advanced',
      rating: 1385,
      gamesPlayed: 31,
      wins: 15,
      avatarColor: '#c16429',
      friendCode: '1000000002',
    },
    {
      id: 3,
      email: 'lena@example.com',
      username: 'lena',
      passwordHash: demoPasswordHash,
      name: 'Лена',
      city: 'Пермь',
      skillLevel: 'casual',
      rating: 1120,
      gamesPlayed: 12,
      wins: 4,
      avatarColor: '#439b92',
      friendCode: '1000000003',
    },
    {
      id: 4,
      email: 'nikita@example.com',
      username: 'nikita',
      passwordHash: demoPasswordHash,
      name: 'Никита',
      city: 'Москва',
      skillLevel: 'expert',
      rating: 1510,
      gamesPlayed: 44,
      wins: 23,
      avatarColor: '#6a5acd',
      friendCode: '1000000004',
    },
  ];
}

function buildStaticPlayers() {
  return [
    {
      id: 1,
      name: 'Мария',
      city: 'Екатеринбург',
      skillLevel: 'intermediate',
      rating: 1240,
      gamesPlayed: 18,
      wins: 7,
      isFriend: true,
      avatarColor: '#153d45',
    },
    {
      id: 2,
      name: 'Артём',
      city: 'Екатеринбург',
      skillLevel: 'advanced',
      rating: 1385,
      gamesPlayed: 31,
      wins: 15,
      isFriend: true,
      avatarColor: '#c16429',
    },
    {
      id: 3,
      name: 'Лена',
      city: 'Пермь',
      skillLevel: 'casual',
      rating: 1120,
      gamesPlayed: 12,
      wins: 4,
      isFriend: true,
      avatarColor: '#439b92',
    },
    {
      id: 4,
      name: 'Никита',
      city: 'Москва',
      skillLevel: 'expert',
      rating: 1510,
      gamesPlayed: 44,
      wins: 23,
      isFriend: false,
      avatarColor: '#6a5acd',
    },
  ];
}

function buildCatalog(rows) {
  const usedSlugs = new Set();
  const games = rows.map((row, index) => buildGame(row, index, usedSlugs));
  const mechanicsByGame = rows.map((row) => splitList(row.Mechanics));
  const domainsByGame = rows.map((row) => splitList(row.Domains));
  const mechanics = buildTaxonomy(mechanicsByGame, 'mechanic');
  const categories = buildTaxonomy(domainsByGame, 'category');

  return {
    games,
    categories,
    mechanics,
    progressionPaths: buildStaticProgressionPaths(),
    gameNightThemes: buildStaticGameNightThemes(),
    tools: buildStaticTools(),
    profiles: buildStaticProfiles(),
    reviews: buildStaticReviews(),
    users: buildStaticUsers(),
    players: buildStaticPlayers(),
    localCatalogMeta: [
      {
        id: 1,
        source: 'BoardGameGeek community dataset on GitHub',
        sourceUrl: SOURCE_URL,
        importedAt: new Date().toISOString(),
        games: games.length,
        featuredGames: games.filter((game) => game.is_featured).length,
        mechanics: mechanics.length,
        categories: categories.length,
      },
    ],
  };
}

function valueOrNull(value) {
  return value === undefined || value === '' ? null : value;
}

async function insertMany(items, sql, mapper) {
  for (const item of items) {
    await pool.query(sql, mapper(item));
  }
}

async function resetIdentity(table, column) {
  await pool.query(`
    SELECT setval(
      pg_get_serial_sequence('${table}', '${column}'),
      GREATEST((SELECT COALESCE(MAX(${column}), 0) FROM ${table}), 1),
      true
    )
  `);
}

const csv = await readFile(CSV_PATH, 'utf8');
const db = buildCatalog(parseCsv(csv));

try {
  await pool.query('BEGIN');
  await pool.query(`
    TRUNCATE
      reviews,
      lobby_members,
      lobbies,
      friend_requests,
      friendships,
      auth_sessions,
      app_users,
      players,
      profiles,
      tools,
      game_night_themes,
      progression_paths,
      mechanics,
      categories,
      games,
      local_catalog_meta
    RESTART IDENTITY CASCADE
  `);

  await insertMany(
    db.games,
    `
      INSERT INTO games (
        slug, name, year_published, bgg_id, bgg_rating, bgg_rank, bgg_weight,
        bgg_num_ratings, min_players, max_players, best_player_counts,
        playing_time_min, playing_time_max, min_age,
        dna_strategy, dna_luck, dna_interaction, dna_complexity, dna_length,
        dna_scaling, dna_replayability, dna_accessibility,
        wikidata_id, thumbnail_url, image_url, is_featured, is_expansion,
        description, meta_description, source
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
      )
    `,
    (game) => [
      game.slug,
      game.name,
      valueOrNull(game.year_published),
      valueOrNull(game.bgg_id),
      valueOrNull(game.bgg_rating),
      valueOrNull(game.bgg_rank),
      valueOrNull(game.bgg_weight),
      game.bgg_num_ratings,
      game.min_players,
      game.max_players,
      game.best_player_counts,
      valueOrNull(game.playing_time_min),
      valueOrNull(game.playing_time_max),
      valueOrNull(game.min_age),
      valueOrNull(game.dna_strategy),
      valueOrNull(game.dna_luck),
      valueOrNull(game.dna_interaction),
      valueOrNull(game.dna_complexity),
      valueOrNull(game.dna_length),
      valueOrNull(game.dna_scaling),
      valueOrNull(game.dna_replayability),
      valueOrNull(game.dna_accessibility),
      game.wikidata_id,
      game.thumbnail_url,
      game.image_url,
      game.is_featured,
      game.is_expansion,
      game.description,
      game.meta_description,
      game.source,
    ],
  );

  await insertMany(
    db.categories,
    `
      INSERT INTO categories (
        slug, name, description, bgg_id, category_type, game_count, meta_description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    (category) => [
      category.slug,
      category.name,
      category.description,
      valueOrNull(category.bgg_id),
      category.category_type,
      category.game_count,
      category.meta_description,
    ],
  );

  await insertMany(
    db.mechanics,
    `
      INSERT INTO mechanics (
        slug, name, description, bgg_id, parent_slug, depth,
        complexity_tendency, game_count, meta_description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    (mechanic) => [
      mechanic.slug,
      mechanic.name,
      mechanic.description,
      valueOrNull(mechanic.bgg_id),
      valueOrNull(mechanic.parent_slug),
      mechanic.depth,
      mechanic.complexity_tendency,
      mechanic.game_count,
      mechanic.meta_description,
    ],
  );

  await insertMany(
    db.progressionPaths,
    `
      INSERT INTO progression_paths (
        slug, name, description, difficulty_start, difficulty_end,
        target_audience, primary_mechanic_slug, primary_category_slug,
        meta_description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    (path) => [
      path.slug,
      path.name,
      path.description,
      path.difficulty_start,
      path.difficulty_end,
      path.target_audience,
      valueOrNull(path.primary_mechanic_slug),
      valueOrNull(path.primary_category_slug),
      path.meta_description,
    ],
  );

  await insertMany(
    db.gameNightThemes,
    `
      INSERT INTO game_night_themes (
        slug, name, description, player_count_min, player_count_max,
        duration_hours, vibe, playlist_concept, meta_description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    (theme) => [
      theme.slug,
      theme.name,
      theme.description,
      theme.player_count_min,
      theme.player_count_max,
      theme.duration_hours,
      theme.vibe,
      theme.playlist_concept,
      theme.meta_description,
    ],
  );

  await insertMany(
    db.tools,
    `
      INSERT INTO tools (
        slug, name, description, tool_type, icon, is_published, meta_description
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    (tool) => [
      tool.slug,
      tool.name,
      tool.description,
      tool.tool_type,
      tool.icon,
      tool.is_published,
      tool.meta_description,
    ],
  );

  await insertMany(
    db.profiles,
    `
      INSERT INTO profiles (
        id, name, city, experience_level, preferred_players,
        max_play_time, bio, favorite_genres
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    (profile) => [
      profile.id,
      profile.name,
      profile.city,
      profile.experienceLevel,
      profile.preferredPlayers,
      profile.maxPlayTime,
      profile.bio,
      profile.favoriteGenres,
    ],
  );

  await insertMany(
    db.reviews,
    `
      INSERT INTO reviews (
        id, lobby_id, game_slug, game_name, title, rating, session_mood,
        notes, would_replay, played_at, players_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    (review) => [
      review.id,
      review.lobbyId ?? null,
      review.gameSlug,
      review.gameName,
      review.title,
      review.rating,
      review.sessionMood,
      review.notes,
      review.wouldReplay,
      review.playedAt,
      review.playersCount,
    ],
  );

  await resetIdentity('reviews', 'id');

  await insertMany(
    db.localCatalogMeta,
    `
      INSERT INTO local_catalog_meta (
        id, source, source_url, imported_at, games,
        featured_games, mechanics, categories
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    (meta) => [
      meta.id,
      meta.source,
      meta.sourceUrl,
      meta.importedAt,
      meta.games,
      meta.featuredGames,
      meta.mechanics,
      meta.categories,
    ],
  );

  await insertMany(
    db.users,
    `
      INSERT INTO app_users (
        id, email, username, password_hash, name, city, skill_level, rating,
        games_played, wins, avatar_color, friend_code
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    (user) => [
      user.id,
      user.email,
      user.username,
      user.passwordHash,
      user.name,
      user.city,
      user.skillLevel,
      user.rating,
      user.gamesPlayed,
      user.wins,
      user.avatarColor,
      user.friendCode,
    ],
  );

  await resetIdentity('app_users', 'id');

  await insertMany(
    [
      { userId: 1, friendUserId: 2 },
      { userId: 2, friendUserId: 1 },
      { userId: 1, friendUserId: 3 },
      { userId: 3, friendUserId: 1 },
    ],
    `
      INSERT INTO friendships (user_id, friend_user_id)
      VALUES ($1, $2)
    `,
    (friendship) => [friendship.userId, friendship.friendUserId],
  );

  await pool.query(`
    INSERT INTO friend_requests (from_user_id, to_user_id, status)
    VALUES (4, 1, 'pending')
  `);

  await insertMany(
    db.players,
    `
      INSERT INTO players (
        id, name, city, skill_level, rating, games_played,
        wins, is_friend, avatar_color
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    (player) => [
      player.id,
      player.name,
      player.city,
      player.skillLevel,
      player.rating,
      player.gamesPlayed,
      player.wins,
      player.isFriend,
      player.avatarColor,
    ],
  );

  await resetIdentity('players', 'id');

  const lobbyResult = await pool.query(`
    INSERT INTO lobbies (id, owner_user_id, name, status)
    VALUES (1, 1, 'Игровой вечер', 'draft')
    RETURNING id
  `);

  await resetIdentity('lobbies', 'id');

  await insertMany(
    [
      { userId: 1, seatOrder: 1 },
      { userId: 2, seatOrder: 2 },
    ],
    `
      INSERT INTO lobby_members (
        lobby_id, player_id, user_id, guest_name, is_guest, seat_order
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    (member) => [
      lobbyResult.rows[0].id,
      null,
      member.userId,
      null,
      false,
      member.seatOrder,
    ],
  );

  await pool.query('COMMIT');
  console.log(`Seeded PostgreSQL from ${CSV_PATH}: ${db.games.length} games`);
  console.log(`Connection: ${connectionString}`);
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  await closePool();
}
