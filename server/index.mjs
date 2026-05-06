import {
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import cors from 'cors';
import express from 'express';
import { XMLParser } from 'fast-xml-parser';
import { Server } from 'socket.io';
import { pool } from './db.mjs';
import { registerGameRoutes } from './game-routes.mjs';

const app = express();
const server = createServer(app);
const port = Number(process.env.PORT ?? 3001);
const scrypt = promisify(scryptCallback);
const xmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  htmlEntities: true,
});
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.set('io', io);

io.on('connection', (socket) => {
  socket.on('join-game-session', (sessionId) => {
    if (typeof sessionId === 'string' && sessionId.trim()) {
      socket.join(`game:${sessionId.trim()}`);
    }
  });

  socket.on('leave-game-session', (sessionId) => {
    if (typeof sessionId === 'string' && sessionId.trim()) {
      socket.leave(`game:${sessionId.trim()}`);
    }
  });
});

function asyncRoute(handler) {
  return async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      next(error);
    }
  };
}

function parseBoolean(value) {
  if (value === undefined) {
    return null;
  }

  return value === 'true' || value === true;
}

function readPositiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (storedHash.startsWith('demo$')) {
    return password === 'demo1234';
  }

  const [algorithm, salt, hash] = storedHash.split('$');

  if (algorithm !== 'scrypt' || !salt || !hash) {
    return false;
  }

  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');

  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}

function normalizeEmail(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function buildNameFromEmail(email) {
  const localPart = email.split('@')[0] || 'player';
  return localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

async function buildUniqueUsername(email) {
  const localPart = email.split('@')[0] || 'user';
  const base =
    localPart
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'user';

  for (let index = 0; index < 8; index += 1) {
    const candidate =
      index === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
    const existing = await pool.query(
      'SELECT 1 FROM app_users WHERE username = $1',
      [candidate],
    );

    if (!existing.rows[0]) {
      return candidate;
    }
  }

  return `${base}-${randomBytes(4).toString('hex')}`;
}

async function buildUniqueFriendCode() {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = String(randomInt(1_000_000_000, 10_000_000_000));
    const existing = await pool.query(
      'SELECT 1 FROM app_users WHERE friend_code = $1',
      [candidate],
    );

    if (!existing.rows[0]) {
      return candidate;
    }
  }

  throw new Error('Could not generate unique player identifier');
}

function toAuthUser(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    name: row.name,
    city: row.city,
    skillLevel: row.skill_level,
    rating: row.rating,
    gamesPlayed: row.games_played,
    wins: row.wins,
    avatarColor: row.avatar_color,
    friendCode: row.friend_code,
    createdAt: row.created_at,
  };
}

async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await pool.query(
    `
      INSERT INTO auth_sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, now() + interval '7 days')
    `,
    [hashToken(token), userId],
  );
  return token;
}

