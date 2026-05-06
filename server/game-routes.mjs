import { randomInt, randomUUID } from 'node:crypto';
import { AiGameMasterService } from './ai-game-master.mjs';
import { findAvailableGame, getEnabledGames } from './available-games.mjs';
import {
  CharacterSchema,
  ChoiceSchema,
  CreateCharacterSchema,
  MapPatchSchema,
  MapStateSchema,
  StatePatchSchema,
} from './game-schemas.mjs';

const MAX_THEME_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 1600;
const MAX_REVISION_WISH_LENGTH = 1000;
const MAX_AI_PARSE_RETRIES = 3;
const ALLOWED_COMMANDS = new Set([
  '/state',
  '/character',
  '/quests',
  '/turns',
  '/recap',
  '/map',
  '/inventory',
  '/help',
  '/roll',
  '/dice',
]);

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /забудь\s+(все\s+)?инструкц/i,
  /покажи\s+(system|системн).*prompt/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /system\s+message/i,
  /hidden\s+prompt/i,
  /hidden_gm/i,
  /раскрой\s+скрыт/i,
  /скрыт(ые|ую|ый)\s+замет/i,
  /измени\s+json/i,
  /перепиши\s+состояни/i,
  /state_patch/i,
  /<\s*state_patch/i,
  /сделай\s+меня\s+побед/i,
  /теперь\s+ты\s+(другой|не)\s+/i,
  /не\s+следуй\s+правил/i,
  /ignore\s+constraints/i,
  /reveal\s+(the\s+)?(hidden|secret|system)/i,
];

function makeHttpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asyncRoute(handler) {
  return async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      next(error);
    }
  };
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => normalizeString(value)).filter(Boolean))];
}

function isSessionOwner(publicState, playerId) {
  return String(publicState?.owner_player_id ?? '') === String(playerId ?? '');
}

function canUseSession(publicState, playerId) {
  const id = String(playerId ?? '');
  const participantIds = Array.isArray(publicState?.participant_player_ids)
    ? publicState.participant_player_ids.map(String)
    : [];

  return isSessionOwner(publicState, id) || participantIds.includes(id);
}

