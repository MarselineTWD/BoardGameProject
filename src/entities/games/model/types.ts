export interface BoardGame {
  slug: string;
  name: string;
  year_published: number | null;
  bgg_id: number | null;
  bgg_rating: string | null;
  bgg_rank: number | null;
  bgg_weight: string | null;
  bgg_num_ratings: number;
  min_players: number;
  max_players: number;
  best_player_counts: number[];
  playing_time_min: number | null;
  playing_time_max: number | null;
  min_age: number | null;
  dna_strategy: number | null;
  dna_luck: number | null;
  dna_interaction: number | null;
  dna_complexity: number | null;
  dna_length: number | null;
  dna_scaling: number | null;
  dna_replayability: number | null;
  dna_accessibility: number | null;
  wikidata_id: string;
  thumbnail_url: string;
  image_url: string;
  is_featured: boolean;
  is_expansion: boolean;
  description: string;
  meta_description: string;
}

export interface PaginatedResponse<T> {
  first: number;
  prev: number | null;
  next: number | null;
  last: number;
  pages: number;
  items: number;
  data: T[];
}

export interface GameCategory {
  slug: string;
  name: string;
  description: string;
  bgg_id: number | null;
  category_type: 'theme' | 'style';
  game_count: number;
  meta_description: string;
}

export interface GameMechanic {
  slug: string;
  name: string;
  description: string;
  bgg_id: number | null;
  parent_slug: string | null;
  depth: number;
  complexity_tendency: string;
  game_count: number;
  meta_description: string;
}

export interface BoardGameStats {
  publishers: number;
  designers: number;
  artists: number;
  mechanics: number;
  categories: number;
  games: number;
  awards: number;
  progression_paths: number;
  game_night_themes: number;
  terms: number;
  guide_series: number;
  guides: number;
  tools: number;
  faqs: number;
}

export interface ProgressionPath {
  slug: string;
  name: string;
  description: string;
  difficulty_start: string;
  difficulty_end: string;
  target_audience: string;
  primary_mechanic_slug: string | null;
  primary_category_slug: string | null;
  meta_description: string;
}

export interface GameNightTheme {
  slug: string;
  name: string;
  description: string;
  player_count_min: number;
  player_count_max: number;
  duration_hours: string;
  vibe: string;
  playlist_concept: string;
  meta_description: string;
}

export interface ToolDescriptor {
  slug: string;
  name: string;
  description: string;
  tool_type: string;
  icon: string;
  is_published: boolean;
  meta_description: string;
}

export interface GeneratedLearningPlan {
  provider: 'ollama';
  model: string;
  gameSlug: string;
  generatedAt: string;
  usedBgg: boolean;
  sources: string[];
  rules: {
    objective: string;
    turnStructure: string[];
    keyRules: string[];
    firstRoundWalkthrough: string[];
    commonMistakes: string[];
  };
  scenario: {
    title: string;
    setup: string;
    timeline: string[];
    hostNotes: string[];
  };
}