async function readAuthUser(request) {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT u.*
      FROM auth_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
    `,
    [hashToken(token)],
  );

  return result.rows[0] ?? null;
}

function requireAuth(handler) {
  return asyncRoute(async (request, response, next) => {
    const user = await readAuthUser(request);

    if (!user) {
      response.status(401).json({ message: 'Authentication required' });
      return;
    }

    request.authUser = user;
    await handler(request, response, next);
  });
}

function toGame(row) {
  return {
    slug: row.slug,
    name: row.name,
    year_published: row.year_published,
    bgg_id: row.bgg_id,
    bgg_rating: row.bgg_rating === null ? null : String(row.bgg_rating),
    bgg_rank: row.bgg_rank,
    bgg_weight: row.bgg_weight === null ? null : String(row.bgg_weight),
    bgg_num_ratings: row.bgg_num_ratings,
    min_players: row.min_players,
    max_players: row.max_players,
    best_player_counts: row.best_player_counts ?? [],
    playing_time_min: row.playing_time_min,
    playing_time_max: row.playing_time_max,
    min_age: row.min_age,
    dna_strategy: row.dna_strategy,
    dna_luck: row.dna_luck,
    dna_interaction: row.dna_interaction,
    dna_complexity: row.dna_complexity,
    dna_length: row.dna_length,
    dna_scaling: row.dna_scaling,
    dna_replayability: row.dna_replayability,
    dna_accessibility: row.dna_accessibility,
    wikidata_id: row.wikidata_id,
    thumbnail_url: row.thumbnail_url,
    image_url: row.image_url,
    is_featured: row.is_featured,
    is_expansion: row.is_expansion,
    description: row.description,
    meta_description: row.meta_description,
    source: row.source,
  };
}

function toProfile(row) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    experienceLevel: row.experience_level,
    preferredPlayers: row.preferred_players,
    maxPlayTime: row.max_play_time,
    bio: row.bio,
    favoriteGenres: row.favorite_genres ?? [],
  };
}

async function getOrCreateProfile(user) {
  const existing = await pool.query('SELECT * FROM profiles WHERE id = $1', [
    user.id,
  ]);

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await pool.query(
    `
      INSERT INTO profiles (
        id, name, city, experience_level, preferred_players,
        max_play_time, bio, favorite_genres
      )
      VALUES ($1, $2, $3, $4, 4, 120, '', '{}')
      RETURNING *
    `,
    [user.id, user.name, user.city, user.skill_level ?? 'beginner'],
  );

  return created.rows[0];
}

function toReview(row) {
  return {
    id: row.id,
    lobbyId: row.lobby_id,
    gameSlug: row.game_slug,
    gameName: row.game_name,
    title: row.title,
    rating: row.rating,
    sessionMood: row.session_mood,
    notes: row.notes,
    wouldReplay: row.would_replay,
    playedAt: formatDate(row.played_at),
    playersCount: row.players_count,
  };
}

function toProgressionPath(row) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    difficulty_start: row.difficulty_start,
    difficulty_end: row.difficulty_end,
    target_audience: row.target_audience,
    primary_mechanic_slug: row.primary_mechanic_slug,
    primary_category_slug: row.primary_category_slug,
    meta_description: row.meta_description,
  };
}

function toGameNightTheme(row) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    player_count_min: row.player_count_min,
    player_count_max: row.player_count_max,
    duration_hours: row.duration_hours,
    vibe: row.vibe,
    playlist_concept: row.playlist_concept,
    meta_description: row.meta_description,
  };
}

function toTool(row) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    tool_type: row.tool_type,
    icon: row.icon,
    is_published: row.is_published,
    meta_description: row.meta_description,
  };
}

function toLocalCatalogMeta(row) {
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url,
    importedAt: row.imported_at,
    games: row.games,
    featuredGames: row.featured_games,
    mechanics: row.mechanics,
    categories: row.categories,
  };
}

function toPlayer(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    city: row.city,
    skillLevel: row.skill_level,
    rating: row.rating,
    gamesPlayed: row.games_played,
    wins: row.wins,
    isFriend: row.is_friend ?? false,
    isCurrentUser: row.is_current_user ?? false,
    friendshipStatus: row.friendship_status ?? 'none',
    avatarColor: row.avatar_color,
    friendCode: row.friend_code,
    createdAt: row.created_at,
  };
}

function toLobby(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    gameSlug: row.game_slug,
    gameName: row.game_name ?? null,
    createdAt: row.created_at,
  };
}

function toLobbyMember(row) {
  return {
    id: row.id,
    lobbyId: row.lobby_id,
    playerId: row.user_id ?? row.player_id,
    name: row.name,
    city: row.city ?? '',
    skillLevel: row.skill_level ?? 'guest',
    rating: row.rating ?? null,
    isFriend: row.is_friend ?? false,
    isGuest: row.is_guest,
    avatarColor: row.avatar_color ?? '#5c7480',
    seatOrder: row.seat_order,
    placement: row.placement,
  };
}

function toFriendRequest(row) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    fromUser: {
      id: row.from_user_id,
      name: row.from_name,
      username: row.from_username,
      friendCode: row.from_friend_code,
      rating: row.from_rating,
      avatarColor: row.from_avatar_color,
    },
    toUser: {
      id: row.to_user_id,
      name: row.to_name,
      username: row.to_username,
      friendCode: row.to_friend_code,
      rating: row.to_rating,
      avatarColor: row.to_avatar_color,
    },
  };
}

function oneOrMany(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function stripMarkup(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function takeWords(value, limit) {
  const words = stripMarkup(value).split(/\s+/).filter(Boolean);
  return words.slice(0, limit).join(' ');
}

function pickGeneratedArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizeGeneratedPlan(value, game) {
  const plan = value && typeof value === 'object' ? value : {};
  const rules = plan.rules && typeof plan.rules === 'object' ? plan.rules : {};
  const scenario =
    plan.scenario && typeof plan.scenario === 'object' ? plan.scenario : {};

  return {
    rules: {
      objective:
        String(rules.objective ?? '').trim() ||
        `Объяснить цель ${game.name} на основе карточки игры и BGG-описания.`,
      turnStructure: pickGeneratedArray(rules.turnStructure),
      keyRules: pickGeneratedArray(rules.keyRules),
      firstRoundWalkthrough: pickGeneratedArray(rules.firstRoundWalkthrough),
      commonMistakes: pickGeneratedArray(rules.commonMistakes),
    },
    scenario: {
      title:
        String(scenario.title ?? '').trim() || `Игровой вечер: ${game.name}`,
      setup:
        String(scenario.setup ?? '').trim() ||
        'Подготовь компоненты, объясни цель партии и проведи учебный фрагмент.',
      timeline: pickGeneratedArray(scenario.timeline),
      hostNotes: pickGeneratedArray(scenario.hostNotes),
    },
  };
}

async function fetchBggContext(game) {
  if (!game.bgg_id) {
    return null;
  }

  const response = await fetch(
    `https://boardgamegeek.com/xmlapi2/thing?id=${game.bgg_id}&stats=1`,
    {
      headers: {
        'User-Agent': 'MeepleScope/1.0 learning-generator',
        ...(process.env.BGG_API_TOKEN
          ? { Authorization: `Bearer ${process.env.BGG_API_TOKEN}` }
          : {}),
      },
    },
  );

  if (response.status === 202) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`BGG XML API returned ${response.status}`);
  }

  const parsed = xmlParser.parse(await response.text());
  const item = oneOrMany(parsed?.items?.item)[0];

  if (!item) {
    return null;
  }

  const links = oneOrMany(item.link);
  const names = oneOrMany(item.name);
  const primaryName =
    names.find((name) => name.type === 'primary')?.value ?? game.name;

  return {
    name: primaryName,
    description: takeWords(item.description, 420),
    mechanics: links
      .filter((link) => link.type === 'boardgamemechanic')
      .map((link) => link.value)
      .slice(0, 12),
    categories: links
      .filter((link) => link.type === 'boardgamecategory')
      .map((link) => link.value)
      .slice(0, 12),
    families: links
      .filter((link) => link.type === 'boardgamefamily')
      .map((link) => link.value)
      .slice(0, 8),
    minPlayers: item.minplayers?.value ?? game.min_players,
    maxPlayers: item.maxplayers?.value ?? game.max_players,
    playingTime: item.playingtime?.value ?? game.playing_time_max,
    minAge: item.minage?.value ?? game.min_age,
  };
}

