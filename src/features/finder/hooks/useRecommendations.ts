import { useMemo } from 'react';
import {
  BoardGame,
  GameNightTheme,
  ProgressionPath,
} from '../../../entities/games/model/types';
import {
  ComplexityPreference,
  FinderLimitPreference,
  useFinderPreferencesStore,
} from '../model/preferencesStore';
import { clamp, toNumber } from '../../../shared/lib/format';

export interface GameRecommendation {
  game: BoardGame;
  score: number;
  reasons: string[];
}

function getComplexityTarget(preference: ComplexityPreference) {
  switch (preference) {
    case 'light':
      return 1.8;
    case 'medium':
      return 2.7;
    case 'heavy':
      return 3.8;
    default:
      return 2.7;
  }
}

function scoreGame(
  game: BoardGame,
  players: FinderLimitPreference,
  maxDuration: FinderLimitPreference,
  complexity: ComplexityPreference,
  strategyFocus: number,
  interactionFocus: number,
  accessibilityNeed: number,
) {
  const reasons: string[] = [];
  let score = 0;

  const complexityValue = toNumber(game.bgg_weight) ?? 2.7;
  const durationValue = game.playing_time_max ?? game.playing_time_min ?? 90;
  const strategyValue = game.dna_strategy ?? 50;
  const interactionValue = game.dna_interaction ?? 50;
  const accessibilityValue =
    game.dna_accessibility ?? clamp(100 - complexityValue * 18, 20, 95);

  if (players === 'any') {
    score += 10;
    reasons.push(
      `подходит для ${game.min_players}-${game.max_players} игрока(ов)`,
    );
  } else if (players >= game.min_players && players <= game.max_players) {
    score += 28;
    reasons.push(`подходит под компанию на ${players} игрока(ов)`);
  }

  if (players !== 'any' && game.best_player_counts.includes(players)) {
    score += 14;
    reasons.push(`считается особенно удачной именно на ${players} игрока(ов)`);
  }

  if (maxDuration === 'any') {
    score += 8;
    reasons.push(`длительность партии: ${durationValue} мин`);
  } else if (durationValue <= maxDuration) {
    score += 16;
    reasons.push(`укладывается в лимит по времени (${durationValue} мин)`);
  } else {
    score -= Math.min(10, Math.round((durationValue - maxDuration) / 20));
  }

  const complexityGap = Math.abs(
    complexityValue - getComplexityTarget(complexity),
  );
  score += Math.max(0, 16 - complexityGap * 8);

  if (complexity !== 'any' && complexityGap < 0.7) {
    reasons.push(
      `сложность близка к желаемому уровню (${complexityValue.toFixed(1)}/5)`,
    );
  }

  score += Math.max(0, 14 - Math.abs(strategyValue - strategyFocus) / 8);
  score += Math.max(0, 12 - Math.abs(interactionValue - interactionFocus) / 8);
  score += Math.max(
    0,
    12 - Math.abs(accessibilityValue - accessibilityNeed) / 8,
  );
  score += Math.min(12, (toNumber(game.bgg_rating) ?? 0) * 1.3);

  if ((game.bgg_rank ?? 12000) < 500) {
    score += 8;
    reasons.push('держится высоко в рейтинге BGG');
  }

  return {
    game,
    score,
    reasons: reasons.slice(0, 3),
  };
}

export function useRecommendations(
  games: BoardGame[] | null,
  themes: GameNightTheme[] | null,
  paths: ProgressionPath[] | null,
) {
  const preferences = useFinderPreferencesStore();

  const recommendations = useMemo(() => {
    if (!games) {
      return [];
    }

    return games
      .filter((game) => !game.is_expansion)
      .map((game) =>
        scoreGame(
          game,
          preferences.players,
          preferences.maxDuration,
          preferences.complexity,
          preferences.strategyFocus,
          preferences.interactionFocus,
          preferences.accessibilityNeed,
        ),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, 6);
  }, [games, preferences]);

  const selectedTheme = useMemo(
    () =>
      preferences.themeSlug === 'any'
        ? null
        : (themes?.find((theme) => theme.slug === preferences.themeSlug) ??
          null),
    [preferences.themeSlug, themes],
  );

  const suggestedPath = useMemo(() => {
    if (!paths) {
      return null;
    }

    const target = getComplexityTarget(preferences.complexity);

    return (
      [...paths].sort((left, right) => {
        const leftGap = Math.abs(Number(left.difficulty_end) - target);
        const rightGap = Math.abs(Number(right.difficulty_end) - target);
        return leftGap - rightGap;
      })[0] ?? null
    );
  }, [paths, preferences.complexity]);

  return {
    preferences,
    recommendations,
    selectedTheme,
    suggestedPath,
  };
}
