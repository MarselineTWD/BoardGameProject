import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from '@tanstack/react-router';
import { io, Socket } from 'socket.io-client';
import { rpgService } from '../entities/rpg/api/rpg.service';
import {
  AvailableGame,
  CharacterSkill,
  CharacterStats,
  Choice,
  GameCharacter,
  GameMessage,
  GameSessionResponse,
  RollCheck,
  RollResult,
  StatKey,
} from '../entities/rpg/model/types';
import { useAuth } from '../entities/auth/hooks/useAuth';
import { playersService } from '../entities/players/api/players.service';
import { Player } from '../entities/players/model/types';
import { getAuthToken, localApiBase } from '../shared/api/http';
import { browserLogger } from '../shared/lib/browserLogger';
import { Button } from '../shared/ui/Button';
import { Field } from '../shared/ui/Field';
import { Panel } from '../shared/ui/Panel';
import styles from './RpgPage.module.css';

const defaultTheme = '';

const statLabels: Record<StatKey, string> = {
  strength: 'Сила',
  dexterity: 'Ловкость',
  endurance: 'Выносливость',
  intelligence: 'Интеллект',
  perception: 'Восприятие',
  charisma: 'Харизма',
  willpower: 'Воля',
};

const statKeys = Object.keys(statLabels) as StatKey[];

const emptyStats: CharacterStats = {
  strength: 10,
  dexterity: 10,
  endurance: 10,
  intelligence: 10,
  perception: 10,
  charisma: 10,
  willpower: 10,
};

function getInitialSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('session') ?? '';
}

function isHistoryViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') === 'history' || params.get('readonly') === '1';
}

function stringifyInventoryItem(item: unknown) {
  if (typeof item === 'string') {
    return item;
  }

  if (item && typeof item === 'object' && 'name' in item) {
    return String((item as { name?: unknown }).name ?? 'предмет');
  }

  return 'предмет';
}

function actorName(session: GameSessionResponse | null) {
  if (!session?.session.current_actor_id) {
    return 'свободная сцена';
  }

  const actor =
    session.characters.find(
      (character) => character.id === session.session.current_actor_id,
    ) ||
    session.npcs.find((npc) => npc.id === session.session.current_actor_id);

  return actor?.name ?? session.session.current_actor_id;
}

function sessionBusyStatus(label?: string) {
  switch (label) {
    case 'character_generation':
      return 'Ведущий генерирует персонажа. Изменения появятся у всех игроков сразу после завершения.';
    case 'character_revision':
      return 'Ведущий изменяет персонажа. Дождитесь ответа, чтобы не отправить вторую генерацию.';
    case 'scenario_revision':
      return 'Ведущий переписывает сценарий. Обновление скоро появится у всех участников.';
    case 'game_action':
      return 'Ведущий обрабатывает действие игрока. Следующий запрос дождётся своей очереди.';
    case 'session_start':
      return 'Партия запускается. Состояние лобби обновится у всех участников.';
    case 'session_finish':
      return 'Партия завершается. История сохраняется для всех участников.';
    default:
      return 'Ведущий работает над лобби. Обновление появится у всех участников сразу после завершения.';
  }
}

function isCheckLine(line: string) {
  return /^(Проверка|Сложность|Бросок|Модификатор|Итог|Результат):/i.test(line);
}

function MessageBubble({
  message,
  character,
  content,
  typing,
  selectable,
  selected,
  onToggleSelect,
  onSelectDragStart,
  onSelectDragEnter,
}: {
  message: GameMessage;
  character?: GameCharacter;
  content?: string;
  typing?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (messageId: string) => void;
  onSelectDragStart?: (messageId: string) => void;
  onSelectDragEnter?: (messageId: string) => void;
}) {
  const isGm = message.role === 'gm';
  const lines = (content ?? message.content).split('\n');

  return (
    <article
      className={`${styles.message} ${isGm ? styles.gmMessage : ''} ${
        typing ? styles.typingMessage : ''
      }`}
    >
      {selectable ? (
        <label className={styles.messageSelect}>
          <input
            type="checkbox"
            checked={Boolean(selected)}
            onChange={() => onToggleSelect?.(message.id)}
          />
        </label>
      ) : null}
      {selectable ? (
        <div
          className={styles.messageSelectZone}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelectDragStart?.(message.id);
          }}
          onMouseEnter={() => onSelectDragEnter?.(message.id)}
        />
      ) : null}
      <div className={styles.messageMeta}>
        <span>{isGm ? 'Ведущий' : character?.name ?? 'Игрок'}</span>
        <time>{new Date(message.created_at).toLocaleTimeString('ru-RU')}</time>
      </div>
      <div className={styles.messageText}>
        {lines.map((line, index) => (
          <p
            key={`${message.id}-${index}`}
            className={isCheckLine(line) ? styles.checkLine : undefined}
          >
            {line || '\u00A0'}
          </p>
        ))}
        {typing ? <span className={styles.typingCaret} /> : null}
      </div>
    </article>
  );
}

function createLocalPlayerMessage({
  sessionId,
  playerId,
  characterId,
  content,
}: {
  sessionId: string;
  playerId: string;
  characterId: string;
  content: string;
}): GameMessage {
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    session_id: sessionId,
    player_id: playerId,
    character_id: characterId,
    role: 'player',
    content,
    visible_to_players: true,
    created_at: new Date().toISOString(),
  };
}

function appendUniqueMessages(current: GameMessage[], next: GameMessage[]) {
  const ids = new Set(current.map((message) => message.id));
  const merged = [...current];

  next.forEach((message) => {
    if (!ids.has(message.id)) {
      ids.add(message.id);
      merged.push(message);
    }
  });

  return merged;
}

interface CharacterDraft {
  id?: string;
  name: string;
  role: string;
  origin: string;
  class_name: string;
  description: string;
  goal: string;
  weakness: string;
  secret: string;
  stats: CharacterStats;
  hp_current: number;
  hp_max: number;
  armor: number;
  initiative: number;
  movement: number;
  reroll_points: number;
  skillsText: string;
  inventoryText: string;
}

interface PendingRoll {
  choice: Choice;
  result: RollResult | null;
  rolling: boolean;
}

interface GuideChatMessage {
  id: string;
  role: 'player' | 'gm';
  content: string;
}

function modifierFor(value: number) {
  return Math.floor((Number(value) - 10) / 2);
}

function signed(value: number) {
  return value >= 0 ? `+${value}` : String(value);
}

function safeGameError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.replace(/^Ошибка локального API:\s*/i, '').trim();

  if (normalized.includes('Эта игра пока недоступна')) {
    return 'Эта игра пока недоступна для генерации сценария.';
  }

  if (normalized.includes('Тематика слишком длинная')) {
    return 'Тематика слишком длинная. Сократите описание.';
  }

  if (normalized.includes('Войдите в аккаунт') || normalized.includes('Authentication')) {
    return 'Войдите в аккаунт, чтобы играть.';
  }

  if (normalized.includes('Игра уже завершена')) {
    return 'Игра уже завершена. История сохранена в аккаунте.';
  }

  if (normalized.includes('Это действие относится к другому персонажу')) {
    return normalized;
  }

  if (normalized.includes('Этим персонажем сейчас нельзя действовать')) {
    return normalized;
  }

  if (normalized.includes('Этот персонаж уже выбран')) {
    return normalized;
  }

  if (normalized.includes('обрабатывается действие')) {
    return normalized;
  }

  if (normalized && normalized !== message) {
    return normalized;
  }

  return 'Ведущий на мгновение замолчал. Попробуйте повторить действие.';
}

function blankCharacterDraft(): CharacterDraft {
  return {
    name: '',
    role: '',
    origin: '',
    class_name: '',
    description: '',
    goal: '',
    weakness: '',
    secret: '',
    stats: { ...emptyStats },
    hp_current: 10,
    hp_max: 10,
    armor: 0,
    initiative: 0,
    movement: 6,
    reroll_points: 2,
    skillsText: '',
    inventoryText: '',
  };
}

function skillLine(skill: CharacterSkill) {
  return `${skill.name}; ${statLabels[skill.stat]}; ${skill.bonus}`;
}

function draftFromCharacter(character: GameCharacter): CharacterDraft {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    origin: character.origin || character.race || '',
    class_name: character.class_name,
    description: character.description || character.background || '',
    goal: character.goal,
    weakness: character.weakness,
    secret: character.secret ?? '',
    stats: { ...emptyStats, ...character.stats },
    hp_current: character.derived?.hp_current ?? character.hp_current ?? 10,
    hp_max: character.derived?.hp_max ?? character.hp_max ?? 10,
    armor: character.derived?.armor ?? 0,
    initiative: character.derived?.initiative ?? 0,
    movement: character.derived?.movement ?? 6,
    reroll_points: character.resources?.reroll_points ?? 2,
    skillsText: (character.skills ?? []).map(skillLine).join('\n'),
    inventoryText: (character.inventory ?? []).map(stringifyInventoryItem).join('\n'),
  };
}

function statFromText(value: string): StatKey {
  const normalized = value.trim().toLowerCase();
  const found = statKeys.find((key) => {
    return key === normalized || statLabels[key].toLowerCase() === normalized;
  });

  return found ?? 'dexterity';
}