function buildGenerationPrompt({ game, bggContext, theme, goal }) {
  const localDescription = takeWords(
    game.description || game.meta_description,
    300,
  );
  const themeText = theme
    ? `${theme.name}: ${theme.description}. Атмосфера: ${theme.vibe}. Плейлист/подача: ${theme.playlist_concept}.`
    : 'Тема вечера не задана: выбери формат сам по параметрам игры.';

  return `
Ты настольный игровой методист. Сгенерируй не рекламную карточку, а рабочее объяснение правил и сценарий вечера на русском языке.

Важно:
- Не выдумывай официальный текст правил и не цитируй rulebook.
- Используй только факты из входных данных: локальная PostgreSQL база и BGG XML API2.
- Если точного правила нет в данных, не придумывай компоненты, действия и условия победы. Формулируй как "объясни блок", "покажи пример решения" или "проверь в официальной книге правил", но всё равно дай полезный порядок обучения.
- Если BGG XML API2 контекст недоступен, опирайся только на локальное описание, механики, категории, количество игроков, время и сложность.
- Механики BGG — это ярлыки, а не список физических компонентов. Например, Card Drafting не означает, что в игре точно есть карты.
- Не добавляй тему, которой нет во входных данных: корабли, палубы, монстры, валюту, персонажей, карту мира и т.п.
- Если компоненты неизвестны, используй нейтральные слова: элементы, тайлы, жетоны, карты/поле только если они явно есть во входных данных.
- Цель партии формулируй безопасно: "набирать очки или добиваться победы через указанные механики", не придумывай конкретные победные условия.
- Ответ строго JSON без markdown.

Игра:
Название: ${game.name}
Год: ${game.year_published ?? 'не указан'}
Игроки: ${game.min_players}-${game.max_players}
Время: ${game.playing_time_min ?? 'не указано'}-${game.playing_time_max ?? 'не указано'} минут
Возраст: ${game.min_age ?? 'не указан'}+
Сложность BGG: ${game.bgg_weight ?? 'не указана'}/5
Рейтинг BGG: ${game.bgg_rating ?? 'не указан'}
Локальное описание: ${localDescription || 'нет'}

BGG XML API2 контекст:
${JSON.stringify(bggContext ?? { status: 'нет ответа или нет bgg_id' }, null, 2)}

Цель ведущего: ${goal || 'объяснить игру новым людям'}
Сценарий вечера: ${themeText}

Верни JSON такой формы:
{
  "rules": {
    "objective": "1-2 предложения о цели партии",
    "turnStructure": ["3-6 пунктов структуры хода или раунда"],
    "keyRules": ["4-8 ключевых блоков правил, которые нужно объяснить"],
    "firstRoundWalkthrough": ["3-6 шагов учебного первого раунда"],
    "commonMistakes": ["3-6 типичных ошибок и как их предотвратить"]
  },
  "scenario": {
    "title": "название сценария вечера",
    "setup": "как подготовить стол и людей",
    "timeline": ["4-7 таймблоков вечера с минутами"],
    "hostNotes": ["4-7 заметок ведущего"]
  }
}
`.trim();
}

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('AI response is not JSON');
    }

    return JSON.parse(match[0]);
  }
}

async function generateWithOllama(prompt) {
  const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b';
  const timeoutMs = readPositiveIntegerEnv('OLLAMA_TIMEOUT_MS', 240000);
  const numCtx = readPositiveIntegerEnv('OLLAMA_NUM_CTX', 3072);
  const numPredict = readPositiveIntegerEnv('OLLAMA_NUM_PREDICT', 900);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${host.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.1,
          num_ctx: numCtx,
          num_predict: numPredict,
        },
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      const error = new Error(message || `Ollama returned ${response.status}`);
      error.status = 503;
      throw error;
    }

    const body = await response.json();
    return {
      model,
      raw: body.response ?? '',
      parsed: parseJsonResponse(body.response ?? ''),
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(
        `Ollama generation timed out after ${Math.round(timeoutMs / 1000)} seconds. Попробуй модель меньше или увеличь OLLAMA_TIMEOUT_MS.`,
      );
      timeoutError.status = 503;
      throw timeoutError;
    }

    if (error.status) {
      throw error;
    }

    const wrapped = new Error(
      `Ollama недоступен. Запусти Ollama и скачай модель: ollama pull ${model}`,
    );
    wrapped.status = 503;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }
}