async function resolveInvitedPlayers(pool, rawPlayers, ownerPlayerId) {
  const values = uniqueStrings(
    Array.isArray(rawPlayers)
      ? rawPlayers
      : String(rawPlayers ?? '').split(/[,\n]+/),
  ).slice(0, 8);
  const players = [];
  const missing = [];

  for (const value of values) {
    const result = await pool.query(
      `
        SELECT id::text AS id, name, username, email, friend_code
        FROM app_users
        WHERE
          id::text = $1
          OR
          lower(email) = lower($1)
          OR lower(username) = lower($1)
          OR lower(name) = lower($1)
          OR upper(friend_code) = upper($1)
        LIMIT 1
      `,
      [value],
    );
    const player = result.rows[0];

    if (!player) {
      missing.push(value);
      continue;
    }

    if (String(player.id) !== String(ownerPlayerId)) {
      players.push({
        id: String(player.id),
        name: player.name,
        username: player.username,
        role: 'Игрок',
      });
    }
  }

  const seen = new Set();
  return {
    players: players.filter((player) => {
      if (seen.has(player.id)) {
        return false;
      }
      seen.add(player.id);
      return true;
    }),
    missing,
  };
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

function getCommandName(content) {
  const [command = ''] = normalizeString(content).toLowerCase().split(/\s+/);
  return command;
}

function parseDiceExpression(expression = '1d20') {
  const cleaned = normalizeString(expression || '1d20').toLowerCase();
  const match = cleaned.match(/^(\d*)d(\d+)([+-]\d+)?$/);

  if (!match) {
    throw makeHttpError(
      'Неверная формула кубиков. Используй формат вроде d20, 2d6 или 1d20+3.',
      400,
    );
  }

  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const modifier = Number(match[3] || 0);

  if (
    !Number.isInteger(count) ||
    !Number.isInteger(sides) ||
    !Number.isInteger(modifier) ||
    count < 1 ||
    count > 20 ||
    sides < 2 ||
    sides > 1000 ||
    Math.abs(modifier) > 1000
  ) {
    throw makeHttpError(
      'Формула кубиков вне лимитов. Максимум 20 кубиков, d1000, модификатор до +/-1000.',
      400,
    );
  }

  return {
    expression: `${count}d${sides}${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''}`,
    count,
    sides,
    modifier,
  };
}

function rollDice(expression = '1d20', reason = 'manual') {
  const parsed = parseDiceExpression(expression);
  const rolls = Array.from({ length: parsed.count }, () =>
    randomInt(1, parsed.sides + 1),
  );
  const total = rolls.reduce((sum, value) => sum + value, 0) + parsed.modifier;

  return {
    id: randomUUID(),
    reason,
    expression: parsed.expression,
    count: parsed.count,
    sides: parsed.sides,
    modifier: parsed.modifier,
    rolls,
    total,
    created_at: new Date().toISOString(),
  };
}

function formatDiceRoll(roll, actorName = 'Персонаж') {
  const modifierText =
    roll.modifier === 0
      ? ''
      : ` ${roll.modifier > 0 ? '+' : '-'} ${Math.abs(roll.modifier)}`;

  return [
    `Кубики: ${actorName} бросает ${roll.expression}`,
    `Выпало: ${roll.rolls.join(', ')}${modifierText}`,
    `Итог: ${roll.total}`,
  ].join('\n');
}

function detectPromptInjection(content) {
  const text = normalizeString(content);
  const matched = INJECTION_PATTERNS.find((pattern) => pattern.test(text));

  if (matched) {
    return matched.source;
  }

  if (
    /[{[]/.test(text) &&
    /(hp_current|current_actor_id|hidden_gm_state|public_state_json|inventory_json)/i.test(
      text,
    )
  ) {
    return 'direct-state-json';
  }

  return null;
}

function isAllowedCommand(content) {
  return ALLOWED_COMMANDS.has(getCommandName(content));
}

function isUnknownCommand(content) {
  const text = normalizeString(content);
  return text.startsWith('/') && !ALLOWED_COMMANDS.has(getCommandName(text));
}

function isSpeechOnly(content) {
  return /^(["'«“—-]|говорю\b|скажу\b|шепчу\b|кричу\b|спрашиваю\b|отвечаю\b|реплика\s*:)/i.test(
    normalizeString(content),
  );
}

function toPublicNpc(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    personality: row.personality,
    goal: row.goal,
    knows: row.knows_json ?? [],
    attitude: row.attitude,
    location_id: row.location_id,
    x: Number(row.x),
    y: Number(row.y),
    visible_to_players: row.visible_to_players,
    state: row.state_json ?? {},
  };
}

function toPublicQuest(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    known_to_players: row.known_to_players,
    state: row.state_json ?? {},
  };
}

function toMessage(row) {
  return {
    id: row.id,
    session_id: row.session_id,
    player_id: row.player_id,
    character_id: row.character_id,
    role: row.role,
    content: row.content,
    visible_to_players: row.visible_to_players,
    created_at: row.created_at,
  };
}

function toTurn(row) {
  return {
    id: row.id,
    round: row.round,
    actor_id: row.actor_id,
    actor_type: row.actor_type,
    turn_index: row.turn_index,
    is_current: row.is_current,
    has_acted: row.has_acted,
  };
}

function distanceBetweenPoints(a, b) {
  const dx = Number(a.x ?? 0) - Number(b.x ?? 0);
  const dy = Number(a.y ?? 0) - Number(b.y ?? 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function buildFallbackRoutes(locations) {
  const visibleLocations = locations.filter(
    (location) => location.visible_to_players,
  );

  if (visibleLocations.length < 2) {
    return [];
  }

  return visibleLocations.slice(0, -1).map((location, index) => {
    const nextLocation = visibleLocations[index + 1];
    const distance = distanceBetweenPoints(location, nextLocation);
    const dangerLevel = Math.max(
      Number(location.danger_level ?? 1),
      Number(nextLocation.danger_level ?? 1),
    );

    return {
      id: `route_${location.id}_${nextLocation.id}`,
      from: location.id,
      to: nextLocation.id,
      name: `${location.name} -> ${nextLocation.name}`,
      travel_time: `${Math.max(1, Math.round(distance / 260))} ч.`,
      danger_level: dangerLevel,
      visible_to_players: true,
    };
  });
}

function classifyNpcToken(npc) {
  const text = `${npc.role ?? ''} ${npc.attitude ?? ''} ${npc.name ?? ''}`;

  return /враг|enemy|monster|bandit|бандит|культ|зомби|твар|чудовищ|солдат|страж/i.test(
    text,
  )
    ? 'enemy'
    : 'npc';
}

function buildVisibleMap(mapRow, stateMap, characters, npcs) {
  if (!mapRow) {
    return null;
  }

  const base = MapStateSchema.parse({
    ...(stateMap ?? {}),
    map_id: mapRow.id,
    name: stateMap?.name ?? mapRow.name,
    image_url: stateMap?.image_url ?? mapRow.image_url,
    width: stateMap?.width ?? mapRow.width,
    height: stateMap?.height ?? mapRow.height,
    grid: stateMap?.grid ?? {
      enabled: mapRow.grid_enabled,
      cell_size: mapRow.grid_cell_size,
      type: 'square',
    },
    fog_of_war: stateMap?.fog_of_war ?? mapRow.fog_of_war,
    map_type: stateMap?.map_type ?? mapRow.map_type,
    visual_style: stateMap?.visual_style ?? mapRow.state_json?.visual_style,
  });

  const locationTokens = base.tokens.filter(
    (token) =>
      token.type !== 'player' && token.type !== 'npc' && token.type !== 'enemy',
  );
  const characterTokens = characters.map((character) => ({
    id: character.id,
    type: 'player',
    name: character.name,
    x: character.x,
    y: character.y,
    visible: character.is_active,
    hp_current: character.hp_current,
    hp_max: character.hp_max,
    location_id: character.location_id,
    status_effects: character.status_effects,
  }));
  const npcTokens = npcs
    .filter((npc) => npc.visible_to_players)
    .map((npc) => ({
      id: npc.id,
      type: classifyNpcToken(npc),
      name: npc.name,
      x: npc.x,
      y: npc.y,
      visible: true,
      hp_current: npc.state?.hp_current,
      hp_max: npc.state?.hp_max,
      role: npc.role,
      attitude: npc.attitude,
      location_id: npc.location_id,
    }));

  return {
    ...base,
    routes: Array.isArray(base.routes) && base.routes.length
      ? base.routes.filter((route) => route.visible_to_players !== false)
      : buildFallbackRoutes(base.locations),
    areas: Array.isArray(base.areas)
      ? base.areas.filter((area) => area.visible_to_players !== false)
      : [],
    objects: Array.isArray(base.objects)
      ? base.objects.filter((object) => object.visible_to_players !== false)
      : [],
    tokens: [...locationTokens, ...characterTokens, ...npcTokens],
  };
}

function normalizeCharacterPayload(character, fallbackId = null) {
  const normalized = CharacterSchema.parse({
    ...character,
    id: character.id || fallbackId || `char_${randomUUID().slice(0, 12)}`,
  });
  const derived = {
    hp_current: normalized.derived?.hp_current ?? normalized.derived?.hp_max ?? 10,
    hp_max: normalized.derived?.hp_max ?? normalized.derived?.hp_current ?? 10,
    armor: normalized.derived?.armor ?? 0,
    initiative: normalized.derived?.initiative ?? 0,
    movement: normalized.derived?.movement ?? 6,
  };

  return withCharacterFate({
    ...normalized,
    derived,
    resources: {
      reroll_points: normalized.resources?.reroll_points ?? 2,
      ...(normalized.resources ?? {}),
    },
  });
}

function characterStatsStorage(character) {
  return {
    origin: character.origin,
    description: character.description,
    stats: character.stats,
    derived: character.derived,
    resources: character.resources,
    skills: character.skills,
    is_player_character: character.is_player_character,
  };
}

function withCharacterFate(character) {
  const hpCurrent = Number(
    character.derived?.hp_current ?? character.hp_current ?? character.hp_max ?? 10,
  );
  const existingStatuses = Array.isArray(character.status_effects)
    ? character.status_effects
    : [];
  const alreadyMarked = existingStatuses.some((status) => {
    const text =
      typeof status === 'string'
        ? status
        : `${status?.id ?? ''} ${status?.name ?? ''}`;
    return /dead|погиб|выбыл|смерт/i.test(text);
  });

  if (hpCurrent > 0 || alreadyMarked) {
    return {
      ...character,
      is_active: character.is_active ?? hpCurrent > 0,
    };
  }

  return {
    ...character,
    is_active: false,
    status_effects: [
      ...existingStatuses,
      {
        id: 'dead',
        name: 'Погиб',
        description:
          'Персонаж окончательно выбыл из истории. Описание остаётся без графичных подробностей.',
      },
    ],
  };
}

function rowCharacterStorage(row) {
  const stored = row.stats_json ?? {};
  const stats =
    stored.stats && typeof stored.stats === 'object' ? stored.stats : stored;

  return {
    origin: stored.origin ?? row.race ?? '',
    description: stored.description ?? row.background ?? '',
    stats,
    derived: {
      ...(stored.derived ?? {}),
      hp_current: row.hp_current,
      hp_max: row.hp_max,
    },
    resources: stored.resources ?? { reroll_points: 2 },
    skills: stored.skills ?? [],
    is_player_character: stored.is_player_character ?? true,
  };
}

function toPublicCharacterV2(row, playerId = null) {
  const ownCharacter = playerId && String(row.player_id) === String(playerId);
  const stored = rowCharacterStorage(row);

  return {
    id: row.id,
    player_id: row.player_id,
    name: row.name,
    origin: stored.origin,
    race: row.race,
    class_name: row.class_name,
    role: row.role,
    description: stored.description,
    background: row.background,
    goal: row.goal,
    weakness: row.weakness,
    ...(ownCharacter ? { secret: row.secret } : {}),
    stats: stored.stats,
    derived: stored.derived,
    resources: stored.resources,
    skills: stored.skills,
    hp_current: row.hp_current,
    hp_max: row.hp_max,
    inventory: row.inventory_json ?? [],
    status_effects: row.status_effects_json ?? [],
    location_id: row.location_id,
    x: Number(row.x),
    y: Number(row.y),
    is_active: row.is_active,
    is_player_character: stored.is_player_character,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeMapForStorage(mapState, fallbackMapId, fallbackName) {
  const parsed = MapStateSchema.parse({
    ...mapState,
    map_id: mapState.map_id ?? mapState.id ?? fallbackMapId,
    name: mapState.name ?? fallbackName ?? 'Карта',
    image_url: mapState.image_url ?? mapState.background?.image_url ?? '',
    map_type: mapState.map_type ?? mapState.type ?? 'region_map',
    routes: mapState.routes ?? [],
    zones: mapState.zones ?? [],
    areas: mapState.areas ?? mapState.zones ?? [],
    objects: mapState.objects ?? [],
    labels: mapState.labels ?? [],
  });

  return {
    ...parsed,
    map_id: parsed.map_id ?? fallbackMapId,
    id: parsed.id ?? parsed.map_id ?? fallbackMapId,
    map_type: parsed.map_type ?? parsed.type ?? 'region_map',
    image_url: parsed.image_url ?? '',
    routes: parsed.routes ?? [],
    zones: parsed.zones ?? parsed.areas ?? [],
    areas: parsed.areas ?? parsed.zones ?? [],
    objects: parsed.objects ?? [],
    labels: parsed.labels ?? [],
  };
}

function hasFogEnabled(map) {
  if (typeof map?.fog_of_war === 'boolean') {
    return map.fog_of_war;
  }

  return Boolean(map?.fog_of_war?.enabled);
}

function fallbackChoices() {
  return [
    ChoiceSchema.parse({
      id: 'choice_look_around',
      label: 'Осмотреться',
      player_text: 'Я осматриваюсь и пытаюсь понять, что происходит вокруг.',
      type: 'inspect',
      requires_roll: false,
      roll: null,
    }),
  ];
}

function upsertById(items = [], upserts = []) {
  const next = [...items];

  for (const item of upserts) {
    if (!item?.id) {
      continue;
    }

    const index = next.findIndex((current) => current.id === item.id);
    if (index >= 0) {
      next[index] = { ...next[index], ...item };
    } else {
      next.push(item);
    }
  }

  return next;
}

function removeById(items = [], ids = []) {
  const idSet = new Set(ids.map(String));
  return items.filter((item) => !idSet.has(String(item.id)));
}

function applyMapPatchToState(mapState, mapPatch) {
  const patch = MapPatchSchema.parse(mapPatch ?? { changed: false, updates: {} });

  if (!patch.changed) {
    return mapState;
  }

  const updates = patch.updates ?? {};
  let next = structuredClone(mapState ?? {});

  for (const section of ['locations', 'routes', 'zones', 'objects', 'labels']) {
    if (updates[section]) {
      next[section] = removeById(
        upsertById(next[section] ?? [], updates[section].upsert ?? []),
        updates[section].remove ?? [],
      );
    }
  }

  if (updates.tokens) {
    next.tokens = removeById(
      upsertById(next.tokens ?? [], updates.tokens.upsert ?? []),
      updates.tokens.remove ?? [],
    ).map((token) => {
      const move = (updates.tokens.move ?? []).find((item) => item.id === token.id);
      return move ? { ...token, x: move.x, y: move.y } : token;
    });
  }

  if (updates.visibility) {
    const hide = new Set((updates.visibility.hide_entity_ids ?? []).map(String));
    const show = new Set((updates.visibility.show_entity_ids ?? []).map(String));
    const reveal = new Set((updates.visibility.reveal_zone_ids ?? []).map(String));
    const applyVisibility = (item) => {
      if (hide.has(String(item.id))) {
        return { ...item, visible: false, visible_to_players: false };
      }
      if (show.has(String(item.id)) || reveal.has(String(item.id))) {
        return { ...item, visible: true, visible_to_players: true };
      }
      return item;
    };

    for (const section of ['tokens', 'locations', 'zones', 'objects', 'labels']) {
      next[section] = (next[section] ?? []).map(applyVisibility);
    }
  }

  if (updates.viewport) {
    next.viewport = { ...(next.viewport ?? {}), ...updates.viewport };
  }

  next.areas = next.areas ?? next.zones ?? [];
  next.zones = next.zones ?? next.areas ?? [];

  return MapStateSchema.parse(next);
}

function normalizeCollectionPatch(value) {
  if (Array.isArray(value)) {
    return { upsert: value, remove: [] };
  }

  if (value && typeof value === 'object') {
    return {
      upsert: Array.isArray(value.upsert) ? value.upsert : [],
      remove: Array.isArray(value.remove) ? value.remove : [],
    };
  }

  return { upsert: [], remove: [] };
}

function ensurePlayableMap(mapState, characters, scenario) {
  const next = structuredClone(mapState);

  if (!Array.isArray(next.locations) || next.locations.length === 0) {
    next.locations = [
      {
        id: 'loc_start',
        name: 'Место встречи',
        x: Math.round(next.width * 0.28),
        y: Math.round(next.height * 0.52),
        visible_to_players: true,
        description: scenario.starting_scene || 'Здесь начинается путь партии.',
        danger_level: 1,
      },
      {
        id: 'loc_goal',
        name: 'След цели',
        x: Math.round(next.width * 0.68),
        y: Math.round(next.height * 0.34),
        visible_to_players: true,
        description: scenario.current_goal || 'Туда ведёт ближайшая зацепка.',
        danger_level: 3,
      },
      {
        id: 'loc_danger',
        name: 'Опасная зона',
        x: Math.round(next.width * 0.74),
        y: Math.round(next.height * 0.72),
        visible_to_players: false,
        description: 'Подробности этой области пока скрыты.',
        danger_level: 5,
      },
    ];
  }

  if (!Array.isArray(next.routes) || next.routes.length === 0) {
    next.routes = next.locations.slice(0, -1).map((location, index) => {
      const target = next.locations[index + 1];
      return {
        id: `route_${location.id}_${target.id}`,
        from: location.id,
        to: target.id,
        name: `${location.name} — ${target.name}`,
        travel_time: `${index + 1} ход`,
        danger_level: Math.max(
          Number(location.danger_level ?? 1),
          Number(target.danger_level ?? 1),
        ),
        visible_to_players: location.visible_to_players !== false,
      };
    });
  }

  const visibleLocation =
    next.locations.find((location) => location.visible_to_players !== false) ??
    next.locations[0];
  const existingTokenIds = new Set((next.tokens ?? []).map((token) => token.id));
  const characterTokens = characters
    .filter((character) => !existingTokenIds.has(character.id))
    .map((character, index) => ({
      id: character.id,
      type: 'player',
      name: character.name,
      x: visibleLocation.x + index * 56,
      y: visibleLocation.y + index * 44,
      visible: true,
      hp_current: character.derived.hp_current,
      hp_max: character.derived.hp_max,
      location_id: visibleLocation.id,
    }));

  next.tokens = [...(next.tokens ?? []), ...characterTokens];
  next.zones = next.zones ?? next.areas ?? [];
  next.areas = next.areas ?? next.zones ?? [];

  return MapStateSchema.parse(next);
}

async function getSessionPublic(pool, sessionId, playerId = null) {
  const [
    sessionResult,
    stateResult,
    charactersResult,
    npcsResult,
    questsResult,
    mapResult,
    turnsResult,
  ] = await Promise.all([
    pool.query('SELECT * FROM game_sessions WHERE id = $1', [sessionId]),
    pool.query('SELECT * FROM game_states WHERE session_id = $1', [sessionId]),
    pool.query(
      'SELECT * FROM game_characters WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId],
    ),
    pool.query(
      `
        SELECT *
        FROM game_npcs
        WHERE session_id = $1 AND visible_to_players = true
        ORDER BY created_at ASC
      `,
      [sessionId],
    ),
    pool.query(
      `
        SELECT *
        FROM game_quests
        WHERE session_id = $1 AND known_to_players = true
        ORDER BY created_at ASC
      `,
      [sessionId],
    ),
    pool.query(
      'SELECT * FROM game_maps WHERE session_id = $1 ORDER BY created_at ASC LIMIT 1',
      [sessionId],
    ),
    pool.query(
      'SELECT * FROM game_turns WHERE session_id = $1 ORDER BY turn_index ASC',
      [sessionId],
    ),
  ]);

  const session = sessionResult.rows[0];
  const state = stateResult.rows[0];

  if (!session || !state) {
    throw makeHttpError('Game session not found', 404);
  }

  const characters = charactersResult.rows.map((row) =>
    toPublicCharacterV2(row, playerId),
  );
  const npcs = npcsResult.rows.map(toPublicNpc);
  const map = buildVisibleMap(
    mapResult.rows[0],
    state.map_state_json,
    characters,
    npcs,
  );

  return {
    session: {
      id: session.id,
      title: session.title,
      theme: session.theme,
      genre: session.genre,
      tone: session.tone,
      status: session.status,
      current_phase: session.current_phase,
      current_scene: session.current_scene,
      current_actor_id: session.current_actor_id,
      turn_mode: session.turn_mode,
      scene_type: session.scene_type,
      round: session.round,
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
    game_state: {
      public_state: state.public_state_json ?? {},
      summary_short: state.summary_short,
      summary_long: state.summary_long,
      important_facts: state.important_facts_json ?? [],
      unresolved_threads: state.unresolved_threads_json ?? [],
    },
    characters,
    npcs,
    quests: questsResult.rows.map(toPublicQuest),
    map,
    turns: turnsResult.rows.map(toTurn),
  };
}

async function insertLobbyScenario(
  client,
  game,
  theme,
  generatedScenario,
  ownerPlayerId = null,
  participants = [],
  initialInvitations = [],
) {
  const sessionId = randomUUID();
  const stateId = randomUUID();
  const mapId = `map_${sessionId}`;
  const characters = generatedScenario.characters.map((character, index) =>
    normalizeCharacterPayload(character, `char_${index + 1}_${randomUUID().slice(0, 8)}`),
  );
  const mapState = ensurePlayableMap(
    normalizeMapForStorage(
      {
        ...(generatedScenario.map_state ?? {}),
        id: mapId,
        map_id: mapId,
      },
      mapId,
      generatedScenario.scenario.title,
    ),
    characters,
    generatedScenario.scenario,
  );
  const firstLocation =
    mapState.locations.find((location) => location.visible_to_players !== false) ??
    mapState.locations[0];
  const publicState = {
    owner_player_id: ownerPlayerId,
    participant_player_ids: uniqueStrings([
      ownerPlayerId,
      ...participants.map((participant) => participant.id),
    ]),
    participants,
    lobby_invitations: initialInvitations.map((invitation) => ({
      ...invitation,
      session_id: sessionId,
    })),
    deepseek_chat_id: sessionId,
    selected_game: game,
    theme,
    scenario: generatedScenario.scenario,
    game_state: generatedScenario.game_state,
    current_choices: generatedScenario.choices,
    roll_history: [],
  };

  await client.query(
    `
      INSERT INTO game_sessions (
        id, title, theme, genre, tone, status, current_phase, current_scene,
        current_actor_id, turn_mode, scene_type, round
      )
      VALUES ($1, $2, $3, $4, $5, 'draft', 'lobby', $6, $7, $8, $9, $10)
    `,
    [
      sessionId,
      generatedScenario.scenario.title,
      theme,
      generatedScenario.scenario.genre,
      generatedScenario.scenario.tone,
      generatedScenario.game_state.current_scene,
      generatedScenario.game_state.current_actor_id,
      generatedScenario.game_state.turn_mode,
      generatedScenario.game_state.scene_type,
      generatedScenario.game_state.round,
    ],
  );

  await client.query(
    `
      INSERT INTO game_states (
        id, session_id, public_state_json, hidden_gm_state_json, map_state_json,
        summary_short, summary_long, important_facts_json, unresolved_threads_json
      )
      VALUES ($1, $2, $3, '{}', $4, $5, $6, $7, '[]')
    `,
    [
      stateId,
      sessionId,
      JSON.stringify(publicState),
      JSON.stringify(mapState),
      generatedScenario.scenario.short_description,
      `${generatedScenario.scenario.short_description}\n${generatedScenario.scenario.starting_scene}`,
      JSON.stringify(generatedScenario.game_state.known_facts ?? []),
    ],
  );

  await client.query(
    `
      INSERT INTO game_maps (
        id, session_id, name, image_url, width, height, grid_enabled,
        grid_cell_size, map_type, fog_of_war, state_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      mapState.map_id,
      sessionId,
      mapState.name,
      mapState.image_url ?? '',
      mapState.width,
      mapState.height,
      Boolean(mapState.grid?.enabled),
      mapState.grid?.cell_size ?? 50,
      mapState.map_type ?? mapState.type ?? 'region_map',
      hasFogEnabled(mapState),
      JSON.stringify(mapState),
    ],
  );

  for (const [index, character] of characters.entries()) {
    const token = mapState.tokens.find((item) => item.id === character.id);
    await client.query(
      `
        INSERT INTO game_characters (
          id, session_id, player_id, name, race, class_name, role, background,
          goal, strength, weakness, secret, stats_json, hp_current, hp_max,
          inventory_json, status_effects_json, location_id, x, y, is_active
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, '', $10, $11, $12,
          $13, $14, $15, $16, $17, $18, $19, $20
        )
      `,
      [
        character.id,
        sessionId,
        ownerPlayerId ?? 'party',
        character.name,
        character.origin,
        character.class_name,
        character.role,
        character.description,
        character.goal,
        character.weakness,
        character.secret,
        JSON.stringify(characterStatsStorage(character)),
        character.derived.hp_current,
        character.derived.hp_max,
        JSON.stringify(character.inventory),
        JSON.stringify(character.status_effects),
        token?.location_id ?? firstLocation?.id ?? null,
        token?.x ?? (firstLocation?.x ?? 160) + index * 56,
        token?.y ?? (firstLocation?.y ?? 160) + index * 44,
        character.is_active ?? true,
      ],
    );
  }

  for (const [index, quest] of (generatedScenario.game_state.active_quests ?? []).entries()) {
    await client.query(
      `
        INSERT INTO game_quests (
          id, session_id, title, description, status, known_to_players, state_json
        )
        VALUES ($1, $2, $3, $4, $5, true, '{}')
      `,
      [
        `quest_${sessionId}_${index + 1}`,
        sessionId,
        quest.title,
        quest.description ?? '',
        quest.status ?? 'active',
      ],
    );
  }

  await client.query(
    `
      INSERT INTO game_messages (
        id, session_id, role, content, visible_to_players
      )
      VALUES ($1, $2, 'gm', $3, true)
    `,
    [
      randomUUID(),
      sessionId,
      generatedScenario.initial_message?.text ||
        generatedScenario.scenario.starting_scene ||
        'Сцена начинается. Что вы сделаете?',
    ],
  );

  return { sessionId, mapState, characters };
}

async function createGameMessage(pool, message) {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO game_messages (
        id, session_id, player_id, character_id, role, content, visible_to_players
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      id,
      message.session_id,
      message.player_id ?? null,
      message.character_id ?? null,
      message.role,
      message.content,
      message.visible_to_players ?? true,
    ],
  );

  return toMessage(result.rows[0]);
}

async function insertCharacterRow(poolOrClient, sessionId, playerId, character, map) {
  const normalized = normalizeCharacterPayload(character);
  const firstLocation = map?.locations?.find(
    (location) => location.visible_to_players !== false,
  );
  const token = map?.tokens?.find((item) => item.id === normalized.id);
  const x = clamp(token?.x ?? firstLocation?.x ?? 160, 0, map?.width ?? 2000);
  const y = clamp(token?.y ?? firstLocation?.y ?? 160, 0, map?.height ?? 1200);
  const result = await poolOrClient.query(
    `
      INSERT INTO game_characters (
        id, session_id, player_id, name, race, class_name, role, background,
        goal, strength, weakness, secret, stats_json, hp_current, hp_max,
        inventory_json, status_effects_json, location_id, x, y, is_active
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, '', $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20
      )
      RETURNING *
    `,
    [
      normalized.id,
      sessionId,
      playerId,
      normalized.name,
      normalized.origin,
      normalized.class_name,
      normalized.role,
      normalized.description,
      normalized.goal,
      normalized.weakness,
      normalized.secret,
      JSON.stringify(characterStatsStorage(normalized)),
      normalized.derived.hp_current,
      normalized.derived.hp_max,
      JSON.stringify(normalized.inventory),
      JSON.stringify(normalized.status_effects),
      token?.location_id ?? firstLocation?.id ?? null,
      x,
      y,
      normalized.is_active ?? true,
    ],
  );

  return toPublicCharacterV2(result.rows[0], playerId);
}

async function applyScenarioRevision(pool, sessionId, playerId, game, revision) {
  const current = await getSessionPublic(pool, sessionId, playerId);

  if (current.session.status === 'finished') {
    throw makeHttpError('Игра уже завершена.', 400);
  }

  const scenario = {
    ...(current.game_state.public_state?.scenario ?? {}),
    ...revision.scenario,
    game_id: game.id,
  };
  const gameState = {
    ...(current.game_state.public_state?.game_state ?? {}),
    ...revision.game_state,
    current_goal:
      revision.game_state?.current_goal ??
      revision.scenario?.current_goal ??
      current.game_state.public_state?.game_state?.current_goal,
    current_scene:
      revision.game_state?.current_scene ??
      revision.scenario?.starting_scene ??
      current.session.current_scene,
  };
  const mapId = current.map?.map_id ?? current.map?.id ?? `map_${sessionId}`;
  const mapState = ensurePlayableMap(
    normalizeMapForStorage(
      {
        ...(current.map ?? {}),
        ...(revision.map_state ?? {}),
        id: mapId,
        map_id: mapId,
      },
      mapId,
      scenario.title,
    ),
    current.characters,
    scenario,
  );
  const choices = revision.choices?.length ? revision.choices : fallbackChoices();
  const publicState = {
    ...(current.game_state.public_state ?? {}),
    selected_game: game,
    scenario,
    game_state: gameState,
    current_choices: choices,
  };
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE game_sessions
        SET
          title = $1,
          genre = $2,
          tone = $3,
          current_scene = $4,
          current_actor_id = $5,
          turn_mode = $6,
          scene_type = $7,
          round = $8,
          updated_at = now()
        WHERE id = $9
      `,
      [
        scenario.title,
        scenario.genre ?? current.session.genre,
        scenario.tone ?? current.session.tone,
        gameState.current_scene ?? scenario.starting_scene,
        gameState.current_actor_id ?? null,
        Boolean(gameState.turn_mode),
        gameState.scene_type ?? current.session.scene_type,
        Number(gameState.round ?? 0),
        sessionId,
      ],
    );

    await client.query(
      `
        UPDATE game_states
        SET
          public_state_json = $1,
          map_state_json = $2,
          summary_short = $3,
          summary_long = $4,
          important_facts_json = $5,
          updated_at = now()
        WHERE session_id = $6
      `,
      [
        JSON.stringify(publicState),
        JSON.stringify(mapState),
        scenario.short_description ?? '',
        `${scenario.short_description ?? ''}\n${scenario.starting_scene ?? ''}`.trim(),
        JSON.stringify(gameState.known_facts ?? []),
        sessionId,
      ],
    );

    await client.query(
      `
        UPDATE game_maps
        SET
          name = $1,
          image_url = $2,
          width = $3,
          height = $4,
          grid_enabled = $5,
          grid_cell_size = $6,
          map_type = $7,
          fog_of_war = $8,
          state_json = $9,
          updated_at = now()
        WHERE session_id = $10
      `,
      [
        mapState.name,
        mapState.image_url ?? '',
        mapState.width,
        mapState.height,
        Boolean(mapState.grid?.enabled),
        mapState.grid?.cell_size ?? 50,
        mapState.map_type ?? mapState.type ?? 'region_map',
        hasFogEnabled(mapState),
        JSON.stringify(mapState),
        sessionId,
      ],
    );

    await client.query('DELETE FROM game_quests WHERE session_id = $1', [sessionId]);
    for (const [index, quest] of (gameState.active_quests ?? []).entries()) {
      const questId = `quest_${sessionId}_${index + 1}_${randomUUID().slice(0, 8)}`;
      await client.query(
        `
          INSERT INTO game_quests (
            id, session_id, title, description, status, known_to_players, state_json
          )
          VALUES ($1, $2, $3, $4, $5, true, '{}')
        `,
        [
          questId,
          sessionId,
          quest.title,
          quest.description ?? '',
          quest.status ?? 'active',
        ],
      );
    }

    if (revision.initial_message?.text) {
      await client.query(
        `
          UPDATE game_messages
          SET content = $1
          WHERE id = (
            SELECT id
            FROM game_messages
            WHERE session_id = $2 AND role = 'gm'
            ORDER BY created_at ASC
            LIMIT 1
          )
        `,
        [revision.initial_message.text, sessionId],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getSessionPublic(pool, sessionId, playerId);
}

async function logSuspiciousMessage(pool, sessionId, playerId, characterId, content, reason) {
  await pool.query(
    `
      INSERT INTO game_prompt_security_logs (
        id, session_id, player_id, character_id, content, reason
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [randomUUID(), sessionId, playerId, characterId, content, reason],
  );
}

async function buildCommandResponse(pool, sessionId, playerId, characterId, command) {
  const state = await getSessionPublic(pool, sessionId, playerId);
  const character = state.characters.find((item) => item.id === characterId);
  const commandName = getCommandName(command);

  switch (commandName) {
    case '/state':
      return [
        `Сцена: ${state.session.current_scene || 'не задана'}`,
        `Фаза: ${state.session.current_phase}`,
        `Режим ходов: ${state.session.turn_mode ? 'включён' : 'свободная сцена'}`,
        `Опасность: ${state.game_state.public_state?.world_state?.danger_level ?? 'неизвестно'}`,
        `Партия: ${state.characters
          .map((item) => `${item.name} ${item.hp_current}/${item.hp_max} HP`)
          .join(', ') || 'персонажи ещё не созданы'}`,
      ].join('\n');
    case '/character':
      if (!character) {
        return 'Персонаж не найден.';
      }

      return [
        `${character.name}: ${character.race} ${character.class_name}`,
        `Роль: ${character.role || 'не указана'}`,
        `HP: ${character.hp_current}/${character.hp_max}`,
        `Цель: ${character.goal || 'не указана'}`,
        `Сильная сторона: ${character.strength || 'не указана'}`,
        `Слабость: ${character.weakness || 'не указана'}`,
        character.secret ? `Личный секрет: ${character.secret}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    case '/quests':
      return state.quests.length
        ? state.quests
            .map((quest) => `${quest.title} [${quest.status}]\n${quest.description}`)
            .join('\n\n')
        : 'Активных известных заданий пока нет.';
    case '/turns':
      return state.turns.length
        ? state.turns
            .map((turn) => {
              const actor =
                state.characters.find((item) => item.id === turn.actor_id) ||
                state.npcs.find((item) => item.id === turn.actor_id);
              return `${turn.is_current ? '>' : '-'} ${actor?.name ?? turn.actor_id}`;
            })
            .join('\n')
        : 'Порядок ходов пока не создан.';
    case '/recap':
      return state.game_state.summary_short || 'Краткое резюме пока не создано.';
    case '/map':
      return state.map
        ? [
            `Карта: ${state.map.name}`,
            `Размер: ${state.map.width}x${state.map.height}`,
            `Туман войны: ${state.map.fog_of_war ? 'да' : 'нет'}`,
            `Видимые точки: ${
              state.map.locations
                .filter((location) => location.visible_to_players)
                .map((location) => location.name)
                .join(', ') || 'нет'
            }`,
          ].join('\n')
        : 'Карта не найдена.';
    case '/inventory':
      return character?.inventory?.length
        ? character.inventory.map((item) => `- ${String(item)}`).join('\n')
        : 'Инвентарь пуст или скрыт.';
    case '/roll':
    case '/dice': {
      const [, expression = 'd20'] = normalizeString(command).split(/\s+/, 2);
      return formatDiceRoll(
        rollDice(expression, 'player_command'),
        character?.name ?? 'Персонаж',
      );
    }
    case '/help':
    default:
      return [
        ...[...ALLOWED_COMMANDS].sort(),
        '',
        'Кубики: /roll d20, /roll 2d6+3, /dice d100',
      ].join('\n');
  }
}

async function spendRerollPoints(pool, sessionId, characterId, points) {
  const amount = Number(points ?? 0);

  if (!Number.isInteger(amount) || amount <= 0) {
    return;
  }

  const result = await pool.query(
    'SELECT * FROM game_characters WHERE id = $1 AND session_id = $2',
    [characterId, sessionId],
  );
  const row = result.rows[0];

  if (!row) {
    return;
  }

  const stored = rowCharacterStorage(row);
  const current = Number(stored.resources?.reroll_points ?? 0);
  const resources = {
    ...(stored.resources ?? {}),
    reroll_points: Math.max(0, current - amount),
  };
  const nextStorage = {
    ...stored,
    resources,
  };

  await pool.query(
    'UPDATE game_characters SET stats_json = $1, updated_at = now() WHERE id = $2 AND session_id = $3',
    [JSON.stringify(nextStorage), characterId, sessionId],
  );
}

async function upsertNpcFromPatch(client, sessionId, npc) {
  if (!npc?.id) {
    return;
  }

  await client.query(
    `
      INSERT INTO game_npcs (
        id, session_id, name, role, personality, goal, knows_json, secret,
        attitude, location_id, x, y, visible_to_players, state_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (id) DO UPDATE
      SET
        name = COALESCE(EXCLUDED.name, game_npcs.name),
        role = COALESCE(EXCLUDED.role, game_npcs.role),
        personality = COALESCE(EXCLUDED.personality, game_npcs.personality),
        goal = COALESCE(EXCLUDED.goal, game_npcs.goal),
        knows_json = EXCLUDED.knows_json,
        secret = COALESCE(EXCLUDED.secret, game_npcs.secret),
        attitude = COALESCE(EXCLUDED.attitude, game_npcs.attitude),
        location_id = EXCLUDED.location_id,
        x = EXCLUDED.x,
        y = EXCLUDED.y,
        visible_to_players = EXCLUDED.visible_to_players,
        state_json = EXCLUDED.state_json,
        updated_at = now()
    `,
    [
      npc.id,
      sessionId,
      npc.name ?? npc.id,
      npc.role ?? '',
      npc.personality ?? '',
      npc.goal ?? '',
      JSON.stringify(npc.knows ?? []),
      npc.secret ?? '',
      npc.attitude ?? '',
      npc.location_id ?? null,
      clamp(npc.x ?? 100, 0, 100000),
      clamp(npc.y ?? 100, 0, 100000),
      npc.visible_to_players ?? npc.visible ?? true,
      JSON.stringify(npc.state ?? npc),
    ],
  );
}

async function upsertQuestFromPatch(client, sessionId, quest) {
  if (!quest?.id && !quest?.title) {
    return;
  }

  const id = quest.id || `quest_${randomUUID().slice(0, 10)}`;
  await client.query(
    `
      INSERT INTO game_quests (
        id, session_id, title, description, status, known_to_players, state_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE
      SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        known_to_players = EXCLUDED.known_to_players,
        state_json = EXCLUDED.state_json,
        updated_at = now()
    `,
    [
      id,
      sessionId,
      quest.title,
      quest.description ?? '',
      quest.status ?? 'active',
      quest.known_to_players ?? true,
      JSON.stringify(quest.state ?? {}),
    ],
  );
}

async function applyCharacterPatch(client, sessionId, characterPatch) {
  if (!characterPatch?.id) {
    return;
  }

  const current = await client.query(
    'SELECT * FROM game_characters WHERE id = $1 AND session_id = $2',
    [characterPatch.id, sessionId],
  );
  const row = current.rows[0];

  if (!row) {
    return;
  }

  const stored = rowCharacterStorage(row);
  const merged = withCharacterFate(normalizeCharacterPayload({
    id: row.id,
    name: characterPatch.name ?? row.name,
    role: characterPatch.role ?? row.role,
    origin: characterPatch.origin ?? stored.origin,
    class_name: characterPatch.class_name ?? row.class_name,
    description: characterPatch.description ?? stored.description,
    goal: characterPatch.goal ?? row.goal,
    weakness: characterPatch.weakness ?? row.weakness,
    secret: characterPatch.secret ?? row.secret,
    stats: characterPatch.stats ?? stored.stats,
    derived: {
      ...stored.derived,
      ...(characterPatch.derived ?? {}),
      ...(characterPatch.hp_current !== undefined
        ? { hp_current: characterPatch.hp_current }
        : {}),
      ...(characterPatch.hp_max !== undefined ? { hp_max: characterPatch.hp_max } : {}),
    },
    resources: characterPatch.resources ?? stored.resources,
    skills: characterPatch.skills ?? stored.skills,
    inventory: characterPatch.inventory ?? row.inventory_json ?? [],
    status_effects: characterPatch.status_effects ?? row.status_effects_json ?? [],
    is_player_character: stored.is_player_character,
  }));

  await client.query(
    `
      UPDATE game_characters
      SET
        name = $1,
        race = $2,
        class_name = $3,
        role = $4,
        background = $5,
        goal = $6,
        weakness = $7,
        secret = $8,
        stats_json = $9,
        hp_current = $10,
        hp_max = $11,
        inventory_json = $12,
        status_effects_json = $13,
        location_id = $14,
        x = $15,
        y = $16,
        is_active = $17,
        updated_at = now()
      WHERE id = $18 AND session_id = $19
    `,
    [
      merged.name,
      merged.origin,
      merged.class_name,
      merged.role,
      merged.description,
      merged.goal,
      merged.weakness,
      merged.secret,
      JSON.stringify(characterStatsStorage(merged)),
      merged.derived.hp_current,
      merged.derived.hp_max,
      JSON.stringify(merged.inventory),
      JSON.stringify(merged.status_effects),
      characterPatch.location_id !== undefined
        ? characterPatch.location_id
        : row.location_id,
      characterPatch.x !== undefined ? characterPatch.x : row.x,
      characterPatch.y !== undefined ? characterPatch.y : row.y,
      characterPatch.is_active !== undefined
        ? Boolean(characterPatch.is_active) && merged.derived.hp_current > 0
        : merged.is_active ?? row.is_active,
      characterPatch.id,
      sessionId,
    ],
  );
}

async function replaceTurnsFromIds(client, sessionId, turnOrder, round, currentActorId) {
  if (!Array.isArray(turnOrder)) {
    return;
  }

  await client.query('DELETE FROM game_turns WHERE session_id = $1', [sessionId]);

  for (const [index, actorId] of turnOrder.entries()) {
    await client.query(
      `
        INSERT INTO game_turns (
          id, session_id, round, actor_id, actor_type, turn_index, is_current, has_acted
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, false)
      `,
      [
        randomUUID(),
        sessionId,
        round ?? 0,
        actorId,
        String(actorId).startsWith('npc_') ? 'npc' : 'character',
        index,
        actorId === currentActorId,
      ],
    );
  }
}

async function applyGameMasterPatches(pool, sessionId, statePatch, mapPatch, choices) {
  const parsedStatePatch = StatePatchSchema.parse(
    statePatch ?? { changed: false, updates: {} },
  );
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const sessionResult = await client.query(
      'SELECT * FROM game_sessions WHERE id = $1 FOR UPDATE',
      [sessionId],
    );
    const stateResult = await client.query(
      'SELECT * FROM game_states WHERE session_id = $1 FOR UPDATE',
      [sessionId],
    );
    const mapResult = await client.query(
      'SELECT * FROM game_maps WHERE session_id = $1 ORDER BY created_at ASC LIMIT 1 FOR UPDATE',
      [sessionId],
    );
    const session = sessionResult.rows[0];
    const state = stateResult.rows[0];
    const mapRow = mapResult.rows[0];

    if (!session || !state) {
      throw makeHttpError('Game session not found', 404);
    }

    const updates = parsedStatePatch.updates ?? {};
    const fields = {
      current_scene: updates.current_scene,
      current_actor_id: updates.current_actor_id,
      turn_mode: updates.turn_mode,
      scene_type: updates.scene_type,
      round: updates.round,
    };
    const assignments = [];
    const values = [];

    for (const [column, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    if (updates.phase ?? updates.current_phase) {
      values.push(updates.phase ?? updates.current_phase);
      assignments.push(`current_phase = $${values.length}`);
    }

    if (assignments.length) {
      values.push(sessionId);
      await client.query(
        `UPDATE game_sessions SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values,
      );
    } else {
      await client.query('UPDATE game_sessions SET updated_at = now() WHERE id = $1', [
        sessionId,
      ]);
    }

    const publicState = state.public_state_json ?? {};
    const currentGameState = publicState.game_state ?? {};
    const knownFacts = new Set([
      ...((currentGameState.known_facts ?? []).map(String)),
      ...((updates.known_facts?.add ?? []).map(String)),
    ]);
    const nextGameState = {
      ...currentGameState,
      ...(updates.phase || updates.current_phase
        ? { phase: updates.phase ?? updates.current_phase }
        : {}),
      ...(updates.current_scene !== undefined && updates.current_scene !== null
        ? { current_scene: updates.current_scene }
        : {}),
      ...(updates.current_goal !== undefined && updates.current_goal !== null
        ? { current_goal: updates.current_goal }
        : {}),
      ...(updates.current_actor_id !== undefined
        ? { current_actor_id: updates.current_actor_id }
        : {}),
      ...(updates.turn_mode !== undefined && updates.turn_mode !== null
        ? { turn_mode: updates.turn_mode }
        : {}),
      ...(updates.scene_type !== undefined && updates.scene_type !== null
        ? { scene_type: updates.scene_type }
        : {}),
      ...(updates.round !== undefined && updates.round !== null
        ? { round: updates.round }
        : {}),
      ...(updates.turn_order ? { turn_order: updates.turn_order } : {}),
      known_facts: [...knownFacts].filter(Boolean),
    };

    const questPatch = normalizeCollectionPatch(updates.quests);
    if (questPatch.upsert.length || questPatch.remove.length) {
      const activeQuests = removeById(
        upsertById(nextGameState.active_quests ?? [], questPatch.upsert),
        questPatch.remove,
      );
      nextGameState.active_quests = activeQuests;
    }

    let mapState = state.map_state_json ?? {};
    if (updates.map && typeof updates.map === 'object') {
      mapState = MapStateSchema.parse({ ...mapState, ...updates.map });
    }
    mapState = applyMapPatchToState(mapState, mapPatch);

    await client.query(
      `
        UPDATE game_states
        SET public_state_json = $1,
            map_state_json = $2,
            important_facts_json = $3,
            updated_at = now()
        WHERE session_id = $4
      `,
      [
        JSON.stringify({
          ...publicState,
          game_state: nextGameState,
          current_choices: choices.length ? choices : fallbackChoices(),
        }),
        JSON.stringify(mapState),
        JSON.stringify(nextGameState.known_facts ?? []),
        sessionId,
      ],
    );

    if (mapRow) {
      await client.query(
        `
          UPDATE game_maps
          SET
            name = $1,
            image_url = $2,
            width = $3,
            height = $4,
            grid_enabled = $5,
            grid_cell_size = $6,
            map_type = $7,
            fog_of_war = $8,
            state_json = $9,
            updated_at = now()
          WHERE id = $10 AND session_id = $11
        `,
        [
          mapState.name ?? mapRow.name,
          mapState.image_url ?? '',
          mapState.width ?? mapRow.width,
          mapState.height ?? mapRow.height,
          Boolean(mapState.grid?.enabled),
          mapState.grid?.cell_size ?? 50,
          mapState.map_type ?? mapState.type ?? mapRow.map_type,
          hasFogEnabled(mapState),
          JSON.stringify(mapState),
          mapRow.id,
          sessionId,
        ],
      );
    }

    const characterPatch = normalizeCollectionPatch(updates.characters);
    for (const character of characterPatch.upsert) {
      await applyCharacterPatch(client, sessionId, character);
    }
    if (characterPatch.remove.length) {
      await client.query(
        'DELETE FROM game_characters WHERE session_id = $1 AND id = ANY($2)',
        [sessionId, characterPatch.remove],
      );
    }

    const npcPatch = normalizeCollectionPatch(updates.npcs);
    for (const npc of npcPatch.upsert) {
      await upsertNpcFromPatch(client, sessionId, npc);
    }
    if (npcPatch.remove.length) {
      await client.query('DELETE FROM game_npcs WHERE session_id = $1 AND id = ANY($2)', [
        sessionId,
        npcPatch.remove,
      ]);
    }

    for (const quest of questPatch.upsert) {
      await upsertQuestFromPatch(client, sessionId, quest);
    }
    if (questPatch.remove.length) {
      await client.query('DELETE FROM game_quests WHERE session_id = $1 AND id = ANY($2)', [
        sessionId,
        questPatch.remove,
      ]);
    }

    if (Array.isArray(updates.turn_order)) {
      await replaceTurnsFromIds(
        client,
        sessionId,
        updates.turn_order,
        updates.round ?? session.round,
        updates.current_actor_id ?? session.current_actor_id,
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function maybeSummarize(service, pool, sessionId) {
  const result = await pool.query(
    `
      SELECT COUNT(*)::int AS count
      FROM game_messages
      WHERE session_id = $1 AND visible_to_players = true
    `,
    [sessionId],
  );

  if (result.rows[0].count > 0 && result.rows[0].count % 18 === 0) {
    await service.summarizeGameSession(sessionId).catch((error) => {
      console.warn('Game summary update failed', error);
    });
  }
}

async function advanceTurn(pool, sessionId) {
  const turns = await pool.query(
    'SELECT * FROM game_turns WHERE session_id = $1 ORDER BY turn_index ASC',
    [sessionId],
  );

  if (!turns.rows.length) {
    return null;
  }

  const currentIndex = turns.rows.findIndex((turn) => turn.is_current);
  const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeCurrentIndex + 1) % turns.rows.length;
  const nextTurn = turns.rows[nextIndex];
  const nextRound =
    nextIndex === 0 ? Number(turns.rows[safeCurrentIndex].round ?? 0) + 1 : turns.rows[safeCurrentIndex].round;

  await pool.query('UPDATE game_turns SET is_current = false WHERE session_id = $1', [
    sessionId,
  ]);
  await pool.query(
    `
      UPDATE game_turns
      SET is_current = true, has_acted = false, round = $1, updated_at = now()
      WHERE id = $2
    `,
    [nextRound, nextTurn.id],
  );
  await pool.query(
    `
      UPDATE game_sessions
      SET current_actor_id = $1, round = $2, updated_at = now()
      WHERE id = $3
    `,
    [nextTurn.actor_id, nextRound, sessionId],
  );

  return nextTurn.actor_id;
}

async function ensureCurrentActorAlive(pool, sessionId) {
  let changed = false;

  for (let guard = 0; guard < 24; guard += 1) {
    const sessionResult = await pool.query(
      'SELECT current_actor_id, turn_mode FROM game_sessions WHERE id = $1',
      [sessionId],
    );
    const session = sessionResult.rows[0];

    if (!session?.turn_mode) {
      return changed;
    }

    const currentActorId = String(session.current_actor_id ?? '');
    if (!currentActorId) {
      const advanced = await advanceTurn(pool, sessionId);
      if (!advanced) {
        return changed;
      }
      changed = true;
      continue;
    }

    if (currentActorId.startsWith('npc_')) {
      return changed;
    }

    const characterResult = await pool.query(
      `
        SELECT is_active, hp_current
        FROM game_characters
        WHERE session_id = $1 AND id = $2
        LIMIT 1
      `,
      [sessionId, currentActorId],
    );
    const character = characterResult.rows[0];
    const isAlive =
      character &&
      Boolean(character.is_active) &&
      Number(character.hp_current ?? 0) > 0;

    if (isAlive) {
      return changed;
    }

    const advanced = await advanceTurn(pool, sessionId);
    if (!advanced) {
      return changed;
    }
    changed = true;
  }

  return changed;
}

export function registerGameRoutes(app, { pool, readAuthUser = null }) {
  const service = new AiGameMasterService({ pool });
  const generationLocks = new Set();
  const sessionQueues = new Map();
  const requireRpgAuth = (handler) =>
    asyncRoute(async (request, response, next) => {
      if (!readAuthUser) {
        await handler(request, response, next);
        return;
      }

      const user = await readAuthUser(request);

      if (!user) {
        response.status(401).json({ message: 'Войдите в аккаунт, чтобы играть.' });
        return;
      }

      request.authUser = user;
      await handler(request, response, next);
    });

  function emitToSession(sessionId, event, payload) {
    const io = app.get('io');
    if (io) {
      io.to(`game:${sessionId}`).emit(event, payload);
    }
  }

  function emitToUser(userId, event, payload) {
    const io = app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit(event, payload);
    }
  }

  function lobbyInvitations(publicState) {
    return Array.isArray(publicState?.lobby_invitations)
      ? publicState.lobby_invitations
      : [];
  }

  function pendingLobbyInvitation(publicState, playerId) {
    return lobbyInvitations(publicState).find(
      (invite) =>
        String(invite?.to_player_id ?? '') === String(playerId) &&
        invite?.status === 'pending',
    );
  }

  function isParticipant(publicState, playerId) {
    const id = String(playerId ?? '');
    const participantIds = Array.isArray(publicState?.participant_player_ids)
      ? publicState.participant_player_ids.map(String)
      : [];

    return participantIds.includes(id);
  }

  async function withGenerationLock(lockKey, handler) {
    if (generationLocks.has(lockKey)) {
      throw makeHttpError(
        'Ведущий уже готовит ответ для этого лобби. Подождите немного.',
        409,
      );
    }

    generationLocks.add(lockKey);
    try {
      return await handler();
    } finally {
      generationLocks.delete(lockKey);
    }
  }

  async function withSessionQueue(sessionId, label, handler) {
    const key = String(sessionId ?? '').trim();

    if (!key) {
      return handler();
    }

    const previous = sessionQueues.get(key) ?? Promise.resolve();
    const queued = sessionQueues.has(key);

    if (queued) {
      emitToSession(key, 'game-session-queued', {
        sessionId: key,
        label,
        queued: true,
      });
    }

    let current;
    current = previous
      .catch(() => {
        // Keep the queue moving after a failed request.
      })
      .then(async () => {
        emitToSession(key, 'game-session-busy', {
          sessionId: key,
          label,
          busy: true,
        });

        try {
          return await handler();
        } finally {
          if (sessionQueues.get(key) === current) {
            sessionQueues.delete(key);
            emitToSession(key, 'game-session-busy', {
              sessionId: key,
              label,
              busy: false,
            });
          }
        }
      });

    sessionQueues.set(key, current);
    return current;
  }

  const queuedRpgSessionRoute = (label, handler) =>
    requireRpgAuth((request, response, next) =>
      withSessionQueue(request.params.id, label, () =>
        handler(request, response, next),
      ),
    );

  app.get('/api/game-sessions/available-games', (_request, response) => {
    response.json(getEnabledGames());
  });

  app.get(
    '/api/game-sessions',
    requireRpgAuth(async (request, response) => {
      const playerId = String(request.authUser?.id ?? normalizeString(request.query.player_id));

      if (!playerId) {
        response.status(400).json({ message: 'player_id is required' });
        return;
      }

      const result = await pool.query(
        `
          SELECT
            s.id,
            s.title,
            s.theme,
            s.genre,
            s.tone,
            s.status,
            s.current_phase,
            s.current_scene,
            s.current_actor_id,
            s.turn_mode,
            s.scene_type,
            s.round,
            s.created_at,
            s.updated_at,
            COUNT(gc.id) FILTER (WHERE gc.player_id = $1)::int AS character_count,
            COALESCE(
              json_agg(gc.name ORDER BY gc.created_at)
                FILTER (WHERE gc.player_id = $1 AND gc.id IS NOT NULL),
              '[]'
            ) AS character_names
          FROM game_sessions s
          JOIN game_states gs ON gs.session_id = s.id
          LEFT JOIN game_characters gc ON gc.session_id = s.id
          WHERE
            gc.player_id = $1
            OR gs.public_state_json ->> 'owner_player_id' = $1
            OR (gs.public_state_json -> 'participant_player_ids') ? $1
          GROUP BY s.id
          ORDER BY s.updated_at DESC
          LIMIT 50
        `,
        [playerId],
      );

      response.json(result.rows);
    }),
  );

  app.post(
    '/api/game-sessions/generate',
    requireRpgAuth(async (request, response) => {
      const theme = normalizeString(request.body.theme);
      const gameId = normalizeString(request.body.game_id ?? request.body.gameId);
      const ownerPlayerId = String(request.authUser.id);
      const game = findAvailableGame(gameId);

      if (!game) {
        response
          .status(400)
          .json({ message: 'Эта игра пока недоступна для генерации сценария.' });
        return;
      }

      if (theme.length > MAX_THEME_LENGTH) {
        response
          .status(400)
          .json({ message: `Тематика слишком длинная. Лимит: ${MAX_THEME_LENGTH}` });
        return;
      }

      const { players: invitedPlayers, missing } = await resolveInvitedPlayers(
        pool,
        request.body.players,
        ownerPlayerId,
      );

      if (missing.length) {
        response.status(400).json({
          message: `Не удалось найти игроков: ${missing.join(', ')}`,
        });
        return;
      }

      const participants = [
        {
          id: ownerPlayerId,
          name: request.authUser.name ?? request.authUser.username ?? 'Ведущий',
          username: request.authUser.username,
          role: 'Ведущий',
        },
      ];
      const initialInvitations = invitedPlayers.map((player) => ({
        id: `invite_${randomUUID().slice(0, 12)}`,
        session_id: null,
        from_player_id: ownerPlayerId,
        from_name: request.authUser.name ?? request.authUser.username ?? 'Ведущий',
        to_player_id: player.id,
        to_name: player.name,
        to_username: player.username,
        status: 'pending',
        created_at: new Date().toISOString(),
        responded_at: null,
      }));

      const generatedScenario = await withGenerationLock(
        `lobby:${ownerPlayerId}`,
        () =>
          service.generateLobbyScenario({
            game,
            theme: theme || `Приключение в стиле ${game.title}`,
          }),
      );
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const { sessionId, mapState } = await insertLobbyScenario(
          client,
          game,
          theme,
          generatedScenario,
          ownerPlayerId,
          participants,
          initialInvitations,
        );
        await client.query('COMMIT');

        const state = await getSessionPublic(pool, sessionId, ownerPlayerId);
        response.status(201).json({
          session_id: sessionId,
          scenario: generatedScenario.scenario,
          campaign: {
            title: generatedScenario.scenario.title,
            genre: generatedScenario.scenario.genre,
            tone: generatedScenario.scenario.tone,
            short_description: generatedScenario.scenario.short_description,
            recommended_player_characters: generatedScenario.characters,
          },
          game_state: generatedScenario.game_state,
          map: mapState,
          choices: generatedScenario.choices,
          state,
        });
        for (const invitation of initialInvitations) {
          emitToUser(invitation.to_player_id, 'notification-created', {
            type: 'lobby_invitation',
            sessionId,
            invitationId: invitation.id,
          });
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }),
  );

  app.post(
    '/api/game-sessions/:id/scenario/revise',
    queuedRpgSessionRoute('scenario_revision', async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      const wish = normalizeString(request.body.wish);

      if (!wish) {
        response.status(400).json({ message: 'Опишите пожелание к сценарию.' });
        return;
      }

      if (wish.length > MAX_REVISION_WISH_LENGTH) {
        response.status(400).json({
          message: `Пожелание слишком длинное. Лимит: ${MAX_REVISION_WISH_LENGTH}`,
        });
        return;
      }

      const current = await getSessionPublic(pool, sessionId, playerId);

      if (!isSessionOwner(current.game_state.public_state, playerId)) {
        response.status(403).json({ message: 'Только ведущий может менять сценарий.' });
        return;
      }

      const selectedGame = current.game_state.public_state?.selected_game;
      const game = selectedGame?.id ? findAvailableGame(selectedGame.id) : null;

      if (!game) {
        response
          .status(400)
          .json({ message: 'Эта игра пока недоступна для генерации сценария.' });
        return;
      }

      const revision = await service.reviseLobbyScenario({
        game,
        currentScenario: current.game_state.public_state?.scenario ?? {},
        gameState: current.game_state.public_state?.game_state ?? {},
        mapState: current.map,
        choices: current.game_state.public_state?.current_choices ?? [],
        wish,
      });
      const updated = await applyScenarioRevision(
        pool,
        sessionId,
        playerId,
        game,
        revision,
      );
      emitToSession(sessionId, 'game-session-updated', updated);
      emitToSession(sessionId, 'game-map-updated', updated.map);

      response.json({
        scenario: revision.scenario,
        choices: revision.choices,
        session: updated,
      });
    }),
  );

  app.post(
    '/api/game-sessions/:id/characters/generate',
    queuedRpgSessionRoute('character_generation', async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      const publicState = await getSessionPublic(pool, sessionId, playerId);
      const game = publicState.game_state.public_state?.selected_game;

      if (!canUseSession(publicState.game_state.public_state, playerId)) {
        response.status(403).json({ message: 'Это лобби недоступно.' });
        return;
      }

      if (!game?.id || !findAvailableGame(game.id)) {
        response
          .status(400)
          .json({ message: 'Эта игра пока недоступна для генерации сценария.' });
        return;
      }

      const generatedPayload = await withGenerationLock(
        `character:${sessionId}`,
        () =>
          service.generateSingleCharacter({
            game,
            scenarioSummary: JSON.stringify({
              deepseek_chat_id:
                publicState.game_state.public_state?.deepseek_chat_id ?? sessionId,
              scenario: publicState.game_state.public_state?.scenario,
              goal:
                publicState.game_state.public_state?.game_state?.current_goal ??
                publicState.session.current_scene,
              game_state: publicState.game_state.public_state?.game_state ?? {},
              map: publicState.map
                ? {
                    name: publicState.map.name,
                    locations: publicState.map.locations ?? [],
                    routes: publicState.map.routes ?? [],
                    zones: publicState.map.zones ?? [],
                  }
                : null,
            }),
            existingCharacters: JSON.stringify(
              publicState.characters.map((character) => ({
                name: character.name,
                role: character.role,
                class_name: character.class_name,
                goal: character.goal,
              })),
            ),
          }),
      );
      const generated = normalizeCharacterPayload({
        ...generatedPayload,
        id: `char_${sessionId}_${randomUUID().slice(0, 12)}`,
      });
      const created = await insertCharacterRow(
        pool,
        sessionId,
        'party',
        generated,
        publicState.map,
      );
      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.status(201).json({ character: created, session: updated });
    }),
  );

  app.post(
    '/api/game-sessions/:id/characters',
    requireRpgAuth(async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      const payload = CreateCharacterSchema.parse({
        ...request.body.character,
        player_id: playerId,
      });
      const session = await getSessionPublic(pool, sessionId, payload.player_id);

      if (!canUseSession(session.game_state.public_state, playerId)) {
        response.status(403).json({ message: 'Это лобби недоступно.' });
        return;
      }

      const character = normalizeCharacterPayload(
        {
          ...payload,
          id: payload.id || `char_${randomUUID().slice(0, 12)}`,
        },
      );
      const created = await insertCharacterRow(
        pool,
        sessionId,
        'party',
        character,
        session.map,
      );

      await pool.query(
        `
          UPDATE game_sessions
          SET updated_at = now()
          WHERE id = $1
        `,
        [sessionId],
      );

      const updated = await getSessionPublic(pool, sessionId, payload.player_id);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.status(201).json({
        character: created,
        session: updated,
      });
    }),
  );

  app.post(
    '/api/game-sessions/:id/characters/:characterId/claim',
    requireRpgAuth(async (request, response) => {
      const sessionId = request.params.id;
      const characterId = request.params.characterId;
      const playerId = String(request.authUser.id);
      const state = await getSessionPublic(pool, sessionId, playerId);

      if (!canUseSession(state.game_state.public_state, playerId)) {
        response.status(403).json({ message: 'Это лобби недоступно.' });
        return;
      }

      if (state.session.status === 'finished') {
        response.status(400).json({ message: 'Игра уже завершена.' });
        return;
      }

      const current = await pool.query(
        'SELECT * FROM game_characters WHERE id = $1 AND session_id = $2',
        [characterId, sessionId],
      );
      const row = current.rows[0];

      if (!row) {
        response.status(404).json({ message: 'Персонаж не найден.' });
        return;
      }

      const currentOwner = String(row.player_id ?? '');
      const nextOwnerId = currentOwner === playerId ? 'party' : playerId;

      if (currentOwner && currentOwner !== playerId && currentOwner !== 'party') {
        response.status(400).json({ message: 'Этот персонаж уже выбран.' });
        return;
      }

      const result = await pool.query(
        `
          UPDATE game_characters
          SET player_id = $1, updated_at = now()
          WHERE id = $2 AND session_id = $3
          RETURNING *
        `,
        [nextOwnerId, characterId, sessionId],
      );

      await pool.query('UPDATE game_sessions SET updated_at = now() WHERE id = $1', [
        sessionId,
      ]);

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.json({
        character: toPublicCharacterV2(result.rows[0], playerId),
        session: updated,
      });
    }),
  );

  app.post(
    '/api/game-sessions/:id/players',
    requireRpgAuth(async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      const invitedPlayerId = normalizeString(
        request.body.player_id ?? request.body.playerId,
      );
      const state = await getSessionPublic(pool, sessionId, playerId);

      if (!canUseSession(state.game_state.public_state, playerId)) {
        response.status(403).json({ message: 'Это лобби недоступно.' });
        return;
      }

      if (state.session.status === 'finished') {
        response.status(400).json({ message: 'Игра уже завершена.' });
        return;
      }

      if (!invitedPlayerId) {
        response.status(400).json({ message: 'Выберите игрока.' });
        return;
      }

      const playerResult = await pool.query(
        `
          SELECT id::text AS id, name, username
          FROM app_users
          WHERE id::text = $1
          LIMIT 1
        `,
        [invitedPlayerId],
      );
      const invited = playerResult.rows[0];

      if (!invited) {
        response.status(404).json({ message: 'Игрок не найден.' });
        return;
      }

      const publicState = state.game_state.public_state ?? {};

      if (String(invited.id) === playerId) {
        response.status(400).json({ message: 'Нельзя пригласить себя.' });
        return;
      }

      if (isParticipant(publicState, invited.id)) {
        response.status(409).json({ message: 'Игрок уже в партии.' });
        return;
      }

      if (pendingLobbyInvitation(publicState, invited.id)) {
        response.status(409).json({ message: 'Приглашение уже отправлено.' });
        return;
      }

      const invitation = {
        id: `invite_${randomUUID().slice(0, 12)}`,
        session_id: sessionId,
        from_player_id: playerId,
        from_name: request.authUser.name ?? request.authUser.username ?? 'Ведущий',
        to_player_id: invited.id,
        to_name: invited.name,
        to_username: invited.username,
        status: 'pending',
        created_at: new Date().toISOString(),
        responded_at: null,
      };
      const invitations = [...lobbyInvitations(publicState), invitation];
      const participantIds = uniqueStrings([
        ...(publicState.participant_player_ids ?? []),
        playerId,
      ]);
      const participantsById = new Map(
        (publicState.participants ?? []).map((participant) => [
          String(participant.id),
          participant,
        ]),
      );

      await pool.query(
        `
          UPDATE game_states
          SET public_state_json = public_state_json || $1::jsonb,
              updated_at = now()
          WHERE session_id = $2
        `,
        [
          JSON.stringify({
            participant_player_ids: participantIds,
            participants: [...participantsById.values()],
            lobby_invitations: invitations,
          }),
          sessionId,
        ],
      );
      await pool.query('UPDATE game_sessions SET updated_at = now() WHERE id = $1', [
        sessionId,
      ]);

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      emitToUser(invited.id, 'notification-created', {
        type: 'lobby_invitation',
        sessionId,
        invitationId: invitation.id,
      });
      response.json({ session: updated });
    }),
  );

  app.post(
    '/api/game-sessions/:id/invitations/:invitationId/respond',
    queuedRpgSessionRoute('invitation_response', async (request, response) => {
      const sessionId = request.params.id;
      const invitationId = request.params.invitationId;
      const playerId = String(request.authUser.id);
      const status = normalizeString(request.body.status);

      if (status !== 'accepted' && status !== 'declined') {
        response
          .status(400)
          .json({ message: 'Выберите: принять или отклонить приглашение.' });
        return;
      }

      const current = await getSessionPublic(pool, sessionId, playerId);
      const publicState = current.game_state.public_state ?? {};
      const invitations = lobbyInvitations(publicState);
      const invitation = invitations.find(
        (item) =>
          item.id === invitationId &&
          String(item.to_player_id ?? '') === playerId &&
          item.status === 'pending',
      );

      if (!invitation) {
        response.status(404).json({ message: 'Активное приглашение не найдено.' });
        return;
      }

      const nextInvitations = invitations.map((item) =>
        item.id === invitationId
          ? { ...item, status, responded_at: new Date().toISOString() }
          : item,
      );
      const ownerId = String(publicState.owner_player_id ?? '');
      let participantIds = publicState.participant_player_ids ?? [];
      let participants = publicState.participants ?? [];

      if (status === 'accepted') {
        participantIds = uniqueStrings([...participantIds, ownerId, playerId]);
        const participantsById = new Map(
          participants.map((participant) => [String(participant.id), participant]),
        );
        participantsById.set(playerId, {
          id: playerId,
          name: request.authUser.name ?? invitation.to_name ?? 'Игрок',
          username: request.authUser.username ?? invitation.to_username,
          role: 'Игрок',
        });
        participants = [...participantsById.values()];
      }

      await pool.query(
        `
          UPDATE game_states
          SET public_state_json = public_state_json || $1::jsonb,
              updated_at = now()
          WHERE session_id = $2
        `,
        [
          JSON.stringify({
            participant_player_ids: participantIds,
            participants,
            lobby_invitations: nextInvitations,
          }),
          sessionId,
        ],
      );
      await pool.query('UPDATE game_sessions SET updated_at = now() WHERE id = $1', [
        sessionId,
      ]);

      const updatedForPlayer = await getSessionPublic(pool, sessionId, playerId);
      const ownerSession = ownerId
        ? await getSessionPublic(pool, sessionId, ownerId)
        : updatedForPlayer;
      emitToSession(sessionId, 'game-session-updated', ownerSession);
      emitToUser(playerId, 'notifications-updated', {
        type: 'lobby_invitation_responded',
        sessionId,
        invitationId,
        status,
      });
      if (ownerId) {
        emitToUser(ownerId, 'notifications-updated', {
          type: 'lobby_invitation_responded',
          sessionId,
          invitationId,
          status,
        });
      }

      response.json({ session: updatedForPlayer, status });
    }),
  );

  app.post(
    '/api/game-sessions/:id/characters/:characterId/assign',
    queuedRpgSessionRoute('character_assign', async (request, response) => {
      const sessionId = request.params.id;
      const characterId = request.params.characterId;
      const ownerId = String(request.authUser.id);
      const assigneeId = normalizeString(
        request.body.player_id ?? request.body.playerId,
      );
      const state = await getSessionPublic(pool, sessionId, ownerId);

      if (!isSessionOwner(state.game_state.public_state, ownerId)) {
        response
          .status(403)
          .json({ message: 'Только ведущий может назначать персонажей.' });
        return;
      }

      if (state.session.status === 'finished') {
        response.status(400).json({ message: 'Игра уже завершена.' });
        return;
      }

      const character = state.characters.find((item) => item.id === characterId);

      if (!character) {
        response.status(404).json({ message: 'Персонаж не найден.' });
        return;
      }

      const allowedIds = new Set([
        ownerId,
        'party',
        ...(state.game_state.public_state.participant_player_ids ?? []).map(String),
      ]);
      const nextOwnerId = assigneeId || 'party';

      if (!allowedIds.has(nextOwnerId)) {
        response
          .status(400)
          .json({ message: 'Назначать можно только участникам партии.' });
        return;
      }

      const result = await pool.query(
        `
          UPDATE game_characters
          SET player_id = $1, updated_at = now()
          WHERE id = $2 AND session_id = $3
          RETURNING *
        `,
        [nextOwnerId, characterId, sessionId],
      );
      await pool.query('UPDATE game_sessions SET updated_at = now() WHERE id = $1', [
        sessionId,
      ]);

      const updated = await getSessionPublic(pool, sessionId, ownerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      if (nextOwnerId !== 'party') {
        emitToUser(nextOwnerId, 'notifications-updated', {
          type: 'character_assigned',
          sessionId,
          characterId,
        });
      }

      response.json({
        character: toPublicCharacterV2(result.rows[0], ownerId),
        session: updated,
      });
    }),
  );

  app.patch(
    '/api/game-sessions/:id/characters/:characterId',
    queuedRpgSessionRoute('character_update', async (request, response) => {
      const sessionId = request.params.id;
      const characterId = request.params.characterId;
      const playerId = String(request.authUser.id);
      const current = await pool.query(
        'SELECT * FROM game_characters WHERE id = $1 AND session_id = $2',
        [characterId, sessionId],
      );
      const row = current.rows[0];
      const state = await getSessionPublic(pool, sessionId, playerId);

      if (!row) {
        response.status(404).json({ message: 'Персонаж не найден.' });
        return;
      }

      const isOwner = isSessionOwner(state.game_state.public_state, playerId);
      const canEditInDraft =
        state.session.status === 'draft' &&
        canUseSession(state.game_state.public_state, playerId);

      if (!canEditInDraft && playerId && String(row.player_id) !== playerId && !isOwner) {
        response.status(403).json({ message: 'Этого персонажа нельзя изменить.' });
        return;
      }

      const stored = rowCharacterStorage(row);
      const merged = normalizeCharacterPayload({
        id: row.id,
        name: row.name,
        role: row.role,
        origin: stored.origin,
        class_name: row.class_name,
        description: stored.description,
        goal: row.goal,
        weakness: row.weakness,
        secret: row.secret,
        stats: stored.stats,
        derived: stored.derived,
        resources: stored.resources,
        skills: stored.skills,
        inventory: row.inventory_json ?? [],
        status_effects: row.status_effects_json ?? [],
        is_player_character: stored.is_player_character,
        ...(request.body.character ?? {}),
      });

      const result = await pool.query(
        `
          UPDATE game_characters
          SET
            name = $1,
            race = $2,
            class_name = $3,
            role = $4,
            background = $5,
            goal = $6,
            weakness = $7,
            secret = $8,
            stats_json = $9,
            hp_current = $10,
            hp_max = $11,
            inventory_json = $12,
        status_effects_json = $13,
            is_active = $14,
            updated_at = now()
          WHERE id = $15 AND session_id = $16
          RETURNING *
        `,
        [
          merged.name,
          merged.origin,
          merged.class_name,
          merged.role,
          merged.description,
          merged.goal,
          merged.weakness,
          merged.secret,
          JSON.stringify(characterStatsStorage(merged)),
          merged.derived.hp_current,
          merged.derived.hp_max,
          JSON.stringify(merged.inventory),
          JSON.stringify(merged.status_effects),
          merged.is_active ?? true,
          characterId,
          sessionId,
        ],
      );

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.json({
        character: toPublicCharacterV2(result.rows[0], playerId),
        session: updated,
      });
    }),
  );

  app.post(
    '/api/game-sessions/:id/characters/:characterId/revise',
    queuedRpgSessionRoute('character_revision', async (request, response) => {
      const sessionId = request.params.id;
      const characterId = request.params.characterId;
      const playerId = String(request.authUser.id);
      const wish = normalizeString(request.body.wish);

      if (!wish) {
        response.status(400).json({ message: 'Опишите пожелание к персонажу.' });
        return;
      }

      if (wish.length > MAX_REVISION_WISH_LENGTH) {
        response.status(400).json({
          message: `Пожелание слишком длинное. Лимит: ${MAX_REVISION_WISH_LENGTH}`,
        });
        return;
      }

      const current = await getSessionPublic(pool, sessionId, playerId);
      const character = current.characters.find((item) => item.id === characterId);

      if (!character) {
        response.status(404).json({ message: 'Персонаж не найден.' });
        return;
      }

      if (
        String(character.player_id) !== playerId &&
        !isSessionOwner(current.game_state.public_state, playerId)
      ) {
        response.status(403).json({ message: 'Этого персонажа нельзя изменить.' });
        return;
      }

      if (current.session.status === 'finished') {
        response.status(400).json({ message: 'Игра уже завершена.' });
        return;
      }

      const selectedGame = current.game_state.public_state?.selected_game;
      const game = selectedGame?.id ? findAvailableGame(selectedGame.id) : null;

      if (!game) {
        response
          .status(400)
          .json({ message: 'Эта игра пока недоступна для генерации сценария.' });
        return;
      }

      const revisedPayload = await service.reviseCharacter({
        game,
        scenarioSummary: JSON.stringify({
          scenario: current.game_state.public_state?.scenario,
          goal: current.game_state.public_state?.game_state?.current_goal,
          scene: current.session.current_scene,
          characters: current.characters.map((item) => ({
            name: item.name,
            role: item.role,
            class_name: item.class_name,
          })),
        }),
        character,
        wish,
      });
      const revised = normalizeCharacterPayload({
        ...revisedPayload,
        id: characterId,
      });
      const result = await pool.query(
        `
          UPDATE game_characters
          SET
            name = $1,
            race = $2,
            class_name = $3,
            role = $4,
            background = $5,
            goal = $6,
            weakness = $7,
            secret = $8,
            stats_json = $9,
            hp_current = $10,
            hp_max = $11,
            inventory_json = $12,
            status_effects_json = $13,
            is_active = $14,
            updated_at = now()
          WHERE id = $15 AND session_id = $16
          RETURNING *
        `,
        [
          revised.name,
          revised.origin,
          revised.class_name,
          revised.role,
          revised.description,
          revised.goal,
          revised.weakness,
          revised.secret,
          JSON.stringify(characterStatsStorage(revised)),
          revised.derived.hp_current,
          revised.derived.hp_max,
          JSON.stringify(revised.inventory),
          JSON.stringify(revised.status_effects),
          revised.is_active ?? true,
          characterId,
          sessionId,
        ],
      );

      await pool.query('UPDATE game_sessions SET updated_at = now() WHERE id = $1', [
        sessionId,
      ]);

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.json({
        character: toPublicCharacterV2(result.rows[0], playerId),
        session: updated,
      });
    }),
  );

  app.delete(
    '/api/game-sessions/:id/characters/:characterId',
    queuedRpgSessionRoute('character_delete', async (request, response) => {
      const sessionId = request.params.id;
      const characterId = request.params.characterId;
      const playerId = String(request.authUser.id);
      const current = await pool.query(
        'SELECT * FROM game_characters WHERE id = $1 AND session_id = $2',
        [characterId, sessionId],
      );
      const row = current.rows[0];
      const state = await getSessionPublic(pool, sessionId, playerId);

      if (!row) {
        response.status(404).json({ message: 'Персонаж не найден.' });
        return;
      }

      if (
        playerId &&
        String(row.player_id) !== playerId &&
        !isSessionOwner(state.game_state.public_state, playerId)
      ) {
        response.status(403).json({ message: 'Этого персонажа нельзя удалить.' });
        return;
      }

      await pool.query('DELETE FROM game_characters WHERE id = $1 AND session_id = $2', [
        characterId,
        sessionId,
      ]);

      const afterDeleteState = await getSessionPublic(pool, sessionId, playerId);
      const mapState = afterDeleteState.map
        ? {
            ...afterDeleteState.map,
            tokens: afterDeleteState.map.tokens.filter((token) => token.id !== characterId),
          }
        : null;

      if (mapState) {
        await pool.query(
          'UPDATE game_states SET map_state_json = $1, updated_at = now() WHERE session_id = $2',
          [JSON.stringify(mapState), sessionId],
        );
      }

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.json({ session: updated });
    }),
  );

  app.post(
    '/api/game-sessions/:id/start',
    queuedRpgSessionRoute('session_start', async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      const state = await getSessionPublic(pool, sessionId, playerId);

      if (!state.characters.length) {
        response.status(400).json({ message: 'Сначала нужен хотя бы один персонаж.' });
        return;
      }

      await pool.query(
        `
          UPDATE game_sessions
          SET status = 'active',
              current_phase = 'playing',
              current_scene = COALESCE(NULLIF(current_scene, ''), $1),
              updated_at = now()
          WHERE id = $2
        `,
        [
          state.game_state.public_state?.scenario?.starting_scene ??
            state.session.current_scene,
          sessionId,
        ],
      );

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.json(updated);
    }),
  );

  app.post(
    '/api/game-sessions/:id/finish',
    queuedRpgSessionRoute('session_finish', async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);

      await pool.query(
        `
          UPDATE game_sessions
          SET status = 'finished',
              current_phase = 'finished',
              turn_mode = false,
              current_actor_id = null,
              updated_at = now()
          WHERE id = $1
        `,
        [sessionId],
      );

      await createGameMessage(pool, {
        session_id: sessionId,
        role: 'gm',
        content: 'Игра завершена. История сохранена в вашем аккаунте.',
      });

      await applyGameMasterPatches(
        pool,
        sessionId,
        { changed: false, updates: {} },
        { changed: false, updates: {} },
        [],
      );

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.json(updated);
    }),
  );

  app.get(
    '/api/game-sessions/:id',
    requireRpgAuth(async (request, response) => {
      response.json(
        await getSessionPublic(
          pool,
          request.params.id,
          String(request.authUser.id),
        ),
      );
    }),
  );

  app.get(
    '/api/game-sessions/:id/messages',
    requireRpgAuth(async (request, response) => {
      const state = await getSessionPublic(
        pool,
        request.params.id,
        String(request.authUser.id),
      );

      if (!canUseSession(state.game_state.public_state, String(request.authUser.id))) {
        response.status(403).json({ message: 'Это лобби недоступно.' });
        return;
      }

      const result = await pool.query(
        `
          SELECT *
          FROM game_messages
          WHERE session_id = $1 AND visible_to_players = true
          ORDER BY created_at ASC
        `,
        [request.params.id],
      );
      response.json(result.rows.map(toMessage));
    }),
  );

  app.post(
    '/api/game-sessions/:id/messages/trim',
    queuedRpgSessionRoute('chat_trim', async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      const removeCount = clamp(request.body?.count ?? 6, 1, 30);
      const state = await getSessionPublic(pool, sessionId, playerId);

      if (!canUseSession(state.game_state.public_state, playerId)) {
        response.status(403).json({ message: 'Это лобби недоступно.' });
        return;
      }

      if (state.session.status === 'finished') {
        response.status(409).json({ message: 'Игра уже завершена.' });
        return;
      }

      await pool.query(
        `
          DELETE FROM game_messages
          WHERE id IN (
            SELECT id
            FROM game_messages
            WHERE session_id = $1
              AND visible_to_players = true
            ORDER BY created_at DESC
            LIMIT $2
          )
        `,
        [sessionId, removeCount],
      );

      await pool.query('UPDATE game_sessions SET updated_at = now() WHERE id = $1', [
        sessionId,
      ]);

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.json({
        removed: removeCount,
        state: updated,
      });
    }),
  );

  app.post(
    '/api/game-sessions/:id/messages/delete',
    queuedRpgSessionRoute('chat_trim', async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      const state = await getSessionPublic(pool, sessionId, playerId);
      const ids = Array.isArray(request.body?.message_ids)
        ? request.body.message_ids.map((value) => normalizeString(value)).filter(Boolean)
        : [];

      if (!canUseSession(state.game_state.public_state, playerId)) {
        response.status(403).json({ message: 'Это лобби недоступно.' });
        return;
      }

      if (!ids.length) {
        response.status(400).json({ message: 'Выберите сообщения для удаления.' });
        return;
      }

      const limitedIds = uniqueStrings(ids).slice(0, 50);
      const deleted = await pool.query(
        `
          DELETE FROM game_messages
          WHERE session_id = $1
            AND id = ANY($2::text[])
            AND visible_to_players = true
          RETURNING id
        `,
        [sessionId, limitedIds],
      );

      await pool.query('UPDATE game_sessions SET updated_at = now() WHERE id = $1', [
        sessionId,
      ]);

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-session-updated', updated);
      response.json({
        removed: deleted.rowCount ?? 0,
        state: updated,
      });
    }),
  );

  app.post(
    '/api/game-sessions/:id/messages',
    queuedRpgSessionRoute('game_action', async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      let characterId = normalizeString(request.body.character_id);
      const content = normalizeString(request.body.content);

      if (!playerId || !characterId) {
        response.status(400).json({ message: 'Выберите персонажа для действия.' });
        return;
      }

      if (!content) {
        response.status(400).json({ message: 'Опишите действие персонажа.' });
        return;
      }

      if (content.length > MAX_MESSAGE_LENGTH) {
        response
          .status(400)
          .json({ message: `Действие слишком длинное. Лимит: ${MAX_MESSAGE_LENGTH}` });
        return;
      }

      if (isUnknownCommand(content)) {
        response
          .status(400)
          .json({ message: 'Опишите действие персонажа внутри сцены.' });
        return;
      }

      let session = await getSessionPublic(pool, sessionId, playerId);

      if (session.session.status === 'finished') {
        response.status(409).json({ message: 'Игра уже завершена.' });
        return;
      }

      if (session.session.turn_mode) {
        const currentActorId = String(session.session.current_actor_id ?? '');
        const currentCharacter = session.characters.find(
          (item) => item.id === currentActorId,
        );
        const currentNpc = session.npcs.find((item) => item.id === currentActorId);
        const invalidCurrentActor =
          !currentActorId ||
          (!currentCharacter && !currentNpc) ||
          (currentCharacter &&
            (!currentCharacter.is_active || currentCharacter.derived?.hp_current <= 0));

        if (invalidCurrentActor) {
          const nextActorId = await advanceTurn(pool, sessionId);
          if (nextActorId) {
            session = await getSessionPublic(pool, sessionId, playerId);
            emitToSession(sessionId, 'game-turn-updated', session);
            emitToSession(sessionId, 'game-session-updated', session);
          }
        }
      }

      let character = session.characters.find((item) => item.id === characterId);

      if (
        session.session.turn_mode &&
        session.session.current_actor_id &&
        session.session.current_actor_id !== characterId
      ) {
        const currentActor = session.characters.find(
          (item) => item.id === session.session.current_actor_id,
        );
        if (currentActor && String(currentActor.player_id) === playerId) {
          characterId = currentActor.id;
          character = currentActor;
        }
      }

      if (!character) {
        response.status(404).json({ message: 'Персонаж не найден.' });
        return;
      }

      if (!character.is_active || Number(character.derived?.hp_current ?? 0) <= 0) {
        const moved = await ensureCurrentActorAlive(pool, sessionId);
        const refreshed = await getSessionPublic(pool, sessionId, playerId);
        if (moved) {
          emitToSession(sessionId, 'game-turn-updated', refreshed);
          emitToSession(sessionId, 'game-session-updated', refreshed);
        }
        response.status(409).json({
          message:
            'Этот персонаж погиб и больше не может действовать. Выберите живого персонажа.',
        });
        return;
      }

      if (String(character.player_id) !== playerId) {
        response.status(403).json({ message: 'Этим персонажем сейчас нельзя действовать.' });
        return;
      }

      const isOutOfTurnAction =
        session.session.turn_mode &&
        session.session.current_actor_id !== characterId &&
        !isAllowedCommand(content) &&
        !isSpeechOnly(content);

      if (isOutOfTurnAction) {
        const currentTurnActorId =
          session.turns.find((turn) => turn.is_current)?.actor_id ??
          session.session.current_actor_id ??
          '';
        const currentActorName =
          session.characters.find((item) => item.id === currentTurnActorId)
            ?.name ??
          session.npcs.find((item) => item.id === currentTurnActorId)
            ?.name ??
          (currentTurnActorId ? `персонаж ${currentTurnActorId}` : 'другого персонажа');
        const playerMessage = await createGameMessage(pool, {
          session_id: sessionId,
          player_id: playerId,
          character_id: characterId,
          role: 'player',
          content,
        });
        const gmMessage = await createGameMessage(pool, {
          session_id: sessionId,
          role: 'gm',
          content:
            `Реплика принята. Сейчас ожидается ход: ${currentActorName}. Игровое действие отложено до вашего хода.`,
        });
        const updatedState = await getSessionPublic(pool, sessionId, playerId);
        emitToSession(sessionId, 'game-message-created', {
          player_message: playerMessage,
          gm_message: gmMessage,
        });
        response.json({
          player_message: playerMessage,
          gm_message: gmMessage,
          state: updatedState,
          choices: session.game_state.public_state?.current_choices ?? fallbackChoices(),
          warning: 'out_of_turn_as_speech',
        });
        return;
      }

      const suspiciousReason = detectPromptInjection(content);
      const playerMessage = await createGameMessage(pool, {
        session_id: sessionId,
        player_id: playerId,
        character_id: characterId,
        role: 'player',
        content,
      });

      if (suspiciousReason) {
        await logSuspiciousMessage(
          pool,
          sessionId,
          playerId,
          characterId,
          content,
          suspiciousReason,
        );
        const gmMessage = await createGameMessage(pool, {
          session_id: sessionId,
          role: 'gm',
          content:
            'Такое действие нельзя выполнить напрямую. Опишите, что персонаж делает внутри игры.',
        });
        await applyGameMasterPatches(
          pool,
          sessionId,
          { changed: false, updates: {} },
          { changed: false, updates: {} },
          fallbackChoices(),
        );
        const updated = await getSessionPublic(pool, sessionId, playerId);
        emitToSession(sessionId, 'game-message-created', {
          player_message: playerMessage,
          gm_message: gmMessage,
        });
        emitToSession(sessionId, 'game-session-updated', updated);
        response.json({
          player_message: playerMessage,
          gm_message: gmMessage,
          state: updated,
          choices: fallbackChoices(),
          warning: 'prompt_injection_rejected',
        });
        return;
      }

      if (isAllowedCommand(content)) {
        const gmMessage = await createGameMessage(pool, {
          session_id: sessionId,
          role: 'gm',
          content: await buildCommandResponse(
            pool,
            sessionId,
            playerId,
            characterId,
            content.toLowerCase(),
          ),
        });
        emitToSession(sessionId, 'game-message-created', {
          player_message: playerMessage,
          gm_message: gmMessage,
        });
        await applyGameMasterPatches(
          pool,
          sessionId,
          { changed: false, updates: {} },
          { changed: false, updates: {} },
          session.game_state.public_state?.current_choices ?? fallbackChoices(),
        );
        response.json({
          player_message: playerMessage,
          gm_message: gmMessage,
          state: await getSessionPublic(pool, sessionId, playerId),
          choices: session.game_state.public_state?.current_choices ?? fallbackChoices(),
        });
        return;
      }

      await spendRerollPoints(
        pool,
        sessionId,
        characterId,
        request.body.roll_result?.rerolls_spent ?? 0,
      );

      const actionPayload = {
        content,
        choice: request.body.choice ?? null,
        roll_result: request.body.roll_result ?? null,
      };

      let processed = await service.processGameAction(
        sessionId,
        playerId,
        characterId,
        actionPayload,
      );

      let retryCount = 0;
      while (processed.parseError && retryCount < MAX_AI_PARSE_RETRIES) {
        retryCount += 1;
        console.warn(
          '[DeepSeek] processGameAction auto-retry after parse_error',
          JSON.stringify({
            session_id: sessionId,
            player_id: playerId,
            character_id: characterId,
            retry: retryCount,
            action_preview: String(content).slice(0, 120),
          }),
        );
        processed = await service.processGameAction(
          sessionId,
          playerId,
          characterId,
          actionPayload,
        );
      }
      const gmMessage = await createGameMessage(pool, {
        session_id: sessionId,
        role: 'gm',
        content:
          processed.message.text ||
          'Ведущий на мгновение замолчал. Попробуйте повторить действие.',
      });

      await applyGameMasterPatches(
        pool,
        sessionId,
        processed.statePatch,
        processed.mapPatch,
        processed.choices,
      );
      const movedAfterPatch = await ensureCurrentActorAlive(pool, sessionId);
      await maybeSummarize(service, pool, sessionId);

      const updatedState = await getSessionPublic(pool, sessionId, playerId);
      if (movedAfterPatch) {
        emitToSession(sessionId, 'game-turn-updated', updatedState);
      }
      emitToSession(sessionId, 'game-message-created', {
        player_message: playerMessage,
        gm_message: gmMessage,
      });
      emitToSession(sessionId, 'game-session-updated', updatedState);

      response.json({
        player_message: playerMessage,
        gm_message: gmMessage,
        state: updatedState,
        choices: processed.choices,
        parse_error: processed.parseError,
      });
      if (processed.parseError) {
        console.warn(
          '[DeepSeek] parse_error surfaced to client',
          JSON.stringify({
            session_id: sessionId,
            player_id: playerId,
            character_id: characterId,
            action_preview: String(content).slice(0, 120),
          }),
        );
      }
    }),
  );

  app.post(
    '/api/game-sessions/:id/guide-chat',
    requireRpgAuth(async (request, response) => {
      const sessionId = request.params.id;
      const playerId = String(request.authUser.id);
      const question = normalizeString(request.body.question);

      if (!question) {
        response.status(400).json({ message: 'Напишите вопрос по игре.' });
        return;
      }

      if (question.length > MAX_MESSAGE_LENGTH) {
        response
          .status(400)
          .json({ message: `Вопрос слишком длинный. Лимит: ${MAX_MESSAGE_LENGTH}` });
        return;
      }

      await getSessionPublic(pool, sessionId, playerId);

      if (detectPromptInjection(question)) {
        response.json({
          answer:
            'Такой вопрос нельзя разобрать вне сцены. Спросите о том, что персонаж уже знает или видит.',
        });
        return;
      }

      const answer = await service.answerGameQuestion(sessionId, playerId, question);
      response.json({ answer });
    }),
  );

  app.post(
    '/api/game-sessions/:id/summary',
    asyncRoute(async (request, response) => {
      const summary = await service.summarizeGameSession(request.params.id);
      response.json(summary);
    }),
  );

  app.get(
    '/api/game-sessions/:id/map',
    asyncRoute(async (request, response) => {
      const session = await getSessionPublic(
        pool,
        request.params.id,
        request.query.player_id ?? null,
      );

      if (!session.map) {
        response.status(404).json({ message: 'Карта пока не найдена.' });
        return;
      }

      response.json(session.map);
    }),
  );

  app.patch(
    '/api/game-sessions/:id/map/tokens/:tokenId',
    queuedRpgSessionRoute('map_token_move', async (request, response) => {
      const sessionId = request.params.id;
      const tokenId = request.params.tokenId;
      const playerId = String(request.authUser.id);
      const state = await getSessionPublic(pool, sessionId, playerId);
      const character = state.characters.find((item) => item.id === tokenId);

      if (!state.map) {
        response.status(404).json({ message: 'Карта пока не найдена.' });
        return;
      }

      if (!character) {
        response.status(404).json({ message: 'Этот жетон нельзя переместить.' });
        return;
      }

      if (String(character.player_id) !== playerId) {
        response.status(403).json({ message: 'Нельзя переместить чужого героя.' });
        return;
      }

      if (state.session.turn_mode && state.session.current_actor_id !== tokenId) {
        response.status(409).json({ message: 'Перемещение доступно только в свой ход.' });
        return;
      }

      const x = clamp(request.body.x, 0, state.map.width);
      const y = clamp(request.body.y, 0, state.map.height);

      if (state.session.scene_type === 'combat') {
        const dx = x - character.x;
        const dy = y - character.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDistance = (state.map.grid?.cell_size ?? 50) * 6;

        if (distance > maxDistance) {
          response.status(400).json({
            message: `Слишком далеко для этого хода. Дистанция: ${Math.round(maxDistance)}`,
          });
          return;
        }
      }

      const mapState = {
        ...state.map,
        tokens: state.map.tokens.map((token) =>
          token.id === tokenId ? { ...token, x, y } : token,
        ),
      };

      await pool.query(
        `
          UPDATE game_characters
          SET x = $1, y = $2, updated_at = now()
          WHERE id = $3 AND session_id = $4
        `,
        [x, y, tokenId, sessionId],
      );
      await pool.query(
        `
          UPDATE game_states
          SET map_state_json = $1, updated_at = now()
          WHERE session_id = $2
        `,
        [JSON.stringify(mapState), sessionId],
      );

      const updated = await getSessionPublic(pool, sessionId, playerId);
      emitToSession(sessionId, 'game-map-updated', updated.map);
      response.json(updated.map);
    }),
  );

  app.get(
    '/api/game-sessions/:id/turns',
    asyncRoute(async (request, response) => {
      const state = await getSessionPublic(pool, request.params.id);
      response.json(state.turns);
    }),
  );

  app.post(
    '/api/game-sessions/:id/turns/next',
    asyncRoute(async (request, response) => {
      const adminToken = process.env.GAME_MASTER_ADMIN_TOKEN;

      if (!adminToken || request.headers['x-gm-action-token'] !== adminToken) {
        response.status(403).json({ message: 'GM action token is required' });
        return;
      }

      const nextActorId = await advanceTurn(pool, request.params.id);
      const state = await getSessionPublic(pool, request.params.id);
      emitToSession(request.params.id, 'game-turn-updated', state);
      response.json({ current_actor_id: nextActorId, state });
    }),
  );
}
