export const AVAILABLE_GAMES = [
  {
    id: 'dnd_5e',
    title: 'Dungeons & Dragons 5e',
    description:
      'Классическая фэнтези-система с бросками d20, классами, магией и тактическими боями.',
    enabled: true,
    supported_features: ['characters', 'combat', 'dice', 'map', 'quests'],
  },
  {
    id: 'pathfinder_2e',
    title: 'Pathfinder 2e',
    description:
      'Глубокая фэнтези-система с детальной боевой механикой, тактикой и развитием персонажа.',
    enabled: true,
    supported_features: ['characters', 'combat', 'dice', 'map', 'quests'],
  },
  {
    id: 'call_of_cthulhu_7e',
    title: 'Call of Cthulhu 7e',
    description:
      'Расследования, тайны и напряжённый хоррор с акцентом на атмосферу и риск.',
    enabled: true,
    supported_features: ['characters', 'dice', 'map', 'quests'],
  },
  {
    id: 'cyberpunk_red',
    title: 'Cyberpunk RED',
    description:
      'Неоновые улицы, корпорации и рискованные операции в киберпанк-сеттинге.',
    enabled: true,
    supported_features: ['characters', 'combat', 'dice', 'map', 'quests'],
  },
  {
    id: 'warhammer_40k_wrath_glory',
    title: 'Warhammer 40,000: Wrath & Glory',
    description:
      'Мрачная научная фантастика, командные миссии, бои и опасные фракции.',
    enabled: true,
    supported_features: ['characters', 'combat', 'dice', 'map', 'quests'],
  },
  {
    id: 'blades_in_the_dark',
    title: 'Blades in the Dark',
    description:
      'Ограбления, интриги и уличные банды в мрачном индустриальном городе.',
    enabled: true,
    supported_features: ['characters', 'combat', 'dice', 'map', 'quests'],
  },
  {
    id: 'vampire_masquerade_v5',
    title: 'Vampire: The Masquerade V5',
    description:
      'Политика кланов, социальные конфликты и борьба с внутренним Зверем.',
    enabled: true,
    supported_features: ['characters', 'dice', 'map', 'quests'],
  },
  {
    id: 'fate_core',
    title: 'Fate Core',
    description:
      'Гибкая нарративная система для самых разных жанров и динамичных сцен.',
    enabled: true,
    supported_features: ['characters', 'dice', 'map', 'quests'],
  },
];

export function getEnabledGames() {
  return AVAILABLE_GAMES.filter((game) => game.enabled);
}

export function findAvailableGame(gameId) {
  return AVAILABLE_GAMES.find((game) => game.id === gameId && game.enabled) ?? null;
}
