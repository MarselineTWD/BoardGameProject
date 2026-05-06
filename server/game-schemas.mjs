import { z } from 'zod';

const JsonObjectSchema = z.record(z.string(), z.unknown());

const StatsSchema = z
  .object({
    strength: z.coerce.number().min(1).max(30).default(10),
    dexterity: z.coerce.number().min(1).max(30).default(10),
    endurance: z.coerce.number().min(1).max(30).default(10),
    intelligence: z.coerce.number().min(1).max(30).default(10),
    perception: z.coerce.number().min(1).max(30).default(10),
    charisma: z.coerce.number().min(1).max(30).default(10),
    willpower: z.coerce.number().min(1).max(30).default(10),
  })
  .catchall(z.coerce.number().min(0).max(40));

export const STAT_KEYS = [
  'strength',
  'dexterity',
  'endurance',
  'intelligence',
  'perception',
  'charisma',
  'willpower',
];

const STAT_ALIASES = {
  strength: 'strength',
  сила: 'strength',
  dexterity: 'dexterity',
  ловкость: 'dexterity',
  endurance: 'endurance',
  выносливость: 'endurance',
  intelligence: 'intelligence',
  интеллект: 'intelligence',
  perception: 'perception',
  восприятие: 'perception',
  внимательность: 'perception',
  наблюдательность: 'perception',
  поиск: 'perception',
  investigation: 'intelligence',
  расследование: 'intelligence',
  анализ: 'intelligence',
  knowledge: 'intelligence',
  знание: 'intelligence',
  arcana: 'intelligence',
  магия: 'intelligence',
  техника: 'intelligence',
  stealth: 'dexterity',
  скрытность: 'dexterity',
  акробатика: 'dexterity',
  взлом: 'dexterity',
  lockpicking: 'dexterity',
  athletics: 'strength',
  атлетика: 'strength',
  persuasion: 'charisma',
  убеждение: 'charisma',
  deception: 'charisma',
  обман: 'charisma',
  intimidation: 'charisma',
  запугивание: 'charisma',
  fear: 'willpower',
  страх: 'willpower',
  концентрация: 'willpower',
  charisma: 'charisma',
  харизма: 'charisma',
  willpower: 'willpower',
  воля: 'willpower',
};

export const StatKeySchema = z.preprocess((value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return STAT_ALIASES[normalized] ?? 'perception';
}, z.enum(STAT_KEYS));

function normalizeSkillId(name) {
  return String(name ?? 'skill')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'skill';
}

function inferStatFromSkillName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();

  for (const [alias, stat] of Object.entries(STAT_ALIASES)) {
    if (normalized.includes(alias)) {
      return stat;
    }
  }

  return 'perception';
}

export const SkillSchema = z
  .preprocess((value) => {
    if (typeof value === 'string') {
      const name = value.trim();
      return {
        id: normalizeSkillId(name),
        name,
        stat: inferStatFromSkillName(name),
        bonus: 2,
      };
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const skill = { ...value };
      const name = String(skill.name ?? skill.title ?? skill.id ?? 'Навык').trim();

      return {
        ...skill,
        id: String(skill.id ?? normalizeSkillId(name)).slice(0, 80),
        name,
        stat: skill.stat ?? skill.attribute ?? skill.characteristic ?? inferStatFromSkillName(name),
        bonus: skill.bonus ?? skill.modifier ?? 0,
      };
    }

    return value;
  },
  z
    .object({
      id: z.string().min(1).max(80),
      name: z.string().min(1).max(120),
      stat: StatKeySchema,
      bonus: z.coerce.number().int().min(-10).max(20).default(0),
    })
    .passthrough());

export const DerivedSchema = z
  .object({
    hp_current: z.coerce.number().int().min(0).max(500).default(10),
    hp_max: z.coerce.number().int().min(1).max(500).default(10),
    armor: z.coerce.number().int().min(0).max(50).default(0),
    initiative: z.coerce.number().int().min(-20).max(50).default(0),
    movement: z.coerce.number().min(0).max(100).default(6),
  })
  .default({});

export const ResourcesSchema = z
  .object({
    reroll_points: z.coerce.number().int().min(0).max(20).default(2),
  })
  .passthrough()
  .default({});

export const CharacterSchema = z
  .object({
    id: z.string().min(1).max(120).optional(),
    name: z.string().min(1).max(120),
    role: z.string().max(160).default(''),
    origin: z.string().max(160).default(''),
    class_name: z.string().max(160).default(''),
    description: z.string().max(1600).default(''),
    goal: z.string().max(800).default(''),
    weakness: z.string().max(800).default(''),
    secret: z.string().max(900).default(''),
    stats: StatsSchema.default({}),
    derived: DerivedSchema,
    resources: ResourcesSchema,
    skills: z.array(SkillSchema).default([]),
    inventory: z.array(z.unknown()).default([]),
    status_effects: z.array(z.unknown()).default([]),
    is_player_character: z.boolean().default(true),
  })
  .passthrough();