async function getActiveUserLobby(ownerUserId) {
  const existing = await pool.query(
    "SELECT * FROM lobbies WHERE owner_user_id = $1 AND status = 'draft' ORDER BY id LIMIT 1",
    [ownerUserId],
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const created = await pool.query(
    "INSERT INTO lobbies (owner_user_id, name, status) VALUES ($1, 'Игровой вечер', 'draft') RETURNING *",
    [ownerUserId],
  );
  return created.rows[0];
}

async function getLobbyState(ownerUserId) {
  const lobby = await getActiveUserLobby(ownerUserId);
  const lobbyView = await pool.query(
    `
      SELECT l.*, g.name AS game_name
      FROM lobbies l
      LEFT JOIN games g ON g.slug = l.game_slug
      WHERE l.id = $1
    `,
    [lobby.id],
  );
  const members = await pool.query(
    `
      SELECT
        lm.id,
        lm.lobby_id,
        lm.player_id,
        lm.user_id,
        COALESCE(u.name, p.name, lm.guest_name) AS name,
        COALESCE(u.city, p.city) AS city,
        COALESCE(u.skill_level, p.skill_level) AS skill_level,
        COALESCE(u.rating, p.rating) AS rating,
        CASE WHEN f.friend_user_id IS NOT NULL THEN true ELSE false END AS is_friend,
        COALESCE(u.avatar_color, p.avatar_color) AS avatar_color,
        lm.is_guest,
        lm.seat_order,
        lm.placement
      FROM lobby_members lm
      LEFT JOIN players p ON p.id = lm.player_id
      LEFT JOIN app_users u ON u.id = lm.user_id
      LEFT JOIN friendships f ON f.user_id = $2 AND f.friend_user_id = u.id
      WHERE lm.lobby_id = $1
      ORDER BY lm.seat_order ASC, lm.id ASC
    `,
    [lobby.id, ownerUserId],
  );
  const players = await pool.query(
    `
      SELECT u.*, true AS is_friend, false AS is_current_user, 'accepted' AS friendship_status
      FROM friendships f
      JOIN app_users u ON u.id = f.friend_user_id
      WHERE f.user_id = $1
      ORDER BY u.rating DESC, u.name ASC
    `,
    [ownerUserId],
  );

  return {
    lobby: toLobby(lobbyView.rows[0]),
    members: members.rows.map(toLobbyMember),
    availablePlayers: players.rows.map(toPlayer),
  };
}

app.get(
  '/',
  asyncRoute(async (_request, response) => {
    response.json({
      name: 'Meeple Scope PostgreSQL API',
      endpoints: [
        '/games',
        '/categories',
        '/mechanics',
        '/progressionPaths',
        '/gameNightThemes',
        '/tools',
        '/profile/me',
        '/profiles/1',
        '/reviews',
        '/auth/register',
        '/auth/login',
        '/auth/me',
        '/friend-requests',
        '/players',
        '/players/search?identifier=1000000001',
        '/lobby',
        '/ai/learning-plan',
        '/stats',
      ],
    });
  }),
);

app.post(
  '/auth/register',
  asyncRoute(async (request, response) => {
    const email = normalizeEmail(request.body.email);
    const password = String(request.body.password ?? '');

    if (!isValidEmail(email) || password.length < 6) {
      response.status(400).json({
        message:
          'Valid email and password with at least 6 characters are required',
      });
      return;
    }

    const existing = await pool.query(
      'SELECT 1 FROM app_users WHERE lower(email) = lower($1)',
      [email],
    );

    if (existing.rows[0]) {
      response.status(409).json({ message: 'Email already exists' });
      return;
    }

    const username = await buildUniqueUsername(email);
    const friendCode = await buildUniqueFriendCode();
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `
        INSERT INTO app_users (
          email, username, password_hash, name, city, skill_level,
          rating, games_played, wins, avatar_color, friend_code
        )
        VALUES ($1, $2, $3, $4, $5, $6, 1000, 0, 0, $7, $8)
        RETURNING *
      `,
      [
        email,
        username,
        passwordHash,
        String(request.body.name ?? '').trim() || buildNameFromEmail(email),
        request.body.city ?? '',
        request.body.skillLevel ?? 'casual',
        request.body.avatarColor ?? '#153d45',
        friendCode,
      ],
    );
    const token = await createSession(result.rows[0].id);

    response.status(201).json({ token, user: toAuthUser(result.rows[0]) });
  }),
);

app.post(
  '/auth/login',
  asyncRoute(async (request, response) => {
    const email = normalizeEmail(request.body.email ?? request.body.username);
    const password = String(request.body.password ?? '');
    const result = await pool.query(
      'SELECT * FROM app_users WHERE lower(email) = lower($1)',
      [email],
    );
    const user = result.rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      response.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const token = await createSession(user.id);
    response.json({ token, user: toAuthUser(user) });
  }),
);

app.get(
  '/auth/me',
  requireAuth(async (request, response) => {
    response.json(toAuthUser(request.authUser));
  }),
);

app.post(
  '/auth/logout',
  requireAuth(async (request, response) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [
      hashToken(token),
    ]);
    response.status(204).send();
  }),
);

app.get(
  '/friend-requests',
  requireAuth(async (request, response) => {
    const result = await pool.query(
      `
        SELECT
          fr.*,
          from_user.name AS from_name,
          from_user.username AS from_username,
          from_user.friend_code AS from_friend_code,
          from_user.rating AS from_rating,
          from_user.avatar_color AS from_avatar_color,
          to_user.name AS to_name,
          to_user.username AS to_username,
          to_user.friend_code AS to_friend_code,
          to_user.rating AS to_rating,
          to_user.avatar_color AS to_avatar_color
        FROM friend_requests fr
        JOIN app_users from_user ON from_user.id = fr.from_user_id
        JOIN app_users to_user ON to_user.id = fr.to_user_id
        WHERE (fr.from_user_id = $1 OR fr.to_user_id = $1)
          AND fr.status = 'pending'
        ORDER BY fr.created_at DESC
      `,
      [request.authUser.id],
    );

    response.json({
      incoming: result.rows
        .filter((requestRow) => requestRow.to_user_id === request.authUser.id)
        .map(toFriendRequest),
      outgoing: result.rows
        .filter((requestRow) => requestRow.from_user_id === request.authUser.id)
        .map(toFriendRequest),
    });
  }),
);

app.post(
  '/friend-requests',
  requireAuth(async (request, response) => {
    const friendCode = String(request.body.friendCode ?? '')
      .trim()
      .toUpperCase();
    const targetResult = await pool.query(
      'SELECT * FROM app_users WHERE upper(friend_code) = $1',
      [friendCode],
    );
    const target = targetResult.rows[0];

    if (!target) {
      response.status(404).json({ message: 'User not found by identifier' });
      return;
    }

    if (target.id === request.authUser.id) {
      response.status(400).json({ message: 'You cannot add yourself' });
      return;
    }

    const existingFriendship = await pool.query(
      'SELECT 1 FROM friendships WHERE user_id = $1 AND friend_user_id = $2',
      [request.authUser.id, target.id],
    );

    if (existingFriendship.rows[0]) {
      response.status(409).json({ message: 'Already friends' });
      return;
    }

    const existingPending = await pool.query(
      `
        SELECT id FROM friend_requests
        WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'
      `,
      [request.authUser.id, target.id],
    );

    if (existingPending.rows[0]) {
      response.status(409).json({ message: 'Request already pending' });
      return;
    }

    const reversePending = await pool.query(
      `
        SELECT id FROM friend_requests
        WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'
      `,
      [target.id, request.authUser.id],
    );

    if (reversePending.rows[0]) {
      response
        .status(409)
        .json({ message: 'This user already sent you a request' });
      return;
    }

    const created = await pool.query(
      `
        INSERT INTO friend_requests (from_user_id, to_user_id, status)
        VALUES ($1, $2, 'pending')
        RETURNING id
      `,
      [request.authUser.id, target.id],
    );

    response.status(201).json({ id: created.rows[0].id });
  }),
);

