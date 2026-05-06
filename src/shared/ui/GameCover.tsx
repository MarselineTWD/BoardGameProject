import { useMemo, useState } from 'react';
import { BoardGame } from '../../entities/games/model/types';
import styles from './GameCover.module.css';
import { formatPlayers, formatTime, toNumber } from '../lib/format';

interface GameCoverProps {
  game: Pick<
    BoardGame,
    | 'slug'
    | 'name'
    | 'image_url'
    | 'thumbnail_url'
    | 'bgg_rating'
    | 'min_players'
    | 'max_players'
    | 'playing_time_min'
    | 'playing_time_max'
    | 'year_published'
  >;
  className?: string;
}

function isBlockedImageHost(url: string | null | undefined) {
  return Boolean(url && url.includes('cf.geekdo-images.com'));
}

function buildFallbackCover(game: GameCoverProps['game']) {
  const title = game.name
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const details = `${formatPlayers(game.min_players, game.max_players)} • ${formatTime(
    game.playing_time_min,
    game.playing_time_max,
  )}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const rating = toNumber(game.bgg_rating);
  const year = game.year_published ?? 'N/A';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 640" role="img" aria-label="${title}">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#163f48"/>
          <stop offset="55%" stop-color="#285f62"/>
          <stop offset="100%" stop-color="#d77f2e"/>
        </linearGradient>
        <radialGradient id="glow" cx="0.2" cy="0.1" r="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.42)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="480" height="640" rx="36" fill="url(#bg)"/>
      <circle cx="88" cy="78" r="118" fill="url(#glow)"/>
      <circle cx="408" cy="598" r="146" fill="rgba(255,255,255,0.08)"/>
      <rect x="36" y="34" width="408" height="572" rx="28" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)"/>
      <text x="48" y="84" fill="#fcebd5" font-size="18" font-family="Verdana, Arial, sans-serif" letter-spacing="2">MEEPLE SCOPE</text>
      <text x="48" y="168" fill="#ffffff" font-size="38" font-weight="700" font-family="Verdana, Arial, sans-serif">
        <tspan x="48" dy="0">${title.slice(0, 26)}</tspan>
        <tspan x="48" dy="48">${title.slice(26, 52)}</tspan>
      </text>
      <text x="48" y="264" fill="#d8ece7" font-size="20" font-family="Verdana, Arial, sans-serif">${details}</text>
      <rect x="48" y="318" width="166" height="72" rx="18" fill="rgba(255,255,255,0.12)"/>
      <text x="68" y="348" fill="#f2c68f" font-size="16" font-family="Verdana, Arial, sans-serif">BGG RATING</text>
      <text x="68" y="382" fill="#ffffff" font-size="32" font-weight="700" font-family="Verdana, Arial, sans-serif">${rating ? rating.toFixed(1) : '—'}</text>
      <rect x="228" y="318" width="166" height="72" rx="18" fill="rgba(255,255,255,0.12)"/>
      <text x="248" y="348" fill="#f2c68f" font-size="16" font-family="Verdana, Arial, sans-serif">YEAR</text>
      <text x="248" y="382" fill="#ffffff" font-size="32" font-weight="700" font-family="Verdana, Arial, sans-serif">${year}</text>
      <text x="48" y="486" fill="#fcebd5" font-size="18" font-family="Verdana, Arial, sans-serif">LIVE API COVER UNAVAILABLE</text>
      <text x="48" y="520" fill="#ffffff" font-size="24" font-weight="700" font-family="Verdana, Arial, sans-serif">Rendered local fallback</text>
      <text x="48" y="560" fill="#d8ece7" font-size="18" font-family="Verdana, Arial, sans-serif">Source image host blocks direct requests</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function GameCover({ game, className = '' }: GameCoverProps) {
  const [useFallback, setUseFallback] = useState(isBlockedImageHost(game.image_url));

  const fallbackSrc = useMemo(() => buildFallbackCover(game), [game]);
  const resolvedSrc = useFallback
    ? fallbackSrc
    : game.image_url || game.thumbnail_url || fallbackSrc;

  return (
    <img
      className={`${styles.cover} ${className}`.trim()}
      src={resolvedSrc}
      alt={game.name}
      loading="lazy"
      onError={() => setUseFallback(true)}
    />
  );
}