export const CharacterTemplateSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).max(120),
    race: z.string().max(120).default(''),
    class_name: z.string().max(120).default(''),
    archetype: z.string().max(160).default(''),
    role: z.string().max(160).optional(),
    background: z.string().max(1500).default(''),
    goal: z.string().max(600).default(''),
    strength: z.string().max(400).default(''),
    weakness: z.string().max(400).default(''),
    secret: z.string().max(600).default(''),
    stats: StatsSchema.default({}),
    hp_max: z.coerce.number().int().min(1).max(300).default(10),
    inventory: z.array(z.unknown()).default([]),
  })
  .passthrough();

export const QuestSchema = z
  .object({
    id: z.string().min(1).optional(),
    title: z.string().min(1).max(180),
    description: z.string().max(1400).default(''),
    status: z.string().max(80).default('active'),
    known_to_players: z.boolean().default(true).optional(),
    state: JsonObjectSchema.default({}).optional(),
  })
  .passthrough();

export const NpcSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).max(120),
    role: z.string().max(160).default(''),
    personality: z.string().max(700).default(''),
    goal: z.string().max(700).default(''),
    knows: z.array(z.string()).default([]),
    secret: z.string().max(900).default(''),
    attitude: z.string().max(300).default(''),
    location_id: z.string().nullable().optional(),
    x: z.coerce.number().min(0).max(100000).default(100).optional(),
    y: z.coerce.number().min(0).max(100000).default(100).optional(),
    visible_to_players: z.boolean().default(true),
    state: JsonObjectSchema.default({}).optional(),
  })
  .passthrough();

export const MapLocationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(160),
    x: z.coerce.number().min(0).max(100000),
    y: z.coerce.number().min(0).max(100000),
    visible_to_players: z.boolean().default(true),
    description: z.string().max(1000).default(''),
    danger_level: z.coerce.number().min(0).max(10).optional(),
  })
  .passthrough();

export const MapTokenSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['player', 'npc', 'enemy', 'object']).default('object'),
    name: z.string().max(160).default(''),
    x: z.coerce.number().min(0).max(100000),
    y: z.coerce.number().min(0).max(100000),
    visible: z.boolean().default(true),
  })
  .passthrough();

export const MapStateSchema = z
  .object({
    map_id: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    name: z.string().max(180).default('Карта'),
    image_url: z.string().max(1000).default(''),
    type: z.string().max(120).optional(),
    map_type: z.string().max(120).optional(),
    width: z.coerce.number().int().min(400).max(10000).default(2000),
    height: z.coerce.number().int().min(400).max(10000).default(1200),
    background: JsonObjectSchema.default({}).optional(),
    grid: z
      .object({
        enabled: z.boolean().default(false),
        cell_size: z.coerce.number().int().min(10).max(500).default(50),
        type: z.string().max(40).default('square'),
        visible: z.boolean().optional(),
      })
      .default({}),
    tokens: z.array(MapTokenSchema).default([]),
    locations: z.array(MapLocationSchema).default([]),
    routes: z.array(JsonObjectSchema).default([]).optional(),
    zones: z.array(JsonObjectSchema).default([]).optional(),
    areas: z.array(JsonObjectSchema).default([]).optional(),
    objects: z.array(JsonObjectSchema).default([]).optional(),
    labels: z.array(JsonObjectSchema).default([]).optional(),
    visibility: JsonObjectSchema.default({}).optional(),
    viewport: JsonObjectSchema.default({}).optional(),
    legend: z.array(JsonObjectSchema).default([]).optional(),
    current_focus: JsonObjectSchema.default({}).optional(),
    fog_of_war: z
      .union([
        z.boolean(),
        z
          .object({
            enabled: z.boolean().default(true),
            mode: z.string().max(80).default('soft'),
            unexplored_opacity: z.coerce.number().min(0).max(1).default(0.65),
            explored_opacity: z.coerce.number().min(0).max(1).default(0.25),
          })
          .passthrough(),
      ])
      .default(false),
  })
  .passthrough();

export const MapSpecSchema = z
  .object({
    map_type: z.string().max(120).default('region_or_location'),
    visual_style: z.string().max(800).default('Atmospheric illustrated map'),
    image_url: z.string().max(1000).default('').optional(),
    width: z.coerce.number().int().min(400).max(10000).default(2000),
    height: z.coerce.number().int().min(400).max(10000).default(1200),
    grid_enabled: z.boolean().default(false),
    grid_cell_size: z.coerce.number().int().min(10).max(500).default(50),
    locations: z.array(MapLocationSchema).default([]),
    player_tokens: z.array(MapTokenSchema).default([]),
    npc_tokens: z.array(MapTokenSchema).default([]),
    fog_of_war: z.boolean().default(true),
  })
  .passthrough();

