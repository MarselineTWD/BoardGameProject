import { localRequest } from '../../../shared/api/http';
import {
  AvailableGame,
  CampaignCharacterTemplate,
  Choice,
  GameMessage,
  GameSessionListItem,
  GameSessionResponse,
  GenerateCampaignResponse,
  GameCharacter,
  RollResult,
  SendMessageResponse,
} from '../model/types';

export const rpgService = {
  listAvailableGames() {
    return localRequest<AvailableGame[]>('/api/game-sessions/available-games');
  },

  listSessions(playerId: string) {
    return localRequest<GameSessionListItem[]>(
      `/api/game-sessions?player_id=${encodeURIComponent(playerId)}`,
    );
  },

  generateCampaign(
    gameId: string,
    theme: string,
    playerId?: string,
    players: string[] = [],
  ) {
    return localRequest<GenerateCampaignResponse>('/api/game-sessions/generate', {
      method: 'POST',
      body: JSON.stringify({ game_id: gameId, theme, player_id: playerId, players }),
    });
  },

  reviseScenario(sessionId: string, wish: string) {
    return localRequest<{
      scenario: GenerateCampaignResponse['scenario'];
      choices: Choice[];
      session: GameSessionResponse;
    }>(`/api/game-sessions/${sessionId}/scenario/revise`, {
      method: 'POST',
      body: JSON.stringify({ wish }),
    });
  },

  generateCharacter(sessionId: string, playerId: string) {
    return localRequest<{ character: GameCharacter; session: GameSessionResponse }>(
      `/api/game-sessions/${sessionId}/characters/generate`,
      {
        method: 'POST',
        body: JSON.stringify({ player_id: playerId }),
      },
    );
  },

  createCharacter(
    sessionId: string,
    playerId: string,
    character: CampaignCharacterTemplate,
  ) {
    return localRequest<{
      character: unknown;
      session: GameSessionResponse;
    }>(`/api/game-sessions/${sessionId}/characters`, {
      method: 'POST',
      body: JSON.stringify({
        player_id: playerId,
        character,
      }),
    });
  },

  updateCharacter(
    sessionId: string,
    playerId: string,
    characterId: string,
    character: Partial<CampaignCharacterTemplate>,
  ) {
    return localRequest<{
      character: GameCharacter;
      session: GameSessionResponse;
    }>(`/api/game-sessions/${sessionId}/characters/${characterId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        player_id: playerId,
        character,
      }),
    });
  },

  reviseCharacter(sessionId: string, characterId: string, wish: string) {
    return localRequest<{
      character: GameCharacter;
      session: GameSessionResponse;
    }>(`/api/game-sessions/${sessionId}/characters/${characterId}/revise`, {
      method: 'POST',
      body: JSON.stringify({ wish }),
    });
  },

  deleteCharacter(sessionId: string, playerId: string, characterId: string) {
    return localRequest<{ session: GameSessionResponse }>(
      `/api/game-sessions/${sessionId}/characters/${characterId}?player_id=${encodeURIComponent(
        playerId,
      )}`,
      {
        method: 'DELETE',
      },
    );
  },

  claimCharacter(sessionId: string, characterId: string) {
    return localRequest<{ character: GameCharacter; session: GameSessionResponse }>(
      `/api/game-sessions/${sessionId}/characters/${characterId}/claim`,
      {
        method: 'POST',
      },
    );
  },

  invitePlayer(sessionId: string, playerId: string | number) {
    return localRequest<{ session: GameSessionResponse }>(
      `/api/game-sessions/${sessionId}/players`,
      {
        method: 'POST',
        body: JSON.stringify({ player_id: playerId }),
      },
    );
  },

  respondLobbyInvitation(
    sessionId: string,
    invitationId: string,
    status: 'accepted' | 'declined',
  ) {
    return localRequest<{ session: GameSessionResponse; status: string }>(
      `/api/game-sessions/${sessionId}/invitations/${invitationId}/respond`,
      {
        method: 'POST',
        body: JSON.stringify({ status }),
      },
    );
  },

  assignCharacter(sessionId: string, characterId: string, playerId: string) {
    return localRequest<{ character: GameCharacter; session: GameSessionResponse }>(
      `/api/game-sessions/${sessionId}/characters/${characterId}/assign`,
      {
        method: 'POST',
        body: JSON.stringify({ player_id: playerId }),
      },
    );
  },

  startSession(sessionId: string, playerId: string) {
    return localRequest<GameSessionResponse>(`/api/game-sessions/${sessionId}/start`, {
      method: 'POST',
      body: JSON.stringify({ player_id: playerId }),
    });
  },

  finishSession(sessionId: string, playerId: string) {
    return localRequest<GameSessionResponse>(
      `/api/game-sessions/${sessionId}/finish`,
      {
        method: 'POST',
        body: JSON.stringify({ player_id: playerId }),
      },
    );
  },

  getSession(sessionId: string, playerId?: string) {
    const query = playerId ? `?player_id=${encodeURIComponent(playerId)}` : '';
    return localRequest<GameSessionResponse>(`/api/game-sessions/${sessionId}${query}`);
  },

  getMessages(sessionId: string) {
    return localRequest<GameMessage[]>(`/api/game-sessions/${sessionId}/messages`);
  },

  sendMessage(
    sessionId: string,
    payload: {
      player_id: string;
      character_id: string;
      content: string;
      choice?: Choice | null;
      roll_result?: RollResult | null;
    },
  ) {
    return localRequest<SendMessageResponse>(
      `/api/game-sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },

  trimRecentMessages(sessionId: string, count = 6) {
    return localRequest<{ removed: number; state: GameSessionResponse }>(
      `/api/game-sessions/${sessionId}/messages/trim`,
      {
        method: 'POST',
        body: JSON.stringify({ count }),
      },
    );
  },

  deleteMessagesByIds(sessionId: string, messageIds: string[]) {
    return localRequest<{ removed: number; state: GameSessionResponse }>(
      `/api/game-sessions/${sessionId}/messages/delete`,
      {
        method: 'POST',
        body: JSON.stringify({ message_ids: messageIds }),
      },
    );
  },

  askGuide(sessionId: string, question: string) {
    return localRequest<{ answer: string }>(
      `/api/game-sessions/${sessionId}/guide-chat`,
      {
        method: 'POST',
        body: JSON.stringify({ question }),
      },
    );
  },

  summarize(sessionId: string) {
    return localRequest(`/api/game-sessions/${sessionId}/summary`, {
      method: 'POST',
    });
  },

  // Map interactions removed from active RPG UI.
};
