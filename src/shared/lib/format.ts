export function formatPlayers(minPlayers: number, maxPlayers: number) {
  return minPlayers === maxPlayers
    ? `${minPlayers} игрока`
    : `${minPlayers}-${maxPlayers} игроков`;
}

export function formatTime(minTime: number | null, maxTime: number | null) {
  if (!minTime && !maxTime) {
    return 'Нет данных';
  }

  if (minTime === maxTime || maxTime === null) {
    return `${minTime ?? maxTime} мин`;
  }

  return `${minTime}-${maxTime} мин`;
}

export function formatDecimal(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }

  return value.toFixed(digits);
}

export function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = typeof value === 'string' ? Number(value) : value;
  return Number.isNaN(normalized) ? null : normalized;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