export const CampaignSchema = z
  .object({
    title: z.string().min(1).max(180),
    genre: z.string().max(120).default(''),
    tone: z.string().max(160).default(''),
    short_description: z.string().max(1500).default(''),
    world: z
      .object({
        name: z.string().max(160).default(''),
        description: z.string().max(2000).default(''),
        rules: z.array(z.string()).default([]),
      })
      .default({}),
    main_conflict: z
      .object({
        public_conflict: z.string().max(1200).default(''),
        hidden_conflict: z.string().max(1200).default(''),
        stakes: z.string().max(1200).default(''),
      })
      .default({}),
    starting_location: z
      .object({
        name: z.string().max(160).default(''),
        type: z.string().max(120).default(''),
        description: z.string().max(1800).default(''),
        important_places: z.array(MapLocationSchema).default([]),
      })
      .default({}),
    factions: z.array(JsonObjectSchema).default([]),
    npcs: z.array(NpcSchema).default([]),
    recommended_player_characters: z
      .array(CharacterTemplateSchema)
      .min(1)
      .max(8)
      .default([]),
    opening_scene: z
      .object({
        title: z.string().max(180).default('Первая сцена'),
        description: z.string().max(1800).default(''),
        immediate_problem: z.string().max(900).default(''),
        available_actions: z.array(z.string()).default([]),
      })
      .default({}),
    game_state: z
      .object({
        phase: z.string().max(80).default('character_creation'),
        current_scene: z.string().max(180).default('opening_preparation'),
        current_actor_id: z.string().nullable().default(null),
        turn_mode: z.boolean().default(false),
        scene_type: z.string().max(80).default('preparation'),
        round: z.coerce.number().int().min(0).max(9999).default(0),
        turn_order: z.array(z.string()).default([]),
        time: z.string().max(180).default('Начало игры'),
        danger_level: z.coerce.number().min(0).max(10).default(1),
        active_quests: z.array(QuestSchema).default([]),
        known_facts: z.array(z.string()).default([]),
        hidden_gm_notes: z.array(z.string()).default([]),
      })
      .default({}),
    map_spec: MapSpecSchema.default({}),
  })
  .passthrough();

export const RollSchema = z
  .object({
    dice: z.string().min(1).max(20).default('d20'),
    stat: StatKeySchema,
    skill_id: z.string().nullable().default(null),
    difficulty: z.coerce.number().int().min(1).max(40),
    success_condition: z.string().max(120).default('total >= difficulty'),
    reason: z.string().max(600).default('Проверка рискованного действия'),
    success_hint: z.string().max(700).default('Действие удаётся'),
    failure_hint: z.string().max(700).default('Возникает осложнение'),
  })
  .passthrough();

export const ChoiceSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(80),
    player_text: z.string().min(1).max(800),
    type: z
      .enum(['action', 'dialogue', 'movement', 'combat', 'inspect', 'wait'])
      .or(z.string().max(80))
      .default('action'),
    requires_roll: z.boolean().default(false),
    roll: RollSchema.nullable().default(null),
  })
  .passthrough();

export const GameStateSchema = z
  .object({
    phase: z.string().max(80).default('playing'),
    current_scene: z.string().max(260).default('Стартовая сцена'),
    current_goal: z.string().max(500).default('Определить следующий шаг'),
    current_actor_id: z.string().nullable().default(null),
    turn_mode: z.boolean().default(false),
    scene_type: z.string().max(80).default('exploration'),
    round: z.coerce.number().int().min(0).max(9999).default(0),
    turn_order: z.array(z.string()).default([]),
    danger_level: z.coerce.number().min(0).max(10).default(1),
    known_facts: z.array(z.string()).default([]),
    active_quests: z.array(QuestSchema).default([]),
  })
  .passthrough()
  .default({});

export const DeepSeekScenarioResponseSchema = z
  .object({
    scenario: z
      .object({
        id: z.string().min(1).max(120).default('scenario_1'),
        title: z.string().min(1).max(180),
        game_id: z.string().min(1).max(120),
        genre: z.string().max(120).default(''),
        tone: z.string().max(160).default(''),
        theme: z.string().max(800).default(''),
        short_description: z.string().max(1600).default(''),
        main_conflict: z.string().max(1400).default(''),
        starting_scene: z.string().max(1800).default(''),
        current_goal: z.string().max(800).default(''),
      })
      .passthrough(),
    characters: z.array(CharacterSchema).max(8).default([]),
    initial_message: z
      .object({
        speaker: z.string().max(80).default('Ведущий'),
        text: z.string().max(3000).default(''),
      })
      .passthrough(),
    choices: z.array(ChoiceSchema).min(1).max(8),
    game_state: GameStateSchema,
    map_state: MapStateSchema,
  })
  .passthrough();