function parseSkills(value: string): CharacterSkill[] {
  return value
    .split('\n')
    .map((line, index) => {
      const [name = '', stat = 'Ловкость', bonus = '0'] = line
        .split(/[;,]/)
        .map((part) => part.trim());

      if (!name) {
        return null;
      }

      return {
        id: name
          .toLowerCase()
          .replace(/[^a-zа-яё0-9]+/gi, '_')
          .replace(/^_+|_+$/g, '') || `skill_${index + 1}`,
        name,
        stat: statFromText(stat),
        bonus: Number.parseInt(bonus, 10) || 0,
      };
    })
    .filter(Boolean) as CharacterSkill[];
}

function inventoryFromText(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function characterFromDraft(draft: CharacterDraft) {
  return {
    id: draft.id,
    name: draft.name.trim() || 'Безымянный герой',
    role: draft.role.trim(),
    origin: draft.origin.trim(),
    class_name: draft.class_name.trim(),
    description: draft.description.trim(),
    goal: draft.goal.trim(),
    weakness: draft.weakness.trim(),
    secret: draft.secret.trim(),
    stats: draft.stats,
    derived: {
      hp_current: draft.hp_current,
      hp_max: draft.hp_max,
      armor: draft.armor,
      initiative: draft.initiative,
      movement: draft.movement,
    },
    resources: {
      reroll_points: draft.reroll_points,
    },
    skills: parseSkills(draft.skillsText),
    inventory: inventoryFromText(draft.inventoryText),
    status_effects: [],
    is_player_character: true,
  };
}

function skillBonus(character: GameCharacter, roll: RollCheck) {
  return (
    character.skills?.find((skill) => skill.id === roll.skill_id)?.bonus ??
    character.skills?.find((skill) => skill.stat === roll.stat)?.bonus ??
    0
  ) + classBonus(character, roll) + inventoryBonus(character, roll);
}

function classBonus(character: GameCharacter, roll: RollCheck) {
  const text = `${character.class_name} ${character.role}`.toLowerCase();

  if (/воин|боец|fighter|warrior|варвар|paladin|паладин/.test(text)) {
    return roll.stat === 'strength' || roll.stat === 'endurance' ? 1 : 0;
  }
  if (/плут|вор|rogue|развед|следопыт|ranger|стрел/.test(text)) {
    return roll.stat === 'dexterity' || roll.stat === 'perception' ? 1 : 0;
  }
  if (/маг|волшеб|wizard|sorcerer|аркан|техн|хакер|учен/.test(text)) {
    return roll.stat === 'intelligence' || roll.stat === 'willpower' ? 1 : 0;
  }
  if (/бард|дипломат|жрец|cleric|лидер|переговор/.test(text)) {
    return roll.stat === 'charisma' || roll.stat === 'willpower' ? 1 : 0;
  }

  return 0;
}

function inventoryBonus(character: GameCharacter, roll: RollCheck) {
  const reason = `${roll.reason} ${roll.skill_id ?? ''}`.toLowerCase();
  const inventory = (character.inventory ?? [])
    .map((item) => stringifyInventoryItem(item).toLowerCase())
    .join(' ');

  if (!inventory) {
    return 0;
  }

  const matches = [
    roll.stat === 'dexterity' && /отмыч|инструмент|крюк|перчат|легк/.test(inventory),
    roll.stat === 'perception' && /фонар|лупа|бинок|сканер|карта|компас/.test(inventory),
    roll.stat === 'strength' && /лом|молот|топор|крюк|верев/.test(inventory),
    roll.stat === 'intelligence' && /книга|запис|терминал|набор|инструмент|сканер/.test(inventory),
    roll.stat === 'charisma' && /знак|печать|документ|одежд|маска|украшен/.test(inventory),
    roll.stat === 'willpower' && /оберег|символ|амулет|талисман|молит/.test(inventory),
    /оруж|меч|кинжал|пистолет|лук|арбалет/.test(inventory) &&
      /атака|удар|выстрел|бой|сраж/.test(reason),
  ];

  return matches.some(Boolean) ? 1 : 0;
}

function requiredDiceTarget(
  character: GameCharacter,
  roll: RollCheck,
  statInfluenceMultiplier: number,
) {
  const statValue = character.stats[roll.stat] ?? 10;
  const statMod = Math.round(modifierFor(statValue) * statInfluenceMultiplier);
  const bonus = skillBonus(character, roll);
  return roll.difficulty - (statMod + bonus);
}

function diceSides(dice: string) {
  const match = dice.toLowerCase().match(/d(\d+)/);
  return Math.max(2, Number(match?.[1] ?? 20));
}

function diceLabel(dice: string) {
  const sides = diceSides(dice);
  return `${sides}-гранный кубик`;
}

function randomDie(sides: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] % sides) + 1;
}

