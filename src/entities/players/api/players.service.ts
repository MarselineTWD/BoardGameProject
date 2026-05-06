import { localRequest } from '../../../shared/api/http';
import {
  FriendRequestsState,
  LobbyState,
  NotificationsState,
  Player,
} from '../model/types';

export const playersService = {
  list() {
    return localRequest<Player[]>('/players');
  },
  searchByIdentifier(identifier: string) {
    return localRequest<Player>(
      `/players/search?identifier=${encodeURIComponent(identifier)}`,
    );
  },
  listFriendRequests() {
    return localRequest<FriendRequestsState>('/friend-requests');
  },
  sendFriendRequest(friendCode: string) {
    return localRequest<{ id: number }>('/friend-requests', {
      method: 'POST',
      body: JSON.stringify({ friendCode }),
    });
  },
  respondFriendRequest(id: number, status: 'accepted' | 'declined') {
    return localRequest<{ status: 'accepted' | 'declined' }>(
      `/friend-requests/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      },
    );
  },
};

export const lobbyService = {
  get() {
    return localRequest<LobbyState>('/lobby');
  },
  updateGame(gameSlug: string) {
    return localRequest<LobbyState>('/lobby', {
      method: 'PATCH',
      body: JSON.stringify({ gameSlug }),
    });
  },
  invitePlayer(playerId: number) {
    return localRequest<LobbyState>('/lobby/members', {
      method: 'POST',
      body: JSON.stringify({ playerId }),
    });
  },
  addGuest(name: string) {
    return localRequest<LobbyState>('/lobby/members', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
  removeMember(memberId: number) {
    return localRequest<void>(`/lobby/members/${memberId}`, {
      method: 'DELETE',
    });
  },
  updateMemberPlacement(memberId: number, placement: number | null) {
    return localRequest<LobbyState>(`/lobby/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ placement }),
    });
  },
};

export const notificationsService = {
  get() {
    return localRequest<NotificationsState>('/notifications');
  },
};
