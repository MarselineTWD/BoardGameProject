import { useMemo } from 'react';
import { CatalogPageQuery, gamesService } from '../api/games.service';
import { useAsyncResource } from '../../../shared/lib/useAsyncResource';
import { BoardGame } from '../model/types';

export function useFeaturedGames() {
  return useAsyncResource(() => gamesService.listFeatured(), []);
}

export function useCatalogGames() {
  return useAsyncResource(() => gamesService.listCatalog(), []);
}

export function useCatalogGamesPage(query: CatalogPageQuery) {
  return useAsyncResource(() => gamesService.listCatalogPage(query), [query]);
}

export function useBoardGame(slug: string) {
  return useAsyncResource(() => gamesService.getBySlug(slug), [slug]);
}

export function useBoardGameStats() {
  return useAsyncResource(() => gamesService.getStats(), []);
}

export function useCategories() {
  return useAsyncResource(() => gamesService.listCategories(), []);
}

export function useMechanics() {
  return useAsyncResource(() => gamesService.listMechanics(), []);
}

export function useProgressionPaths() {
  return useAsyncResource(() => gamesService.listProgressionPaths(), []);
}

export function useGameNightThemes() {
  return useAsyncResource(() => gamesService.listGameNightThemes(), []);
}

export function useToolDescriptors() {
  return useAsyncResource(() => gamesService.listTools(), []);
}

export function useTopRankedGames(games: BoardGame[] | null, limit: number) {
  return useMemo(() => {
    if (!games) {
      return [];
    }

    return [...games]
      .filter((game) => !game.is_expansion && game.bgg_rank !== null)
      .sort(
        (left, right) => (left.bgg_rank ?? 999999) - (right.bgg_rank ?? 999999),
      )
      .slice(0, limit);
  }, [games, limit]);
}
