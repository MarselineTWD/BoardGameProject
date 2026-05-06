export type StatKey =
  | 'strength'
  | 'dexterity'
  | 'endurance'
  | 'intelligence'
  | 'perception'
  | 'charisma'
  | 'willpower';

export interface AvailableGame {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  supported_features: string[];
}

export interface CharacterStats {
  strength: number;
  dexterity: number;
  endurance: number;
  intelligence: number;
  perception: number;
  charisma: number;
  willpower: number;
  [key: string]: number;
}

export interface CharacterDerived {
  hp_current: number;
  hp_max: number;
  armor: number;
  initiative: number;
  movement: number;
}

export interface CharacterResources {
  reroll_points: number;
  [key: string]: unknown;
}

export interface CharacterSkill {
  id: string;
  name: string;
  stat: StatKey;
  bonus: number;
}

export interface GameCharacter {
  id: string;
  player_id: string;
  name: string;
  origin: string;
  race?: string;
  class_name: string;
  role: string;
  description: string;
  background?: string;
  goal: string;
  weakness: string;
  secret?: string;
  stats: CharacterStats;
  derived: CharacterDerived;
  resources: CharacterResources;
  skills: CharacterSkill[];
  hp_current: number;
  hp_max: number;
  inventory: unknown[];
  status_effects: unknown[];
  location_id: string | null;
  x: number;
  y: number;
  is_active: boolean;
  is_player_character: boolean;
}

export interface CampaignCharacterTemplate {
  id?: string;
  name: string;
  role: string;
  origin: string;
  class_name: string;
  description: string;
  goal: string;
  weakness: string;
  secret?: string;
  stats: CharacterStats;
  derived: CharacterDerived;
  resources: CharacterResources;
  skills: CharacterSkill[];
  inventory: unknown[];
  status_effects: unknown[];
  is_player_character: boolean;
}

export interface Campaign {
  title: string;
  genre: string;
  tone: string;
  short_description: string;
  recommended_player_characters: CampaignCharacterTemplate[];
}

export interface ScenarioInfo {
  id: string;
  title: string;
  game_id: string;
  genre: string;
  tone: string;
  theme: string;
  short_description: string;
  main_conflict: string;
  starting_scene: string;
  current_goal: string;
}

export interface RollCheck {
  dice: string;
  stat: StatKey;
  skill_id: string | null;
  difficulty: number;
  success_condition: string;
  reason: string;
  success_hint: string;
  failure_hint: string;
}

export interface Choice {
  id: string;
  label: string;
  player_text: string;
  type: 'action' | 'dialogue' | 'movement' | 'combat' | 'inspect' | 'wait' | string;
  requires_roll: boolean;
  roll: RollCheck | null;
}

export interface RollResult {
  dice: string;
  dice_value: number;
  stat: StatKey;
  stat_value: number;
  stat_modifier: number;
  skill_bonus: number;
  total: number;
  difficulty: number;
  success: boolean;
  rerolled: boolean;
  rerolls_spent: number;
}

export interface GameSessionInfo {
  id: string;
  title: string;
  theme: string;
  genre: string;
  tone: string;
  status: string;
  current_phase: string;
  current_scene: string;
  current_actor_id: string | null;
  turn_mode: boolean;
  scene_type: string;
  round: number;
  created_at: string;
  updated_at: string;
}

export interface GameSessionListItem extends GameSessionInfo {
  character_count: number;
  character_names: string[];
}

export interface GameNpc {
  id: string;
  name: string;
  role: string;
  personality: string;
  goal: string;
  knows: string[];
  attitude: string;
  location_id: string | null;
  x: number;
  y: number;
  visible_to_players: boolean;
  state: Record<string, unknown>;
}

export interface GameQuest {
  id: string;
  title: string;
  description: string;
  status: string;
  known_to_players: boolean;
  state: Record<string, unknown>;
}

export interface MapLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  visible_to_players: boolean;
  description?: string;
  danger_level?: number;
}