app.patch(
  '/friend-requests/:id',
  requireAuth(async (request, response) => {
    const status = request.body.status;

    if (status !== 'accepted' && status !== 'declined') {
      response
        .status(400)
        .json({ message: 'Status must be accepted or declined' });
      return;
    }

    const requestResult = await pool.query(
      `
        SELECT * FROM friend_requests
        WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
      `,
      [Number(request.params.id), request.authUser.id],
    );
    const friendRequest = requestResult.rows[0];

    if (!friendRequest) {
      response.status(404).json({ message: 'Pending request not found' });
      return;
    }

    await pool.query('BEGIN');
    try {
      await pool.query(
        `
          UPDATE friend_requests
          SET status = $1, responded_at = now()
          WHERE id = $2
        `,
        [status, friendRequest.id],
      );

      if (status === 'accepted') {
        await pool.query(
          `
            INSERT INTO friendships (user_id, friend_user_id)
            VALUES ($1, $2), ($2, $1)
            ON CONFLICT DO NOTHING
          `,
          [friendRequest.from_user_id, friendRequest.to_user_id],
        );
      }

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

    response.json({ status });
  }),
);

app.get(
  '/players',
  asyncRoute(async (request, response) => {
    const user = await readAuthUser(request);
    const result = await pool.query(
      `
        SELECT
          u.*,
          CASE WHEN f.friend_user_id IS NOT NULL THEN true ELSE false END AS is_friend,
          CASE WHEN u.id = $1 THEN true ELSE false END AS is_current_user,
          CASE
            WHEN u.id = $1 THEN 'self'
            WHEN f.friend_user_id IS NOT NULL THEN 'accepted'
            WHEN outgoing.id IS NOT NULL THEN 'outgoing'
            WHEN incoming.id IS NOT NULL THEN 'incoming'
            ELSE 'none'
          END AS friendship_status
        FROM app_users u
        LEFT JOIN friendships f ON f.user_id = $1 AND f.friend_user_id = u.id
        LEFT JOIN friend_requests outgoing
          ON outgoing.from_user_id = $1 AND outgoing.to_user_id = u.id AND outgoing.status = 'pending'
        LEFT JOIN friend_requests incoming
          ON incoming.from_user_id = u.id AND incoming.to_user_id = $1 AND incoming.status = 'pending'
        ORDER BY u.rating DESC, u.wins DESC, u.name ASC
      `,
      [user?.id ?? 0],
    );
    response.json(result.rows.map(toPlayer));
  }),
);

app.get(
  '/players/search',
  requireAuth(async (request, response) => {
    const identifier = String(request.query.identifier ?? '')
      .trim()
      .toUpperCase();

    if (!identifier) {
      response.status(400).json({ message: 'Identifier is required' });
      return;
    }

    const result = await pool.query(
      `
        SELECT
          u.*,
          CASE WHEN f.friend_user_id IS NOT NULL THEN true ELSE false END AS is_friend,
          CASE WHEN u.id = $1 THEN true ELSE false END AS is_current_user,
          CASE
            WHEN u.id = $1 THEN 'self'
            WHEN f.friend_user_id IS NOT NULL THEN 'accepted'
            WHEN outgoing.id IS NOT NULL THEN 'outgoing'
            WHEN incoming.id IS NOT NULL THEN 'incoming'
            ELSE 'none'
          END AS friendship_status
        FROM app_users u
        LEFT JOIN friendships f ON f.user_id = $1 AND f.friend_user_id = u.id
        LEFT JOIN friend_requests outgoing
          ON outgoing.from_user_id = $1 AND outgoing.to_user_id = u.id AND outgoing.status = 'pending'
        LEFT JOIN friend_requests incoming
          ON incoming.from_user_id = u.id AND incoming.to_user_id = $1 AND incoming.status = 'pending'
        WHERE upper(u.friend_code) = $2
      `,
      [request.authUser.id, identifier],
    );

    if (!result.rows[0]) {
      response.status(404).json({ message: 'Player not found' });
      return;
    }

    response.json(toPlayer(result.rows[0]));
  }),
);

app.get(
  '/lobby',
  requireAuth(async (request, response) => {
    response.json(await getLobbyState(request.authUser.id));
  }),
);

app.patch(
  '/lobby',
  requireAuth(async (request, response) => {
    const lobby = await getActiveUserLobby(request.authUser.id);
    const gameSlug = String(request.body.gameSlug ?? '').trim();

    if (!gameSlug) {
      await pool.query('UPDATE lobbies SET game_slug = NULL WHERE id = $1', [
        lobby.id,
      ]);
      response.json(await getLobbyState(request.authUser.id));
      return;
    }

    const game = await pool.query('SELECT slug FROM games WHERE slug = $1', [
      gameSlug,
    ]);

    if (!game.rows[0]) {
      response.status(404).json({ message: 'Game not found' });
      return;
    }

    await pool.query('UPDATE lobbies SET game_slug = $1 WHERE id = $2', [
      gameSlug,
      lobby.id,
    ]);

    response.json(await getLobbyState(request.authUser.id));
  }),
);

app.post(
  '/lobby/members',
  requireAuth(async (request, response) => {
    const lobby = await getActiveUserLobby(request.authUser.id);
    const seatResult = await pool.query(
      'SELECT COALESCE(MAX(seat_order), 0) + 1 AS next_seat FROM lobby_members WHERE lobby_id = $1',
      [lobby.id],
    );
    const playerId = request.body.playerId
      ? Number(request.body.playerId)
      : null;
    const guestName = request.body.name?.trim() || null;

    if (!playerId && !guestName) {
      response
        .status(400)
        .json({ message: 'Player or guest name is required' });
      return;
    }

    if (playerId) {
      const friendship = await pool.query(
        'SELECT 1 FROM friendships WHERE user_id = $1 AND friend_user_id = $2',
        [request.authUser.id, playerId],
      );

      if (!friendship.rows[0]) {
        response
          .status(403)
          .json({ message: 'Only accepted friends can be invited' });
        return;
      }

      const duplicate = await pool.query(
        'SELECT id FROM lobby_members WHERE lobby_id = $1 AND user_id = $2',
        [lobby.id, playerId],
      );

      if (duplicate.rows[0]) {
        response.status(409).json({ message: 'Player is already in lobby' });
        return;
      }
    }

    await pool.query(
      `
        INSERT INTO lobby_members (
          lobby_id, user_id, guest_name, is_guest, seat_order
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        lobby.id,
        playerId,
        playerId ? null : guestName,
        !playerId,
        seatResult.rows[0].next_seat,
      ],
    );

    response.status(201).json(await getLobbyState(request.authUser.id));
  }),
);

app.delete(
  '/lobby/members/:id',
  requireAuth(async (request, response) => {
    const lobby = await getActiveUserLobby(request.authUser.id);
    await pool.query(
      'DELETE FROM lobby_members WHERE id = $1 AND lobby_id = $2',
      [Number(request.params.id), lobby.id],
    );
    response.status(204).send();
  }),
);

app.patch(
  '/lobby/members/:id',
  requireAuth(async (request, response) => {
    const lobby = await getActiveUserLobby(request.authUser.id);
    const placement =
      request.body.placement === null || request.body.placement === ''
        ? null
        : Number(request.body.placement);

    if (placement !== null && (!Number.isInteger(placement) || placement < 1)) {
      response.status(400).json({ message: 'Placement must be a positive number' });
      return;
    }

    await pool.query(
      'UPDATE lobby_members SET placement = $1 WHERE id = $2 AND lobby_id = $3',
      [placement, Number(request.params.id), lobby.id],
    );

    response.json(await getLobbyState(request.authUser.id));
  }),
);

app.get(
  '/lobby/reviews',
  requireAuth(async (request, response) => {
    const lobby = await getActiveUserLobby(request.authUser.id);
    const result = await pool.query(
      'SELECT * FROM reviews WHERE lobby_id = $1 ORDER BY played_at DESC, id DESC',
      [lobby.id],
    );

    response.json(result.rows.map(toReview));
  }),
);

app.post(
  '/lobby/reviews',
  requireAuth(async (request, response) => {
    const lobby = await getActiveUserLobby(request.authUser.id);
    const lobbyGame = await pool.query(
      `
        SELECT l.id, l.game_slug, g.name AS game_name
        FROM lobbies l
        LEFT JOIN games g ON g.slug = l.game_slug
        WHERE l.id = $1
      `,
      [lobby.id],
    );
    const game = lobbyGame.rows[0];

    if (!game?.game_slug || !game?.game_name) {
      response.status(400).json({ message: 'Choose a game before saving a session' });
      return;
    }

    const members = await pool.query(
      'SELECT COUNT(*)::int AS count FROM lobby_members WHERE lobby_id = $1',
      [lobby.id],
    );
    const result = await pool.query(
      `
        INSERT INTO reviews (
          lobby_id, game_slug, game_name, title, rating, session_mood,
          notes, would_replay, played_at, players_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        lobby.id,
        game.game_slug,
        game.game_name,
        request.body.title,
        request.body.rating,
        request.body.sessionMood ?? '',
        request.body.notes ?? '',
        request.body.wouldReplay ?? true,
        request.body.playedAt,
        members.rows[0].count || 1,
      ],
    );

    response.status(201).json(toReview(result.rows[0]));
  }),
);

app.post(
  '/ai/learning-plan',
  asyncRoute(async (request, response) => {
    const slug = String(request.body.slug ?? '').trim();
    const goal = String(request.body.goal ?? '').trim();
    const themeSlug = String(request.body.themeSlug ?? '').trim();

    if (!slug) {
      response.status(400).json({ message: 'Game slug is required' });
      return;
    }

    const gameResult = await pool.query('SELECT * FROM games WHERE slug = $1', [
      slug,
    ]);
    const gameRow = gameResult.rows[0];

    if (!gameRow) {
      response.status(404).json({ message: 'Game not found' });
      return;
    }

    const themeResult =
      themeSlug && themeSlug !== 'any'
        ? await pool.query('SELECT * FROM game_night_themes WHERE slug = $1', [
            themeSlug,
          ])
        : { rows: [] };
    const game = toGame(gameRow);
    const theme = themeResult.rows[0]
      ? toGameNightTheme(themeResult.rows[0])
      : null;
    const bggContext = await fetchBggContext(game).catch((error) => ({
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'BGG context failed',
    }));
    const prompt = buildGenerationPrompt({
      game,
      bggContext,
      theme,
      goal,
    });
    const generated = await generateWithOllama(prompt);
    const plan = sanitizeGeneratedPlan(generated.parsed, game);

    response.json({
      provider: 'ollama',
      model: generated.model,
      gameSlug: slug,
      generatedAt: new Date().toISOString(),
      usedBgg:
        Boolean(bggContext) &&
        typeof bggContext === 'object' &&
        bggContext.status !== 'unavailable',
      sources: [
        'PostgreSQL local catalog',
        Boolean(bggContext) &&
        typeof bggContext === 'object' &&
        bggContext.status !== 'unavailable'
          ? `BoardGameGeek XML API2 thing?id=${game.bgg_id}`
          : 'BoardGameGeek XML API2 unavailable; local catalog used',
        `Ollama model ${generated.model}`,
      ],
      ...plan,
    });
  }),
);

app.get(
  '/games',
  asyncRoute(async (request, response) => {
    const where = [];
    const values = [];

    if (typeof request.query.slug === 'string') {
      values.push(request.query.slug);
      where.push(`slug = $${values.length}`);
    }

    const featured = parseBoolean(request.query.is_featured);
    if (featured !== null) {
      values.push(featured);
      where.push(`is_featured = $${values.length}`);
    }

    const expansion = parseBoolean(request.query.is_expansion);
    if (expansion !== null) {
      values.push(expansion);
      where.push(`is_expansion = $${values.length}`);
    }

    if (typeof request.query.q === 'string' && request.query.q.trim()) {
      values.push(`%${request.query.q.trim().toLowerCase()}%`);
      where.push(`lower(name) LIKE $${values.length}`);
    }

    const players = Number(request.query.players);
    if (Number.isFinite(players) && players > 0) {
      values.push(players);
      where.push(
        `min_players <= $${values.length} AND max_players >= $${values.length}`,
      );
    }

    const maxDuration = Number(request.query.maxDuration);
    if (Number.isFinite(maxDuration) && maxDuration > 0) {
      values.push(maxDuration);
      where.push(
        `COALESCE(playing_time_max, playing_time_min, 999999) <= $${values.length}`,
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortField =
      request.query._sort === 'rank' || request.query._sort === 'bgg_rank'
        ? 'rank'
        : 'name';
    const orderSql =
      sortField === 'rank'
        ? 'ORDER BY bgg_rank NULLS LAST, lower(name) ASC'
        : 'ORDER BY lower(name) ASC, name ASC';
    const page = Number(request.query._page);
    const perPage = Number(
      request.query._per_page ?? request.query._limit ?? 20,
    );

    if (Number.isFinite(page) && page > 0) {
      const safePerPage =
        Number.isFinite(perPage) && perPage > 0 ? perPage : 20;
      const offset = (page - 1) * safePerPage;
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM games ${whereSql}`,
        values,
      );
      const result = await pool.query(
        `SELECT * FROM games ${whereSql} ${orderSql} LIMIT $${values.length + 1} OFFSET $${
          values.length + 2
        }`,
        [...values, safePerPage, offset],
      );
      const items = countResult.rows[0].count;
      const pages = Math.max(1, Math.ceil(items / safePerPage));

      response.json({
        first: 1,
        prev: page > 1 ? page - 1 : null,
        next: page < pages ? page + 1 : null,
        last: pages,
        pages,
        items,
        data: result.rows.map(toGame),
      });
      return;
    }

    const result = await pool.query(
      `SELECT * FROM games ${whereSql} ${orderSql}`,
      values,
    );
    response.json(result.rows.map(toGame));
  }),
);

app.get(
  '/games/:slug',
  asyncRoute(async (request, response) => {
    const result = await pool.query('SELECT * FROM games WHERE slug = $1', [
      request.params.slug,
    ]);

    if (!result.rows[0]) {
      response.status(404).json({ message: 'Game not found' });
      return;
    }

    response.json(toGame(result.rows[0]));
  }),
);

app.get(
  '/categories',
  asyncRoute(async (_request, response) => {
    const result = await pool.query(
      'SELECT * FROM categories ORDER BY game_count DESC, name',
    );
    response.json(result.rows);
  }),
);

app.get(
  '/mechanics',
  asyncRoute(async (_request, response) => {
    const result = await pool.query(
      'SELECT * FROM mechanics ORDER BY game_count DESC, name',
    );
    response.json(result.rows);
  }),
);

app.get(
  '/progressionPaths',
  asyncRoute(async (_request, response) => {
    const result = await pool.query(
      'SELECT * FROM progression_paths ORDER BY slug',
    );
    response.json(result.rows.map(toProgressionPath));
  }),
);

app.get(
  '/gameNightThemes',
  asyncRoute(async (_request, response) => {
    const result = await pool.query(
      'SELECT * FROM game_night_themes ORDER BY slug',
    );
    response.json(result.rows.map(toGameNightTheme));
  }),
);

app.get(
  '/tools',
  asyncRoute(async (_request, response) => {
    const result = await pool.query('SELECT * FROM tools ORDER BY slug');
    response.json(result.rows.map(toTool));
  }),
);

app.get(
  '/localCatalogMeta',
  asyncRoute(async (_request, response) => {
    const result = await pool.query(
      'SELECT * FROM local_catalog_meta ORDER BY id',
    );
    response.json(result.rows.map(toLocalCatalogMeta));
  }),
);

app.get(
  '/stats',
  asyncRoute(async (_request, response) => {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM games) AS games,
        (SELECT COUNT(*)::int FROM mechanics) AS mechanics,
        (SELECT COUNT(*)::int FROM categories) AS categories,
        (SELECT COUNT(*)::int FROM progression_paths) AS progression_paths,
        (SELECT COUNT(*)::int FROM game_night_themes) AS game_night_themes,
        (SELECT COUNT(*)::int FROM tools) AS tools
    `);

    response.json({
      publishers: 0,
      designers: 0,
      artists: 0,
      awards: 0,
      terms: 0,
      guide_series: 0,
      guides: 0,
      faqs: 0,
      ...result.rows[0],
    });
  }),
);

app.get(
  '/profile/me',
  requireAuth(async (request, response) => {
    response.json(toProfile(await getOrCreateProfile(request.authUser)));
  }),
);

app.patch(
  '/profile/me',
  requireAuth(async (request, response) => {
    await getOrCreateProfile(request.authUser);

    const fieldMap = {
      name: 'name',
      city: 'city',
      experienceLevel: 'experience_level',
      preferredPlayers: 'preferred_players',
      maxPlayTime: 'max_play_time',
      bio: 'bio',
      favoriteGenres: 'favorite_genres',
    };
    const entries = Object.entries(fieldMap).filter(([clientField]) =>
      Object.hasOwn(request.body, clientField),
    );

    if (!entries.length) {
      response.json(toProfile(await getOrCreateProfile(request.authUser)));
      return;
    }

    const values = entries.map(([clientField]) => request.body[clientField]);
    values.push(request.authUser.id);
    const assignments = entries
      .map(([, column], index) => `${column} = $${index + 1}`)
      .join(', ');
    const result = await pool.query(
      `UPDATE profiles SET ${assignments} WHERE id = $${values.length} RETURNING *`,
      values,
    );

    response.json(toProfile(result.rows[0]));
  }),
);

app.get(
  '/profiles/:id',
  asyncRoute(async (request, response) => {
    const result = await pool.query('SELECT * FROM profiles WHERE id = $1', [
      Number(request.params.id),
    ]);

    if (!result.rows[0]) {
      response.status(404).json({ message: 'Profile not found' });
      return;
    }

    response.json(toProfile(result.rows[0]));
  }),
);

app.patch(
  '/profiles/:id',
  asyncRoute(async (request, response) => {
    const fieldMap = {
      name: 'name',
      city: 'city',
      experienceLevel: 'experience_level',
      preferredPlayers: 'preferred_players',
      maxPlayTime: 'max_play_time',
      bio: 'bio',
      favoriteGenres: 'favorite_genres',
    };
    const entries = Object.entries(fieldMap).filter(([clientField]) =>
      Object.hasOwn(request.body, clientField),
    );

    if (!entries.length) {
      const current = await pool.query('SELECT * FROM profiles WHERE id = $1', [
        Number(request.params.id),
      ]);
      response.json(toProfile(current.rows[0]));
      return;
    }

    const values = entries.map(([clientField]) => request.body[clientField]);
    values.push(Number(request.params.id));
    const assignments = entries
      .map(([, column], index) => `${column} = $${index + 1}`)
      .join(', ');
    const result = await pool.query(
      `UPDATE profiles SET ${assignments} WHERE id = $${values.length} RETURNING *`,
      values,
    );

    if (!result.rows[0]) {
      response.status(404).json({ message: 'Profile not found' });
      return;
    }

    response.json(toProfile(result.rows[0]));
  }),
);

app.get(
  '/reviews',
  asyncRoute(async (request, response) => {
    const sortField = request.query._sort === 'playedAt' ? 'played_at' : 'id';
    const sortOrder = request.query._order === 'asc' ? 'ASC' : 'DESC';
    const result = await pool.query(
      `SELECT * FROM reviews ORDER BY ${sortField} ${sortOrder}, id DESC`,
    );

    response.json(result.rows.map(toReview));
  }),
);

app.post(
  '/reviews',
  asyncRoute(async (request, response) => {
    const result = await pool.query(
      `
        INSERT INTO reviews (
          lobby_id, game_slug, game_name, title, rating, session_mood,
          notes, would_replay, played_at, players_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        request.body.lobbyId ?? null,
        request.body.gameSlug,
        request.body.gameName,
        request.body.title,
        request.body.rating,
        request.body.sessionMood ?? '',
        request.body.notes ?? '',
        request.body.wouldReplay ?? true,
        request.body.playedAt,
        request.body.playersCount ?? 1,
      ],
    );

    response.status(201).json(toReview(result.rows[0]));
  }),
);

app.put(
  '/reviews/:id',
  asyncRoute(async (request, response) => {
    const result = await pool.query(
      `
        UPDATE reviews
        SET
          game_slug = $1,
          game_name = $2,
          title = $3,
          rating = $4,
          session_mood = $5,
          notes = $6,
          would_replay = $7,
          played_at = $8,
          players_count = $9,
          lobby_id = $10
        WHERE id = $11
        RETURNING *
      `,
      [
        request.body.gameSlug,
        request.body.gameName,
        request.body.title,
        request.body.rating,
        request.body.sessionMood ?? '',
        request.body.notes ?? '',
        request.body.wouldReplay ?? true,
        request.body.playedAt,
        request.body.playersCount ?? 1,
        request.body.lobbyId ?? null,
        Number(request.params.id),
      ],
    );

    if (!result.rows[0]) {
      response.status(404).json({ message: 'Review not found' });
      return;
    }

    response.json(toReview(result.rows[0]));
  }),
);

app.delete(
  '/reviews/:id',
  asyncRoute(async (request, response) => {
    await pool.query('DELETE FROM reviews WHERE id = $1', [
      Number(request.params.id),
    ]);
    response.status(204).send();
  }),
);

registerGameRoutes(app, { pool, readAuthUser });

app.use((error, _request, response, _next) => {
  void _next;
  console.error(error);
  response
    .status(error.status && Number.isInteger(error.status) ? error.status : 500)
    .json({
      message: error instanceof Error ? error.message : 'Internal server error',
    });
});

server.listen(port, () => {
  console.log(`Meeple Scope PostgreSQL API: http://localhost:${port}`);
});