function CharacterModal({
  draft,
  mode,
  readOnly = false,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: CharacterDraft;
  mode: 'view' | 'edit';
  readOnly?: boolean;
  onChange: (draft: CharacterDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const editing = mode === 'edit' && !readOnly;

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.characterModal}>
        <header className={styles.modalHeader}>
          <div>
            <span>{editing ? 'Лист персонажа' : draft.role || 'Персонаж'}</span>
            <h3>{draft.name || 'Новый персонаж'}</h3>
          </div>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.formGrid}>
            {(['name', 'role', 'origin', 'class_name'] as const).map((field) => (
              <label key={field}>
                <span>
                  {
                    {
                      name: 'Имя',
                      role: 'Роль',
                      origin: 'Происхождение',
                      class_name: 'Класс или архетип',
                    }[field]
                  }
                </span>
                <input
                  value={draft[field]}
                  disabled={!editing}
                  onChange={(event) =>
                    onChange({ ...draft, [field]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>

          <div className={styles.formGrid}>
            {(['description', 'goal', 'weakness'] as const).map((field) => (
              <label key={field}>
                <span>
                  {
                    {
                      description: 'Описание',
                      goal: 'Цель',
                      weakness: 'Слабость',
                    }[field]
                  }
                </span>
                <textarea
                  value={draft[field]}
                  disabled={!editing}
                  onChange={(event) =>
                    onChange({ ...draft, [field]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>

          <section className={styles.statEditor}>
            <h4>Характеристики</h4>
            <div className={styles.statGrid}>
              {statKeys.map((key) => (
                <label key={key}>
                  <span>{statLabels[key]}</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={draft.stats[key]}
                    disabled={!editing}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        stats: {
                          ...draft.stats,
                          [key]: Number(event.target.value),
                        },
                      })
                    }
                  />
                  <small>{signed(modifierFor(draft.stats[key]))}</small>
                </label>
              ))}
            </div>
          </section>

          <div className={styles.formGrid}>
            {[
              ['hp_current', 'Здоровье сейчас'],
              ['hp_max', 'Здоровье максимум'],
              ['armor', 'Броня'],
              ['initiative', 'Инициатива'],
              ['movement', 'Скорость'],
              ['reroll_points', 'Очки переброса'],
            ].map(([field, label]) => (
              <label key={field}>
                <span>{label}</span>
                <input
                  type="number"
                  value={Number(draft[field as keyof CharacterDraft])}
                  disabled={!editing}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      [field]: Number(event.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>

          <div className={styles.formGrid}>
            <label>
              <span>Навыки</span>
              <textarea
                value={draft.skillsText}
                disabled={!editing}
                placeholder="Скрытность; Ловкость; 2"
                onChange={(event) =>
                  onChange({ ...draft, skillsText: event.target.value })
                }
              />
            </label>
            <label>
              <span>Инвентарь</span>
              <textarea
                value={draft.inventoryText}
                disabled={!editing}
                placeholder="Факел"
                onChange={(event) =>
                  onChange({ ...draft, inventoryText: event.target.value })
                }
              />
            </label>
          </div>
        </div>

        <footer className={styles.modalActions}>
          {!readOnly && editing ? (
            <Button type="button" onClick={onSave}>
              Сохранить
            </Button>
          ) : null}
          {!readOnly && !editing ? (
            <Button type="button" onClick={() => onChange({ ...draft })}>
              Редактировать
            </Button>
          ) : null}
          {!readOnly && onDelete ? (
            <Button type="button" variant="danger" onClick={onDelete}>
              Удалить
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        </footer>
      </div>
    </div>
  );
}

function RollModal({
  pending,
  animationValue,
  activeCharacter,
  statInfluenceMultiplier,
  onConfirm,
  onReroll,
  onClose,
}: {
  pending: PendingRoll;
  animationValue: number;
  activeCharacter: GameCharacter;
  statInfluenceMultiplier: number;
  onConfirm: () => void;
  onReroll: () => void;
  onClose: () => void;
}) {
  const roll = pending.choice.roll!;
  const statValue = activeCharacter.stats[roll.stat] ?? 10;
  const baseStatMod = modifierFor(statValue);
  const statMod = Math.round(baseStatMod * statInfluenceMultiplier);
  const bonus = skillBonus(activeCharacter, roll);
  const availableRerolls =
    (activeCharacter.resources?.reroll_points ?? 0) -
    (pending.result?.rerolls_spent ?? 0);

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.rollModal}>
        <header className={styles.modalHeader}>
          <div>
            <span>Проверка</span>
            <h3>{pending.choice.label}</h3>
          </div>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </header>

        <div className={styles.rollStage}>
          <div className={styles.die}>{pending.rolling ? animationValue : pending.result?.dice_value}</div>
          <div className={styles.rollFacts}>
            <p>{diceLabel(roll.dice)}</p>
            <p>
              {statLabels[roll.stat]} {statValue} ({signed(statMod)})
            </p>
            <p>Навык, класс и снаряжение: {signed(bonus)}</p>
            <p>Сложность: {roll.difficulty}</p>
          </div>
        </div>

        <p className={styles.rollReason}>{roll.reason}</p>

        {pending.result ? (
          <div
            className={`${styles.rollOutcome} ${
              pending.result.success ? styles.rollSuccess : styles.rollFailure
            }`}
          >
            <strong>{pending.result.success ? 'Успех' : 'Провал'}</strong>
            <span>
              Итог {pending.result.total} против сложности {pending.result.difficulty}
            </span>
          </div>
        ) : null}

        <footer className={styles.modalActions}>
          <Button type="button" disabled={pending.rolling || !pending.result} onClick={onConfirm}>
            ОК
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending.rolling || availableRerolls <= 0}
            onClick={onReroll}
          >
            Перебросить
          </Button>
          <span className={styles.rollHint}>Осталось: {Math.max(0, availableRerolls)}</span>
        </footer>
      </div>
    </div>
  );
}

export function RpgPage() {
  const { user, loading: authLoading } = useAuth();
  const playerId = user ? String(user.id) : '';
  const readOnlyMode = useMemo(isHistoryViewFromUrl, []);
  const [games, setGames] = useState<AvailableGame[]>([]);
  const [selectedGameId, setSelectedGameId] = useState('');
  const [theme, setTheme] = useState(defaultTheme);
  const [partyPlayers, setPartyPlayers] = useState('');
  const [friendPlayers, setFriendPlayers] = useState<Player[]>([]);
  const [selectedInitialFriendIds, setSelectedInitialFriendIds] = useState<string[]>([]);
  const [friendToInvite, setFriendToInvite] = useState('');
  const [inviteFriendsOpen, setInviteFriendsOpen] = useState(false);
  const [sessionId, setSessionId] = useState(getInitialSessionIdFromUrl);
  const [session, setSession] = useState<GameSessionResponse | null>(null);
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState('');
  const [input, setInput] = useState('');
  const [manualDice, setManualDice] = useState('d20');
  const [statInfluencePercent, setStatInfluencePercent] = useState(100);
  const [guideInput, setGuideInput] = useState('');
  const [guideMessages, setGuideMessages] = useState<GuideChatMessage[]>([]);
  const [guideSending, setGuideSending] = useState(false);
  const [scenarioWish, setScenarioWish] = useState('');
  const [characterWishes, setCharacterWishes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [revisionTarget, setRevisionTarget] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionBusyText, setSessionBusyText] = useState<string | null>(null);
  const [sessionQueueNotice, setSessionQueueNotice] = useState<string | null>(null);
  const [sessionRealtimeOffline, setSessionRealtimeOffline] = useState(false);
  const [refreshingChat, setRefreshingChat] = useState(false);
  const [trimmingChat, setTrimmingChat] = useState(false);
  const [selectingMessages, setSelectingMessages] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [dragSelecting, setDragSelecting] = useState(false);
  const [dragSelectValue, setDragSelectValue] = useState<boolean | null>(null);
  const [modalMode, setModalMode] = useState<'view' | 'edit' | null>(null);
  const [characterDraft, setCharacterDraft] = useState<CharacterDraft | null>(null);
  const [pendingRoll, setPendingRoll] = useState<PendingRoll | null>(null);
  const [animationValue, setAnimationValue] = useState(1);
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [typedMessages, setTypedMessages] = useState<Record<string, string>>({});
  const [guideTypingMessageId, setGuideTypingMessageId] = useState<string | null>(null);
  const [typedGuideMessages, setTypedGuideMessages] = useState<Record<string, string>>({});
  const chatWindowRef = useRef<HTMLDivElement | null>(null);
  const guideChatRef = useRef<HTMLDivElement | null>(null);
  const rollIntervalRef = useRef<number | null>(null);
  const rollTimeoutRef = useRef<number | null>(null);
  const typingIntervalRef = useRef<number | null>(null);
  const guideTypingIntervalRef = useRef<number | null>(null);

  const scenario = session?.game_state.public_state.scenario;
  const selectedGame =
    games.find((game) => game.id === selectedGameId) ??
    session?.game_state.public_state.selected_game ??
    null;
  const activeCharacter =
    session?.characters.find((character) => character.id === activeCharacterId) ??
    session?.characters[0] ??
    null;
  const currentChoices = session?.game_state.public_state.current_choices ?? [];
  const isPlaying = session?.session.status === 'active';
  const isFinished = session?.session.status === 'finished';
  const isSessionOwner =
    !session ||
    String(session.game_state.public_state.owner_player_id ?? '') === playerId;
  const participants = useMemo(
    () => session?.game_state.public_state.participants ?? [],
    [session?.game_state.public_state.participants],
  );
  const lobbyInvitations = session?.game_state.public_state.lobby_invitations ?? [];
  const currentLobbyInvitation = lobbyInvitations.find(
    (invite) => invite.to_player_id === playerId && invite.status === 'pending',
  );
  const pendingLobbyInvitations = lobbyInvitations.filter(
    (invite) => invite.status === 'pending',
  );
  const canUseCurrentSession =
    isSessionOwner ||
    participants.some((participant) => String(participant.id) === playerId);
  const assignablePlayers = useMemo(
    () => [
      ...participants.filter((participant) =>
        session?.game_state.public_state.participant_player_ids?.includes(
          String(participant.id),
        ),
      ),
    ],
    [participants, session?.game_state.public_state.participant_player_ids],
  );
  const participantNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const participant of participants) {
      names.set(
        String(participant.id),
        participant.name || participant.username || 'Игрок',
      );
    }
    const ownerId = String(session?.game_state.public_state.owner_player_id ?? '');
    if (ownerId && !names.has(ownerId)) {
      names.set(ownerId, 'Ведущий');
    }
    return names;
  }, [participants, session?.game_state.public_state.owner_player_id]);
  const statInfluenceMultiplier = statInfluencePercent / 100;

  useEffect(() => {
    void rpgService
      .listAvailableGames()
      .then((items) => {
        setGames(items);
        setSelectedGameId((current) => current || items[0]?.id || '');
      })
      .catch((requestError) => {
        browserLogger.error('rpg-page', 'games load failed', requestError);
        setError('Ведущий на мгновение замолчал. Попробуйте повторить действие.');
      });
  }, []);

  useEffect(() => {
    if (!user) {
      setFriendPlayers([]);
      return;
    }

    void playersService
      .list()
      .then((players) => {
        setFriendPlayers(
          players.filter(
            (player) => player.friendshipStatus === 'accepted' && !player.isCurrentUser,
          ),
        );
      })
      .catch((requestError) => {
        browserLogger.error('rpg-page', 'friends load failed', requestError);
      });
  }, [user]);

  const refreshSession = useCallback(
    async (id = sessionId) => {
      if (!id || !user) {
        return;
      }

      const [nextSession, nextMessages] = await Promise.all([
        rpgService.getSession(id, playerId),
        rpgService.getMessages(id),
      ]);

      setSession(nextSession);
      setMessages(nextMessages);
      setSelectedGameId(
        nextSession.game_state.public_state.selected_game?.id || selectedGameId,
      );
      setActiveCharacterId((current) => {
        if (nextSession.characters.some((character) => character.id === current)) {
          return current;
        }

        return (
          nextSession.characters.find(
            (character) =>
              String(character.player_id) === playerId && character.is_active,
          )?.id ??
          nextSession.characters[0]?.id ??
          ''
        );
      });
    },
    [playerId, selectedGameId, sessionId, user],
  );

  useEffect(() => {
    if (sessionId && user) {
      void refreshSession(sessionId).catch((requestError) => {
        browserLogger.error('rpg-page', 'session load failed', requestError);
        setError(safeGameError(requestError));
      });
    }
  }, [refreshSession, sessionId, user]);

  useEffect(() => {
    if (!session || !playerId) {
      return;
    }

    setActiveCharacterId((current) => {
      const currentCharacter = session.characters.find(
        (character) => character.id === current,
      );

      if (
        currentCharacter &&
        String(currentCharacter.player_id) === playerId &&
        currentCharacter.is_active
      ) {
        return current;
      }

      return (
        session.characters.find(
          (character) =>
            String(character.player_id) === playerId && character.is_active,
        )?.id ??
        currentCharacter?.id ??
        session.characters[0]?.id ??
        ''
      );
    });
  }, [playerId, session]);

  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }

    const socket: Socket = io(localApiBase, {
      auth: { token: getAuthToken() ?? '' },
      transports: ['websocket', 'polling'],
    });
    const joinSessionRoom = () => {
      socket.emit('join-game-session', sessionId);
      setSessionRealtimeOffline(false);
    };

    socket.on('connect', () => {
      joinSessionRoom();
    });
    socket.on('reconnect', () => {
      joinSessionRoom();
    });
    socket.on('disconnect', () => {
      setSessionRealtimeOffline(true);
    });
    socket.on('connect_error', () => {
      setSessionRealtimeOffline(true);
    });

    joinSessionRoom();
    socket.on('game-message-created', () => {
      void refreshSession(sessionId);
    });
    socket.on('game-session-updated', () => {
      void refreshSession(sessionId);
    });
    socket.on('game-map-updated', () => {
      void refreshSession(sessionId);
    });
    socket.on('game-turn-updated', () => {
      void refreshSession(sessionId);
    });
    socket.on(
      'game-session-busy',
      (payload: { busy?: boolean; label?: string } | null) => {
        const busy = Boolean(payload?.busy);
        setSessionBusy(busy);
        setSessionBusyText(busy ? sessionBusyStatus(payload?.label) : null);
        if (!busy) {
          setSessionQueueNotice(null);
        }
      },
    );
    socket.on('game-session-queued', () => {
      setSessionQueueNotice(
        'В этом лобби уже обрабатывается действие. Следующий запрос выполнится сразу после ответа ведущего.',
      );
    });

    return () => {
      socket.emit('leave-game-session', sessionId);
      socket.disconnect();
    };
  }, [refreshSession, sessionId]);

  useEffect(() => {
    if (!sessionId || !user) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      void refreshSession(sessionId).catch(() => {
        // Soft sync keeps both directions in sync even if a realtime event was missed.
      });
    }, sessionRealtimeOffline ? 1500 : 2200);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshSession, sessionId, sessionRealtimeOffline, user]);

  useEffect(() => {
    return () => {
      if (rollIntervalRef.current) {
        window.clearInterval(rollIntervalRef.current);
      }
      if (rollTimeoutRef.current) {
        window.clearTimeout(rollTimeoutRef.current);
      }
      if (typingIntervalRef.current) {
        window.clearInterval(typingIntervalRef.current);
      }
      if (guideTypingIntervalRef.current) {
        window.clearInterval(guideTypingIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const node = chatWindowRef.current;

    if (!node) {
      return;
    }

    node.scrollTo({
      top: node.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length, sending, typedMessages, typingMessageId]);

  useEffect(() => {
    const node = guideChatRef.current;

    if (!node) {
      return;
    }

    node.scrollTo({
      top: node.scrollHeight,
      behavior: 'smooth',
    });
  }, [guideMessages.length, guideSending, typedGuideMessages, guideTypingMessageId]);

  const startTypingMessage = useCallback((message: GameMessage) => {
    if (message.role !== 'gm' || !message.content) {
      return;
    }

    if (typingIntervalRef.current) {
      window.clearInterval(typingIntervalRef.current);
    }

    const fullText = message.content;
    let index = 0;

    setTypingMessageId(message.id);
    setTypedMessages((current) => ({ ...current, [message.id]: '' }));
    typingIntervalRef.current = window.setInterval(() => {
      index = Math.min(fullText.length, index + 2);
      setTypedMessages((current) => ({
        ...current,
        [message.id]: fullText.slice(0, index),
      }));

      if (index >= fullText.length) {
        if (typingIntervalRef.current) {
          window.clearInterval(typingIntervalRef.current);
          typingIntervalRef.current = null;
        }
        setTypingMessageId(null);
      }
    }, 18);
  }, []);

  const startGuideTypingMessage = useCallback((message: GuideChatMessage) => {
    if (message.role !== 'gm' || !message.content) {
      return;
    }

    if (guideTypingIntervalRef.current) {
      window.clearInterval(guideTypingIntervalRef.current);
    }

    const fullText = message.content;
    let index = 0;

    setGuideTypingMessageId(message.id);
    setTypedGuideMessages((current) => ({ ...current, [message.id]: '' }));
    guideTypingIntervalRef.current = window.setInterval(() => {
      index = Math.min(fullText.length, index + 2);
      setTypedGuideMessages((current) => ({
        ...current,
        [message.id]: fullText.slice(0, index),
      }));

      if (index >= fullText.length) {
        if (guideTypingIntervalRef.current) {
          window.clearInterval(guideTypingIntervalRef.current);
          guideTypingIntervalRef.current = null;
        }
        setGuideTypingMessageId(null);
      }
    }, 18);
  }, []);

  const makeRollResult = useCallback(
    (choice: Choice, diceValue: number, rerolled: boolean, rerollsSpent: number) => {
      const roll = choice.roll!;
      const statValue = activeCharacter?.stats[roll.stat] ?? 10;
      const baseStatMod = modifierFor(statValue);
      const statMod = Math.round(baseStatMod * statInfluenceMultiplier);
      const bonus = activeCharacter ? skillBonus(activeCharacter, roll) : 0;
      const total = diceValue + statMod + bonus;

      return {
        dice: roll.dice,
        dice_value: diceValue,
        stat: roll.stat,
        stat_value: statValue,
        stat_modifier: statMod,
        skill_bonus: bonus,
        total,
        difficulty: roll.difficulty,
        success: total >= roll.difficulty,
        rerolled,
        rerolls_spent: rerollsSpent,
      };
    },
    [activeCharacter, statInfluenceMultiplier],
  );

  const startRoll = useCallback(
    (choice: Choice, rerolled = false, rerollsSpent = 0) => {
      if (!choice.roll || !activeCharacter) {
        return;
      }

      const sides = diceSides(choice.roll.dice);
      if (rollIntervalRef.current) {
        window.clearInterval(rollIntervalRef.current);
      }
      if (rollTimeoutRef.current) {
        window.clearTimeout(rollTimeoutRef.current);
      }

      setPendingRoll({ choice, result: null, rolling: true });
      rollIntervalRef.current = window.setInterval(() => {
        setAnimationValue(randomDie(sides));
      }, 55);
      rollTimeoutRef.current = window.setTimeout(() => {
        if (rollIntervalRef.current) {
          window.clearInterval(rollIntervalRef.current);
          rollIntervalRef.current = null;
        }
        const result = makeRollResult(
          choice,
          randomDie(sides),
          rerolled,
          rerollsSpent,
        );
        setAnimationValue(result.dice_value);
        setPendingRoll({ choice, result, rolling: false });
      }, 900);
    },
    [activeCharacter, makeRollResult],
  );

  const sendAction = async (
    content: string,
    choice: Choice | null = null,
    rollResult: RollResult | null = null,
  ) => {
    if (readOnlyMode) {
      return;
    }

    if (!sessionId || !activeCharacter) {
      setError('Выберите персонажа для действия.');
      return;
    }

    if (!activeCharacter.is_active || activeCharacter.derived.hp_current <= 0) {
      setError('Этот персонаж выбыл из истории и больше не может действовать.');
      return;
    }

    if (!content.trim()) {
      return;
    }

    const trimmedContent = content.trim().slice(0, 1200);
    const showOptimisticMessage = !sessionBusy;
    const localMessage = createLocalPlayerMessage({
      sessionId,
      playerId,
      characterId: activeCharacter.id,
      content: trimmedContent,
    });

    if (showOptimisticMessage) {
      setMessages((current) => [...current, localMessage]);
    }
    setSending(true);
    setError(null);
    setNotice(null);
    setInput('');

    try {
      const response = await rpgService.sendMessage(sessionId, {
        player_id: playerId,
        character_id: activeCharacter.id,
        content: trimmedContent,
        choice,
        roll_result: rollResult,
      });
      setMessages((current) =>
        appendUniqueMessages(
          showOptimisticMessage
            ? current.filter((message) => message.id !== localMessage.id)
            : current,
          [response.player_message, response.gm_message],
        ),
      );
      setSession(response.state);
      startTypingMessage(response.gm_message);
      if (response.parse_error) {
        setNotice('Ведущий на мгновение замолчал. Попробуйте повторить действие.');
      }
    } catch (requestError) {
      browserLogger.error('rpg-page', 'send action failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setSending(false);
    }
  };

  const handleGenerate = async () => {
    if (readOnlyMode || sessionBusy) {
      return;
    }

    if (!selectedGameId) {
      setError('Выберите игру.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      setSession(null);
      setMessages([]);
      setActiveCharacterId('');
      setSessionId('');
      window.history.replaceState(null, '', '/lobby');

      const generated = await rpgService.generateCampaign(
        selectedGameId,
        theme.trim() || `Приключение в стиле ${selectedGame?.title || 'выбранной игры'}`,
        playerId,
        [
          ...partyPlayers
            .split(/[,\n]+/)
            .map((item) => item.trim())
            .filter(Boolean),
          ...selectedInitialFriendIds,
        ],
      );
      setSession(generated.state);
      setSessionId(generated.session_id);
      setActiveCharacterId(generated.state.characters[0]?.id ?? '');
      window.history.replaceState(
        null,
        '',
        `/lobby?session=${encodeURIComponent(generated.session_id)}`,
      );
      await refreshSession(generated.session_id);
      setNotice('Сценарий готов. Проверьте персонажей и начинайте игру.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'generate failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCharacter = async () => {
    if (readOnlyMode || !sessionId || sessionBusy || loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await rpgService.generateCharacter(sessionId, playerId);
      setSession(response.session);
      setActiveCharacterId(response.character.id);
      setNotice('Новый персонаж появился в лобби.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'character generate failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const handleClaimCharacter = async (characterId: string) => {
    if (readOnlyMode || !sessionId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await rpgService.claimCharacter(sessionId, characterId);
      setSession(response.session);
      if (String(response.character.player_id ?? '') === playerId) {
        setActiveCharacterId(response.character.id);
        setNotice('Персонаж выбран.');
      } else {
        setNotice('Вы отказались от персонажа.');
      }
    } catch (requestError) {
      browserLogger.error('rpg-page', 'character claim failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const toggleInitialFriend = (friendId: string) => {
    setSelectedInitialFriendIds((current) =>
      current.includes(friendId)
        ? current.filter((id) => id !== friendId)
        : [...current, friendId],
    );
  };

  const handleInviteFriend = async (friendId = friendToInvite) => {
    if (readOnlyMode || !sessionId || !friendId || !canUseCurrentSession) {
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await rpgService.invitePlayer(sessionId, friendId);
      setSession(response.session);
      setFriendToInvite('');
      setNotice('Приглашение отправлено. Игрок появится в партии после принятия.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'friend invite failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const handleRespondLobbyInvitation = async (status: 'accepted' | 'declined') => {
    if (!sessionId || !currentLobbyInvitation) {
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await rpgService.respondLobbyInvitation(
        sessionId,
        currentLobbyInvitation.id,
        status,
      );
      setSession(response.session);
      setNotice(
        status === 'accepted'
          ? 'Вы приняли приглашение. Ведущий назначит вам персонажа или разрешит создать своего.'
          : 'Вы отклонили приглашение.',
      );
    } catch (requestError) {
      browserLogger.error('rpg-page', 'lobby invitation respond failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const handleAssignCharacter = async (characterId: string, assigneeId: string) => {
    if (readOnlyMode || !sessionId || !isSessionOwner) {
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await rpgService.assignCharacter(
        sessionId,
        characterId,
        assigneeId,
      );
      setSession(response.session);
      setNotice('Персонаж назначен игроку.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'character assign failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const handleReviseScenario = async () => {
    if (readOnlyMode || !sessionId || !scenarioWish.trim() || sessionBusy) {
      return;
    }

    setRevisionTarget('scenario');
    setError(null);
    setNotice(null);

    try {
      const response = await rpgService.reviseScenario(
        sessionId,
        scenarioWish.trim().slice(0, 1000),
      );
      setSession(response.session);
      setScenarioWish('');
      await refreshSession(sessionId);
      setNotice('Сценарий изменён по вашему пожеланию.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'scenario revise failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setRevisionTarget(null);
    }
  };

  const handleReviseCharacter = async (characterId: string) => {
    const wish = characterWishes[characterId]?.trim() ?? '';

    if (readOnlyMode || !sessionId || !wish || sessionBusy) {
      return;
    }

    setRevisionTarget(characterId);
    setError(null);
    setNotice(null);

    try {
      const response = await rpgService.reviseCharacter(
        sessionId,
        characterId,
        wish.slice(0, 1000),
      );
      setSession(response.session);
      setActiveCharacterId(response.character.id);
      setCharacterWishes((current) => ({ ...current, [characterId]: '' }));
      setNotice('Персонаж изменён по вашему пожеланию.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'character revise failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setRevisionTarget(null);
    }
  };

  const openCharacter = (character: GameCharacter, mode: 'view' | 'edit' = 'view') => {
    setCharacterDraft(draftFromCharacter(character));
    setModalMode(mode);
  };

  const saveCharacterDraft = async () => {
    if (readOnlyMode || !sessionId || !characterDraft) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (characterDraft.id) {
        const response = await rpgService.updateCharacter(
          sessionId,
          playerId,
          characterDraft.id,
          characterFromDraft(characterDraft),
        );
        setSession(response.session);
      } else {
        const response = await rpgService.createCharacter(
          sessionId,
          playerId,
          characterFromDraft(characterDraft),
        );
        setSession(response.session);
      }
      setCharacterDraft(null);
      setModalMode(null);
      setNotice('Персонаж сохранён.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'character save failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const deleteCharacter = async (characterId: string) => {
    if (readOnlyMode || !sessionId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await rpgService.deleteCharacter(
        sessionId,
        playerId,
        characterId,
      );
      setSession(response.session);
      setActiveCharacterId(response.session.characters[0]?.id ?? '');
      setCharacterDraft(null);
      setModalMode(null);
      setNotice('Персонаж удалён.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'character delete failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = async () => {
    if (readOnlyMode) {
      return;
    }

    if (!sessionId || !session?.characters.length) {
      setError('Сначала нужен хотя бы один персонаж.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextSession = await rpgService.startSession(sessionId, playerId);
      setSession(nextSession);
      await refreshSession(sessionId);
      setNotice('Игра началась.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'start failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const handleFinishGame = async () => {
    if (readOnlyMode || !sessionId) {
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const nextSession = await rpgService.finishSession(sessionId, playerId);
      setSession(nextSession);
      await refreshSession(sessionId);
      setNotice('Игра завершена. История сохранена в аккаунте.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'finish failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setLoading(false);
    }
  };

  const handleChoiceClick = (choice: Choice) => {
    if (readOnlyMode) {
      return;
    }

    if (choice.requires_roll && choice.roll) {
      startRoll(choice);
      return;
    }

    void sendAction(choice.player_text, choice);
  };

  const handleConfirmRoll = () => {
    if (!pendingRoll?.result) {
      return;
    }

    const { choice, result } = pendingRoll;
    setPendingRoll(null);
    void sendAction(choice.player_text, choice, result);
  };

  const handleReroll = () => {
    if (readOnlyMode || !pendingRoll?.choice || !activeCharacter) {
      return;
    }

    const spent = pendingRoll.result?.rerolls_spent ?? 0;
    const available = (activeCharacter.resources?.reroll_points ?? 0) - spent;

    if (available <= 0) {
      setNotice('Очков переброса не осталось.');
      return;
    }

    startRoll(pendingRoll.choice, true, spent + 1);
  };

  const handleSendMessage = (event: FormEvent) => {
    event.preventDefault();
    void sendAction(input);
  };

  const handleManualDice = (expression: string) => {
    if (readOnlyMode || !activeCharacter || sending) {
      return;
    }

    void sendAction(`/roll ${expression}`);
  };

  const handleManualDiceSubmit = (event: FormEvent) => {
    event.preventDefault();
    const expression = manualDice.trim() || 'd20';
    handleManualDice(expression);
  };

  const handleRefreshChat = async () => {
    if (!sessionId || refreshingChat) {
      return;
    }

    setRefreshingChat(true);
    setError(null);

    try {
      await refreshSession(sessionId);
      setNotice('Чат синхронизирован с сервером.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'chat refresh failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setRefreshingChat(false);
    }
  };

  const handleTrimRecentMessages = async () => {
    if (!sessionId || trimmingChat) {
      return;
    }

    const confirmed = window.confirm(
      'Удалить последние 6 сообщений чата? Сценарий, персонажи и прогресс игры сохранятся.',
    );
    if (!confirmed) {
      return;
    }

    setTrimmingChat(true);
    setError(null);

    try {
      await rpgService.trimRecentMessages(sessionId, 6);
      await refreshSession(sessionId);
      setNotice('Последние сообщения удалены, прогресс игры сохранён.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'chat trim failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setTrimmingChat(false);
    }
  };

  const toggleMessageSelection = (messageId: string) => {
    setSelectedMessageIds((current) =>
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId],
    );
  };

  const applyMessageSelection = (messageId: string, nextSelected: boolean) => {
    setSelectedMessageIds((current) => {
      const exists = current.includes(messageId);
      if (nextSelected && !exists) {
        return [...current, messageId];
      }
      if (!nextSelected && exists) {
        return current.filter((id) => id !== messageId);
      }
      return current;
    });
  };

  const handleSelectDragStart = (messageId: string) => {
    const nextSelected = !selectedMessageIds.includes(messageId);
    setDragSelecting(true);
    setDragSelectValue(nextSelected);
    applyMessageSelection(messageId, nextSelected);
  };

  const handleSelectDragEnter = (messageId: string) => {
    if (!dragSelecting || dragSelectValue === null) {
      return;
    }
    applyMessageSelection(messageId, dragSelectValue);
  };

  useEffect(() => {
    if (!dragSelecting) {
      return undefined;
    }

    const stopDragging = () => {
      setDragSelecting(false);
      setDragSelectValue(null);
    };

    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('blur', stopDragging);
    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('blur', stopDragging);
    };
  }, [dragSelecting]);

  const handleDeleteSelectedMessages = async () => {
    if (!sessionId || trimmingChat || !selectedMessageIds.length) {
      return;
    }

    const confirmed = window.confirm(
      `Удалить выбранные сообщения (${selectedMessageIds.length})? Прогресс игры сохранится.`,
    );
    if (!confirmed) {
      return;
    }

    setTrimmingChat(true);
    setError(null);

    try {
      await rpgService.deleteMessagesByIds(sessionId, selectedMessageIds);
      await refreshSession(sessionId);
      setSelectingMessages(false);
      setSelectedMessageIds([]);
      setNotice('Выбранные сообщения удалены, прогресс игры сохранён.');
    } catch (requestError) {
      browserLogger.error('rpg-page', 'chat selected-delete failed', requestError);
      setError(safeGameError(requestError));
    } finally {
      setTrimmingChat(false);
    }
  };

  const handleGuideQuestion = async (event: FormEvent) => {
    event.preventDefault();

    if (readOnlyMode || !sessionId || guideSending) {
      return;
    }

    const question = guideInput.trim().slice(0, 1200);

    if (!question) {
      return;
    }

    setGuideMessages((current) => [
      ...current,
      {
        id: `guide_player_${Date.now()}`,
        role: 'player',
        content: question,
      },
    ]);
    setGuideInput('');
    setGuideSending(true);
    setError(null);

    try {
      const response = await rpgService.askGuide(sessionId, question);
      const gmMessage = {
        id: `guide_gm_${Date.now()}`,
        role: 'gm' as const,
        content:
          response.answer ||
          'Ведущий задумался. Попробуйте спросить иначе.',
      };
      setGuideMessages((current) => [...current, gmMessage]);
      startGuideTypingMessage(gmMessage);
    } catch (requestError) {
      browserLogger.error('rpg-page', 'guide question failed', requestError);
      const gmMessage = {
        id: `guide_gm_${Date.now()}`,
        role: 'gm' as const,
        content:
          'Ведущий не смог ответить сейчас. Попробуйте задать вопрос ещё раз.',
      };
      setGuideMessages((current) => [...current, gmMessage]);
      startGuideTypingMessage(gmMessage);
    } finally {
      setGuideSending(false);
    }
  };

  if (authLoading) {
    return (
      <div className={styles.page}>
        <Panel title="Открываем игровой стол" description="Проверяем ваш аккаунт." />
      </div>
    );
  }

  if (!user) {
    return (
      <div className={styles.page}>
        <Panel
          title="Войдите, чтобы создать лобби"
          description="Ролевые партии сохраняются в аккаунте, поэтому создание лобби и генерация доступны после входа."
        >
          <div className={styles.startBar}>
            <Link to="/auth">
              <Button type="button">Вход и регистрация</Button>
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.lobbyHeader}>
        <div>
          <p className={styles.kicker}>
            {readOnlyMode ? 'История игры' : 'Лобби НРИ'}
          </p>
          <h2>
            {readOnlyMode
              ? scenario?.title ?? session?.session.title ?? 'Сохранённая партия'
              : 'Ролевая партия'}
          </h2>
        </div>
        {selectedGame ? <span>{selectedGame.title}</span> : null}
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {sessionQueueNotice ? <p className={styles.notice}>{sessionQueueNotice}</p> : null}
      {sessionBusyText ? <p className={styles.generationStatus}>{sessionBusyText}</p> : null}
      {currentLobbyInvitation ? (
        <Panel
          title="Приглашение в лобби"
          description={`Ведущий ${
            currentLobbyInvitation.from_name || 'партии'
          } приглашает вас в эту ролевую партию.`}
        >
          <div className={styles.invitationActions}>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void handleRespondLobbyInvitation('declined')}
            >
              Отклонить
            </Button>
            <Button
              type="button"
              disabled={loading}
              onClick={() => void handleRespondLobbyInvitation('accepted')}
            >
              Принять
            </Button>
          </div>
        </Panel>
      ) : null}

      {!isPlaying && !isFinished ? (
        <>
          {!session && !readOnlyMode ? (
            <Panel
              title="Генерация сценария"
              description="Выберите НРИ-систему и задайте идею будущей истории."
            >
              <div className={styles.generatorForm}>
                <Field label="НРИ-система">
                  <select
                    value={selectedGameId}
                    onChange={(event) => setSelectedGameId(event.target.value)}
                  >
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {game.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <textarea
                  value={theme}
                  maxLength={500}
                  placeholder="Например: город, где магия запрещена, а под землёй просыпается древнее существо"
                  onChange={(event) => setTheme(event.target.value)}
                />
                <Field label="Игроки партии">
                  <textarea
                    value={partyPlayers}
                    maxLength={500}
                    placeholder="Добавьте игроков через запятую: код друга, почта, имя или логин"
                    onChange={(event) => setPartyPlayers(event.target.value)}
                  />
                </Field>
                {loading ? (
                  <p className={styles.generationStatus}>
                    Ведущий готовит сцену. Это может занять немного времени.
                  </p>
                ) : null}
                <div className={styles.startBar}>
                  <Button type="button" disabled={loading || sessionBusy} onClick={handleGenerate}>
                    {loading ? 'Ведущий готовит сцену...' : 'Сгенерировать сценарий'}
                  </Button>
                </div>
                <div className={styles.inviteRow}>
                  <div>
                    <strong>Друзья в партии</strong>
                    <p className={styles.muted}>
                      {selectedInitialFriendIds.length
                        ? `Будет отправлено приглашений: ${selectedInitialFriendIds.length}`
                        : 'После генерации друзья получат приглашение и сами решат, принять его или нет.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setInviteFriendsOpen(true)}
                  >
                    Пригласить друзей
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}

          <section className={styles.campaignGrid}>
            <Panel
              title={scenario?.title ?? 'Сценарий'}
              description={
                scenario
                  ? scenario.short_description
                  : 'После генерации здесь появятся завязка, цель и стартовая ситуация.'
              }
            >
              {scenario ? (
                <>
                  <div className={styles.factGrid}>
                    <div>
                      <span>Жанр</span>
                      <strong>{scenario.genre}</strong>
                      <p>{scenario.tone}</p>
                    </div>
                    <div>
                      <span>Конфликт</span>
                      <strong>{scenario.main_conflict}</strong>
                    </div>
                    <div>
                      <span>Цель</span>
                      <strong>{scenario.current_goal}</strong>
                    </div>
                  </div>
                  {!readOnlyMode ? (
                    <div className={styles.revisionBox}>
                      <label>
                        <span>Пожелание к сценарию</span>
                        <textarea
                          value={scenarioWish}
                          maxLength={1000}
                          placeholder="Например: сделать начало более мрачным, добавить политическую интригу или заменить главную угрозу"
                          onChange={(event) => setScenarioWish(event.target.value)}
                        />
                      </label>
                      <div className={styles.chatFooter}>
                        <span>{scenarioWish.length}/1000</span>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={
                            revisionTarget === 'scenario' ||
                            !scenarioWish.trim() ||
                            sessionBusy
                          }
                          onClick={handleReviseScenario}
                        >
                          {revisionTarget === 'scenario'
                            ? 'Ведущий переписывает...'
                            : 'Изменить сценарий'}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
              {participants.length ? (
                <div className={styles.inviteRow}>
                  <div>
                    <strong>Игроки партии</strong>
                    <div className={styles.partyPlayers}>
                      {participants.map((participant) => (
                        <span key={participant.id}>
                          {participant.name || participant.username || 'Игрок'}
                          {participant.role ? ` · ${participant.role}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  {session && !readOnlyMode && canUseCurrentSession ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={loading}
                      onClick={() => setInviteFriendsOpen(true)}
                    >
                      Пригласить друзей
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {pendingLobbyInvitations.length && isSessionOwner ? (
                <div className={styles.pendingInvites}>
                  {pendingLobbyInvitations.map((invite) => (
                    <span key={invite.id}>
                      Ожидает: {invite.to_name || invite.to_username || 'игрок'}
                    </span>
                  ))}
                </div>
              ) : null}
            </Panel>

            <Panel
              id="rpg-character-options"
              title="Персонажи"
              action={
                session && !readOnlyMode && canUseCurrentSession ? (
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={loading}
                      onClick={() => {
                        setCharacterDraft(blankCharacterDraft());
                        setModalMode('edit');
                      }}
                    >
                      Добавить персонажа
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={loading || sessionBusy}
                      onClick={handleGenerateCharacter}
                    >
                      Сгенерировать персонажа
                    </Button>
                  </div>
                ) : null
              }
            >
              {loading && session ? (
                <p className={styles.generationStatus}>
                  Ведущий работает над партией. Дождитесь завершения действия.
                </p>
              ) : null}
              {session?.characters.length ? (
                <div className={styles.characterOptions}>
                  {session.characters.map((character) => (
                    <article key={character.id} className={styles.characterEditCard}>
                      <button
                        type="button"
                        className={`${styles.characterCard} ${
                          character.id === activeCharacterId
                            ? styles.characterCardActive
                            : ''
                        }`}
                        onClick={() => {
                          setActiveCharacterId(character.id);
                          openCharacter(character);
                        }}
                      >
                        <strong>{character.name}</strong>
                        <span>
                          {character.origin} / {character.class_name}
                        </span>
                        <p>{character.description}</p>
                        <small>
                          Здоровье {character.derived.hp_current}/
                          {character.derived.hp_max}
                        </small>
                        <small>
                          Игрок:{' '}
                          {String(character.player_id ?? '') === 'party'
                            ? 'Не назначен'
                            : participantNameById.get(String(character.player_id ?? '')) ??
                              `#${String(character.player_id ?? 'неизвестно')}`}
                        </small>
                        {!character.is_active || character.derived.hp_current <= 0 ? (
                          <small className={styles.deadBadge}>Погиб</small>
                        ) : null}
                        {!readOnlyMode &&
                        canUseCurrentSession &&
                        character.is_active ? (
                          <i
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleClaimCharacter(character.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.stopPropagation();
                                void handleClaimCharacter(character.id);
                              }
                            }}
                          >
                            {String(character.player_id ?? '') === playerId
                              ? 'Отказаться от персонажа'
                              : 'Выбрать персонажа'}
                          </i>
                        ) : null}
                        {!readOnlyMode && isSessionOwner ? (
                          <i
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteCharacter(character.id);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.stopPropagation();
                                void deleteCharacter(character.id);
                              }
                            }}
                          >
                            Удалить
                          </i>
                        ) : null}
                      </button>
                      {!readOnlyMode && isSessionOwner ? (
                        <label className={styles.assignControl}>
                          <span>Игрок</span>
                          <select
                            value={character.player_id || 'party'}
                            disabled={loading || sessionBusy}
                            onChange={(event) =>
                              void handleAssignCharacter(
                                character.id,
                                event.target.value,
                              )
                            }
                          >
                            <option value="party">Не назначен</option>
                            {assignablePlayers.map((participant) => (
                              <option key={participant.id} value={participant.id}>
                                {participant.name || participant.username || 'Игрок'}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {!readOnlyMode && isSessionOwner ? (
                        <div className={styles.characterRevision}>
                          <textarea
                            value={characterWishes[character.id] ?? ''}
                            maxLength={1000}
                            placeholder="Пожелание к этому персонажу"
                            onChange={(event) =>
                              setCharacterWishes((current) => ({
                                ...current,
                                [character.id]: event.target.value,
                              }))
                            }
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={
                              revisionTarget === character.id ||
                              !(characterWishes[character.id] ?? '').trim() ||
                              sessionBusy
                            }
                            onClick={() => void handleReviseCharacter(character.id)}
                          >
                            {revisionTarget === character.id
                              ? 'Ведущий меняет...'
                              : 'Изменить персонажа'}
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>
                  {session
                    ? 'Персонажи ещё не созданы. Добавьте героя вручную или сгенерируйте персонажа.'
                    : 'Персонажи появятся после генерации тематики.'}
                </p>
              )}
            </Panel>
          </section>

          {session && !readOnlyMode ? (
            <div className={styles.startBar}>
              <Button
                type="button"
                disabled={
                  loading || sessionBusy || !session.characters.length || !isSessionOwner
                }
                onClick={handleStartGame}
              >
                Начать игру
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {isFinished && session ? (
        <section className={styles.playLayout}>
          <div className={styles.tableColumn}>
            <Panel
              title="Игра завершена"
              description="История сохранена в аккаунте. Чат ведущего остановлен."
            >
              <div className={styles.chatBox}>
                <div className={styles.chatWindow}>
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      character={session.characters.find(
                        (character) => character.id === message.character_id,
                      )}
                    />
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          <aside className={styles.sidebar}>
            <Panel title="Сводка истории">
              <div className={styles.sideList}>
                <div className={styles.questCard}>
                  <strong>{session.game_state.public_state.scenario?.title ?? 'Сценарий'}</strong>
                  <span>{session.session.genre}</span>
                  <p>{session.game_state.public_state.scenario?.short_description ?? 'Описание недоступно.'}</p>
                </div>
              </div>
            </Panel>

            <Panel title="Персонажи">
              <div className={styles.sideList}>
                {session.characters.length ? (
                  session.characters.map((character) => (
                    <div key={character.id} className={styles.partyCard}>
                      <strong>{character.name}</strong>
                      <span>
                        {character.derived.hp_current}/{character.derived.hp_max}
                      </span>
                      {!character.is_active || character.derived.hp_current <= 0 ? (
                        <span className={styles.deadBadge}>Погиб</span>
                      ) : null}
                      <small>{character.role} · {character.class_name}</small>
                      <small>
                        Игрок:{' '}
                        {String(character.player_id ?? '') === 'party'
                          ? 'Не назначен'
                          : participantNameById.get(String(character.player_id ?? '')) ??
                            `#${String(character.player_id ?? 'неизвестно')}`}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className={styles.muted}>В этой истории нет персонажей.</p>
                )}
              </div>
            </Panel>

            <Panel title="Задания">
              {session.quests.length ? (
                <div className={styles.sideList}>
                  {session.quests.map((quest) => (
                    <div key={quest.id} className={styles.questCard}>
                      <strong>{quest.title}</strong>
                      <span>{quest.status}</span>
                      <p>{quest.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>Активных заданий не осталось.</p>
              )}
            </Panel>

            <Panel title="Локации">
              {session.map?.locations?.length ? (
                <div className={styles.sideList}>
                  {session.map.locations
                    .filter((location) => location.visible_to_players !== false)
                    .map((location) => (
                      <div key={location.id} className={styles.questCard}>
                        <strong>{location.name}</strong>
                        <span>Опасность: {location.danger_level ?? 1}</span>
                        <p>{location.description || 'Описание отсутствует.'}</p>
                      </div>
                    ))}
                </div>
              ) : (
                <p className={styles.muted}>Локации не сохранены.</p>
              )}
            </Panel>
          </aside>
        </section>
      ) : null}

      {isPlaying && session ? (
        <section className={styles.playLayout}>
          <div className={styles.tableColumn}>
            <Panel
              title={scenario?.current_goal ?? session.session.current_scene}
              eyebrow={`Сейчас ходит: ${actorName(session)}`}
              description={
                session.session.turn_mode
                  ? `Раунд ${session.session.round}`
                  : 'Свободная сцена'
              }
              action={
                readOnlyMode ? null : (
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={refreshingChat}
                      onClick={() => void handleRefreshChat()}
                    >
                      {refreshingChat ? 'Синхронизация...' : 'Обновить чат'}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={trimmingChat}
                      onClick={() => {
                        setSelectingMessages((current) => {
                          const next = !current;
                          if (!next) {
                            setSelectedMessageIds([]);
                          }
                          return next;
                        });
                      }}
                    >
                      {selectingMessages ? 'Отменить выбор' : 'Выбрать сообщения'}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={trimmingChat || !selectedMessageIds.length}
                      onClick={() => void handleDeleteSelectedMessages()}
                    >
                      {trimmingChat
                        ? 'Удаление...'
                        : `Удалить выбранные (${selectedMessageIds.length})`}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={trimmingChat}
                      onClick={() => void handleTrimRecentMessages()}
                    >
                      {trimmingChat ? 'Очистка...' : 'Очистить последние сообщения'}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={loading}
                      onClick={handleFinishGame}
                    >
                      Завершить игру
                    </Button>
                  </div>
                )
              }
            >
              <div className={styles.actorSelector}>
                <div>
                  <span>Кто действует</span>
                  <strong>{activeCharacter?.name ?? 'Выберите персонажа'}</strong>
                </div>
                <div className={styles.actorOptions}>
                  {session.characters.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      className={
                        character.id === activeCharacterId
                          ? styles.actorOptionActive
                          : ''
                      }
                      disabled={readOnlyMode || sending}
                      onClick={() => setActiveCharacterId(character.id)}
                    >
                      <strong>{character.name}</strong>
                      <span>
                        {character.derived.hp_current}/{character.derived.hp_max} ·{' '}
                        {character.class_name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.chatBox}>
                {sending || sessionBusy ? (
                  <div className={styles.chatStatus}>
                    {sending
                      ? 'Ожидается ответ ведущего'
                      : 'Ведущий обрабатывает действие'}
                  </div>
                ) : null}
                <div ref={chatWindowRef} className={styles.chatWindow}>
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      character={session.characters.find(
                        (character) => character.id === message.character_id,
                      )}
                      content={typedMessages[message.id]}
                      typing={typingMessageId === message.id}
                      selectable={selectingMessages}
                      selected={selectedMessageIds.includes(message.id)}
                      onToggleSelect={toggleMessageSelection}
                      onSelectDragStart={handleSelectDragStart}
                      onSelectDragEnter={handleSelectDragEnter}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.choiceGrid}>
                {currentChoices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={
                      readOnlyMode ||
                      !canUseCurrentSession ||
                      sending ||
                      !activeCharacter ||
                      !activeCharacter.is_active
                    }
                    onClick={() => handleChoiceClick(choice)}
                  >
                    <strong>{choice.label}</strong>
                    {choice.requires_roll && choice.roll ? (
                      <span>
                        Проверка: {statLabels[choice.roll.stat]}, сложность{' '}
                        {choice.roll.difficulty}
                        {activeCharacter
                          ? (() => {
                              const needed = requiredDiceTarget(
                                activeCharacter,
                                choice.roll,
                                statInfluenceMultiplier,
                              );
                              const sides = diceSides(choice.roll.dice);
                              if (needed <= 1) {
                                return ', на кубике: любой результат';
                              }
                              if (needed > sides) {
                                return `, на кубике: ${needed}+`;
                              }
                              return `, на кубике: ${needed}+`;
                            })()
                          : ''}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              <form className={styles.chatForm} onSubmit={handleSendMessage}>
                <textarea
                  value={input}
                  maxLength={1200}
                  placeholder={
                    readOnlyMode
                      ? 'История открыта только для просмотра'
                      : 'Опишите действие персонажа внутри сцены'
                  }
                  disabled={
                    readOnlyMode ||
                    !canUseCurrentSession ||
                    !activeCharacter ||
                    !activeCharacter.is_active ||
                    sending
                  }
                  onChange={(event) => setInput(event.target.value)}
                />
                <div className={styles.chatFooter}>
                  <span>{input.length}/1200</span>
                  <Button
                    type="submit"
                    disabled={
                      readOnlyMode ||
                      !canUseCurrentSession ||
                      !activeCharacter ||
                      !activeCharacter.is_active ||
                      sending
                    }
                  >
                    {sending ? 'Ведущий думает...' : 'Отправить'}
                  </Button>
                </div>
              </form>
            </Panel>

          </div>

          <aside className={styles.sidebar}>
            <Panel
              title="Персонажи"
              action={
                readOnlyMode || !isSessionOwner ? null : (
                <div className={styles.actions}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loading || sessionBusy}
                    onClick={() => {
                      setCharacterDraft(blankCharacterDraft());
                      setModalMode('edit');
                    }}
                  >
                    Добавить
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loading || sessionBusy}
                    onClick={handleGenerateCharacter}
                  >
                    Сгенерировать
                  </Button>
                </div>
                )
              }
            >
              <div className={styles.sideList}>
                {session.characters.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    className={`${styles.partyCard} ${
                      character.id === activeCharacter?.id ? styles.partyCardActive : ''
                    }`}
                    onClick={() => {
                      openCharacter(character);
                    }}
                  >
                    <strong>{character.name}</strong>
                    <span>
                      {character.derived.hp_current}/{character.derived.hp_max}
                    </span>
                    {!character.is_active || character.derived.hp_current <= 0 ? (
                      <span className={styles.deadBadge}>Погиб</span>
                    ) : null}
                    <small>{character.role} · {character.class_name}</small>
                    <small>
                      Игрок:{' '}
                      {String(character.player_id ?? '') === 'party'
                        ? 'Не назначен'
                        : participantNameById.get(String(character.player_id ?? '')) ??
                          `#${String(character.player_id ?? 'неизвестно')}`}
                    </small>
                    {!readOnlyMode &&
                    canUseCurrentSession &&
                    character.is_active ? (
                      <em
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleClaimCharacter(character.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.stopPropagation();
                            void handleClaimCharacter(character.id);
                          }
                        }}
                      >
                        {String(character.player_id ?? '') === playerId
                          ? 'Отказаться'
                          : 'Выбрать'}
                      </em>
                    ) : null}
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Задания">
              {session.quests.length ? (
                <div className={styles.sideList}>
                  {session.quests.map((quest) => (
                    <div key={quest.id} className={styles.questCard}>
                      <strong>{quest.title}</strong>
                      <span>{quest.status}</span>
                      <p>{quest.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.muted}>Активных заданий пока нет.</p>
              )}
            </Panel>

            <Panel title="Кубики">
              <label className={styles.assignControl}>
                <span>Влияние характеристик: {statInfluencePercent}%</span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={10}
                  value={statInfluencePercent}
                  onChange={(event) =>
                    setStatInfluencePercent(Number(event.target.value) || 100)
                  }
                />
              </label>
              <div className={styles.diceGrid}>
                {['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'].map((dice) => (
                  <button
                    key={dice}
                    type="button"
                    disabled={
                      readOnlyMode ||
                      !canUseCurrentSession ||
                      !activeCharacter ||
                      !activeCharacter.is_active ||
                      sending
                    }
                    onClick={() => handleManualDice(dice)}
                  >
                    {dice}
                  </button>
                ))}
              </div>
              <form className={styles.diceForm} onSubmit={handleManualDiceSubmit}>
                <input
                  value={manualDice}
                  placeholder="2d6+3"
                  disabled={
                    readOnlyMode ||
                    !canUseCurrentSession ||
                    !activeCharacter ||
                    !activeCharacter.is_active ||
                    sending
                  }
                  onChange={(event) => setManualDice(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={
                    readOnlyMode ||
                    !canUseCurrentSession ||
                    !activeCharacter ||
                    !activeCharacter.is_active ||
                    sending
                  }
                >
                  Бросить
                </Button>
              </form>
            </Panel>

            <Panel title="Вопрос ведущему">
              <div className={styles.guideChat}>
                <div ref={guideChatRef} className={styles.guideMessages}>
                  {guideMessages.length ? (
                    guideMessages.map((message) => (
                      <article
                        key={message.id}
                        className={`${styles.guideMessage} ${
                          message.role === 'gm' ? styles.guideMessageGm : ''
                        }`}
                      >
                        <span>{message.role === 'gm' ? 'Ведущий' : 'Вы'}</span>
                        <p>
                          {typedGuideMessages[message.id] ?? message.content}
                          {guideTypingMessageId === message.id ? (
                            <i className={styles.typingCaret} />
                          ) : null}
                        </p>
                      </article>
                    ))
                  ) : (
                    <p className={styles.muted}>
                      Здесь можно спросить о сцене, правилах, персонажах или
                      известных фактах.
                    </p>
                  )}
                  {guideSending ? (
                    <article
                      className={`${styles.guideMessage} ${styles.guideMessageGm}`}
                    >
                      <span>Ведущий</span>
                      <p>Обдумывает ответ...</p>
                    </article>
                  ) : null}
                </div>
                <form className={styles.guideForm} onSubmit={handleGuideQuestion}>
                  <textarea
                    value={guideInput}
                    maxLength={1200}
                    placeholder="Спросите о текущей игре"
                    disabled={readOnlyMode || guideSending}
                    onChange={(event) => setGuideInput(event.target.value)}
                  />
                  <div className={styles.chatFooter}>
                    <span>{guideInput.length}/1200</span>
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={readOnlyMode || guideSending || !guideInput.trim()}
                    >
                      {guideSending ? 'Ведущий думает...' : 'Спросить'}
                    </Button>
                  </div>
                </form>
              </div>
            </Panel>
          </aside>
        </section>
      ) : null}

      {characterDraft && modalMode ? (
        <CharacterModal
          draft={characterDraft}
          mode={modalMode}
          readOnly={readOnlyMode}
          onChange={(nextDraft) => {
            if (readOnlyMode) {
              return;
            }
            if (modalMode === 'view') {
              setModalMode('edit');
            }
            setCharacterDraft(nextDraft);
          }}
          onClose={() => {
            setCharacterDraft(null);
            setModalMode(null);
          }}
          onSave={saveCharacterDraft}
          onDelete={
            !readOnlyMode && characterDraft.id
              ? () => void deleteCharacter(characterDraft.id!)
              : undefined
          }
        />
      ) : null}

      {inviteFriendsOpen ? (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
          <div className={styles.friendInviteModal}>
            <header className={styles.modalHeader}>
              <div>
                <span>Партия</span>
                <h3>Пригласить друзей</h3>
              </div>
              <button type="button" onClick={() => setInviteFriendsOpen(false)}>
                Закрыть
              </button>
            </header>

            {friendPlayers.length ? (
              <div className={styles.friendInviteList}>
                {friendPlayers.map((friend) => {
                  const friendId = String(friend.id);
                  const selected = selectedInitialFriendIds.includes(friendId);
                  const alreadyInParty = participants.some(
                    (participant) => String(participant.id) === friendId,
                  );
                  const pendingInvite = pendingLobbyInvitations.some(
                    (invite) => String(invite.to_player_id) === friendId,
                  );

                  return (
                    <article key={friend.id} className={styles.friendInviteItem}>
                      <div>
                        <strong>{friend.name}</strong>
                        <span>@{friend.username}</span>
                      </div>
                      {session ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={loading || alreadyInParty || pendingInvite}
                          onClick={() => void handleInviteFriend(friendId)}
                        >
                          {alreadyInParty
                            ? 'Уже в партии'
                            : pendingInvite
                              ? 'Ожидает'
                              : 'Пригласить'}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant={selected ? 'primary' : 'secondary'}
                          onClick={() => toggleInitialFriend(friendId)}
                        >
                          {selected ? 'Выбран' : 'Выбрать'}
                        </Button>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyInviteState}>
                <strong>Друзей пока нет</strong>
                <p>
                  Добавьте друзей в разделе игроков, а потом пригласите их в
                  партию.
                </p>
                <Link to="/players">
                  <Button type="button" variant="secondary">
                    Перейти к игрокам
                  </Button>
                </Link>
              </div>
            )}

            <footer className={styles.modalActions}>
              <Button type="button" onClick={() => setInviteFriendsOpen(false)}>
                Готово
              </Button>
            </footer>
          </div>
        </div>
      ) : null}

      {pendingRoll && activeCharacter && !readOnlyMode ? (
        <RollModal
          pending={pendingRoll}
          animationValue={animationValue}
          activeCharacter={activeCharacter}
          statInfluenceMultiplier={statInfluenceMultiplier}
          onConfirm={handleConfirmRoll}
          onReroll={handleReroll}
          onClose={() => setPendingRoll(null)}
        />
      ) : null}
    </div>
  );
}