export const StatePatchSchema = z
  .object({
    changed: z.boolean(),
    updates: z
      .object({
        current_phase: z.string().max(120).optional(),
        phase: z.string().max(120).optional(),
        current_scene: z.string().nullable().optional(),
        current_goal: z.string().nullable().optional(),
        current_actor_id: z.string().nullable().optional(),
        turn_mode: z.boolean().nullable().optional(),
        scene_type: z.string().nullable().optional(),
        round: z.coerce.number().int().min(0).max(9999).nullable().optional(),
        turn_order: z.array(z.string()).optional(),
        characters: z
          .union([
            z.array(JsonObjectSchema),
            z
              .object({
                upsert: z.array(JsonObjectSchema).default([]),
                remove: z.array(z.string()).default([]),
              })
              .passthrough(),
          ])
          .optional(),
        npcs: z
          .union([
            z.array(JsonObjectSchema),
            z
              .object({
                upsert: z.array(JsonObjectSchema).default([]),
                remove: z.array(z.string()).default([]),
              })
              .passthrough(),
          ])
          .optional(),
        quests: z
          .union([
            z.array(QuestSchema),
            z
              .object({
                upsert: z.array(QuestSchema).default([]),
                remove: z.array(z.string()).default([]),
              })
              .passthrough(),
          ])
          .optional(),
        known_facts: z
          .object({
            add: z.array(z.string()).default([]),
          })
          .passthrough()
          .optional(),
        map: JsonObjectSchema.optional(),
        world_state: JsonObjectSchema.optional(),
        hidden_gm_notes: z.array(z.string()).optional(),
      })
      .passthrough()
      .default({}),
  })
  .passthrough();

export const MapPatchSchema = z
  .object({
    changed: z.boolean(),
    updates: z
      .object({
        tokens: z
          .object({
            upsert: z.array(JsonObjectSchema).default([]),
            remove: z.array(z.string()).default([]),
            move: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    x: z.coerce.number(),
                    y: z.coerce.number(),
                  })
                  .passthrough(),
              )
              .default([]),
          })
          .passthrough()
          .optional(),
        locations: z
          .object({
            upsert: z.array(JsonObjectSchema).default([]),
            remove: z.array(z.string()).default([]),
          })
          .passthrough()
          .optional(),
        routes: z
          .object({
            upsert: z.array(JsonObjectSchema).default([]),
            remove: z.array(z.string()).default([]),
          })
          .passthrough()
          .optional(),
        zones: z
          .object({
            upsert: z.array(JsonObjectSchema).default([]),
            remove: z.array(z.string()).default([]),
          })
          .passthrough()
          .optional(),
        objects: z
          .object({
            upsert: z.array(JsonObjectSchema).default([]),
            remove: z.array(z.string()).default([]),
          })
          .passthrough()
          .optional(),
        labels: z
          .object({
            upsert: z.array(JsonObjectSchema).default([]),
            remove: z.array(z.string()).default([]),
          })
          .passthrough()
          .optional(),
        visibility: z
          .object({
            reveal_zone_ids: z.array(z.string()).default([]),
            hide_entity_ids: z.array(z.string()).default([]),
            show_entity_ids: z.array(z.string()).default([]),
          })
          .passthrough()
          .optional(),
        viewport: JsonObjectSchema.optional(),
      })
      .passthrough()
      .default({}),
  })
  .passthrough();

export const GameMasterResponseSchema = z
  .object({
    message: z
      .object({
        speaker: z.string().max(80).default('Ведущий'),
        text: z.string().max(4000).default(''),
      })
      .passthrough(),
    choices: z.array(ChoiceSchema).default([]),
    state_patch: StatePatchSchema.default({ changed: false, updates: {} }),
    map_patch: MapPatchSchema.default({ changed: false, updates: {} }),
  })
  .passthrough();

export const SummarySchema = z
  .object({
    summary_short: z.string().max(2500).default(''),
    summary_long: z.string().max(12000).default(''),
    important_facts: z.array(z.unknown()).default([]),
    unresolved_threads: z.array(z.unknown()).default([]),
    npc_relationships: z.array(z.unknown()).default([]),
    hidden_gm_notes: z.array(z.unknown()).default([]),
  })
  .passthrough();

export const CreateCharacterSchema = CharacterSchema.extend({
  player_id: z.union([z.string(), z.number()]).transform(String),
  location_id: z.string().nullable().optional(),
  x: z.coerce.number().min(0).max(100000).optional(),
  y: z.coerce.number().min(0).max(100000).optional(),
});
