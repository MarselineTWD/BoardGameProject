import {
  BoardGame,
  BoardGameStats,
  GameCategory,
  GameMechanic,
  GameNightTheme,
  GeneratedLearningPlan,
  PaginatedResponse,
  ProgressionPath,
  ToolDescriptor,
} from '../model/types';
import { localRequest } from '../../../shared/api/http';

let catalogCache: BoardGame[] | null = null;
let catalogRequest: Promise<BoardGame[]> | null = null;

export interface CatalogPageQuery {
  page: number;
  perPage: number;
  search?: string;
  players?: number | 'any';
  maxDuration?: number | 'any';
  mode?: 'all' | 'base' | 'featured';
}

async function getCachedCatalog() {
  if (catalogCache) {
    return catalogCache;
  }

  if (!catalogRequest) {
    catalogRequest = localRequest<BoardGame[]>('/games').then((games) => {
      catalogCache = games;
      return games;
    });
  }

  return catalogRequest;
}

const emptyStats: BoardGameStats = {
  publishers: 0,
  designers: 0,
  artists: 0,
  mechanics: 0,
  categories: 0,
  games: 0,
  awards: 0,
  progression_paths: 0,
  game_night_themes: 0,
  terms: 0,
  guide_series: 0,
  guides: 0,
  tools: 0,
  faqs: 0,
};

export const gamesService = {
  listFeatured() {
    return getCachedCatalog().then((games) =>
      games
        .filter((game) => game.is_featured && !game.is_expansion)
        .sort(
          (left, right) =>
            (left.bgg_rank ?? 999999) - (right.bgg_rank ?? 999999),
        )
        .slice(0, 16),
    );
  },
  listCatalog() {
    return getCachedCatalog();
  },
  listCatalogPage(query: CatalogPageQuery) {
    const params = new URLSearchParams({
      _page: String(query.page),
      _per_page: String(query.perPage),
      _sort: 'name',
    });

    if (query.search?.trim()) {
      params.set('q', query.search.trim());
    }

    if (query.players !== undefined && query.players !== 'any') {
      params.set('players', String(query.players));
    }

    if (query.maxDuration !== undefined && query.maxDuration !== 'any') {
      params.set('maxDuration', String(query.maxDuration));
    }

    if (query.mode === 'base') {
      params.set('is_expansion', 'false');
    }

    if (query.mode === 'featured') {
      params.set('is_featured', 'true');
    }

    return localRequest<PaginatedResponse<BoardGame>>(
      `/games?${params.toString()}`,
    );
  },
  getBySlug(slug: string) {
    return localRequest<BoardGame>(`/games/${encodeURIComponent(slug)}`);
  },
  generateLearningPlan(payload: {
    slug: string;
    goal: string;
    themeSlug: string;
  }) {
    return localRequest<GeneratedLearningPlan>('/ai/learning-plan', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  listCategories() {
    return localRequest<GameCategory[]>('/categories');
  },
  listMechanics() {
    return localRequest<GameMechanic[]>('/mechanics');
  },
  async getStats() {
    const localStats = await localRequest<BoardGameStats>('/stats');

    return { ...emptyStats, ...localStats };
  },
  listProgressionPaths() {
    return localRequest<ProgressionPath[]>('/progressionPaths');
  },
  listGameNightThemes() {
    return localRequest<GameNightTheme[]>('/gameNightThemes');
  },
  listTools() {
    return localRequest<ToolDescriptor[]>('/tools');
  },
};