export interface MapRoute {
  id?: string;
  from: string;
  to: string;
  name?: string;
  travel_time?: string;
  danger_level?: number;
  visible_to_players?: boolean;
}

export interface MapArea {
  id: string;
  name: string;
  type:
    | 'water'
    | 'forest'
    | 'building'
    | 'hazard'
    | 'cover'
    | 'wall'
    | 'door'
    | string;
  x: number;
  y: number;
  width: number;
  height: number;
  danger_level?: number;
  visible_to_players?: boolean;
  description?: string;
}

export interface MapToken {
  id: string;
  type: 'player' | 'npc' | 'enemy' | 'object';
  name: string;
  x: number;
  y: number;
  visible: boolean;
  visible_to_players?: boolean;
  hp_current?: number;
  hp_max?: number;
  role?: string;
  attitude?: string;
  location_id?: string | null;
  status_effects?: unknown[];
  description?: string;
}

export interface FogOfWarState {
  enabled: boolean;
  mode?: string;
  unexplored_opacity?: number;
  explored_opacity?: number;
}

export interface GameMapState {
  map_id: string;
  id?: string;
  name: string;
  image_url: string;
  type?: 'region_map' | 'scene_map' | 'region_or_location' | string;
  map_type?: 'region_map' | 'scene_map' | 'region_or_location' | string;
  visual_style?: string;
  width: number;
  height: number;
  grid: {
    enabled: boolean;
    cell_size: number;
    type: string;
    visible?: boolean;
  };
  tokens: MapToken[];
  locations: MapLocation[];
  routes?: MapRoute[];
  zones?: MapArea[];
  areas?: MapArea[];
  objects?: MapToken[];
  labels?: unknown[];
  fog_of_war: boolean | FogOfWarState;
  viewport?: Record<string, unknown>;
  visibility?: Record<string, unknown>;
}

export interface GameTurn {
  id: string;
  round: number;
  actor_id: string;
  actor_type: string;
  turn_index: number;
  is_current: boolean;
  has_acted: boolean;
}

export interface GameMessage {
  id: string;
  session_id: string;
  player_id: string | null;
  character_id: string | null;
  role: 'player' | 'gm' | string;
  content: string;
  visible_to_players: boolean;
  created_at: string;
}

export interface GameStateMemory {
  public_state: {
    owner_player_id?: string;
    participant_player_ids?: string[];
    participants?: {
      id: string;
      name: string;
      username?: string;
      role?: string;
    }[];
    deepseek_chat_id?: string;
    selected_game?: AvailableGame;
    theme?: string;
    scenario?: ScenarioInfo;
    campaign?: Campaign;
    game_state?: {
      phase?: string;
      current_scene?: string;
      current_goal?: string;
      current_actor_id?: string | null;
      turn_mode?: boolean;
      scene_type?: string;
      round?: number;
      turn_order?: string[];
      danger_level?: number;
      known_facts?: string[];
      active_quests?: GameQuest[];
      [key: string]: unknown;
    };
    current_choices?: Choice[];
    roll_history?: RollResult[];
    world_state?: Record<string, unknown>;
  };
  summary_short: string;
  summary_long: string;
  important_facts: unknown[];
  unresolved_threads: unknown[];
}

export interface GameSessionResponse {
  session: GameSessionInfo;
  game_state: GameStateMemory;
  characters: GameCharacter[];
  npcs: GameNpc[];
  quests: GameQuest[];
  map: GameMapState | null;
  turns: GameTurn[];
}

export interface GenerateCampaignResponse {
  session_id: string;
  scenario: ScenarioInfo;
  campaign: Campaign;
  game_state: Record<string, unknown>;
  map: GameMapState;
  choices: Choice[];
  state: GameSessionResponse;
}

export interface SendMessageResponse {
  player_message: GameMessage;
  gm_message: GameMessage;
  state: GameSessionResponse;
  choices?: Choice[];
  parse_error?: boolean;
  warning?: string;
}
