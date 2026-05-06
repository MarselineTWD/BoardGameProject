import { useMemo, useState } from 'react';
import { useAsyncResource } from '../../../shared/lib/useAsyncResource';
import { lobbyService, playersService } from '../api/players.service';
import { FriendRequestsState, Player } from '../model/types';

const emptyFriendRequests: FriendRequestsState = {
  incoming: [],
  outgoing: [],
};

export function usePlayers() {
  const resource = useAsyncResource(async () => {
    const [players, friendRequests] = await Promise.all([
      playersService.list(),
      playersService.listFriendRequests().catch(() => emptyFriendRequests),
    ]);

    return { players, friendRequests };
  }, []);
  const [saving, setSaving] = useState(false);
  const [searchResult, setSearchResult] = useState<Player | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  const friends = useMemo(
    () => (resource.data?.players ?? []).filter((player) => player.isFriend),
    [resource.data],
  );

  const searchByIdentifier = async (identifier: string) => {
    setSaving(true);
    setSearchError(null);
    try {
      const player = await playersService.searchByIdentifier(identifier.trim());
      setSearchResult(player);
    } catch (error) {
      setSearchResult(null);
      setSearchError(
        error instanceof Error
          ? error.message
          : 'Игрок по идентификатору не найден',
      );
    } finally {
      setSaving(false);
    }
  };

  const sendFriendRequest = async (friendCode: string) => {
    setSaving(true);
    setOperationError(null);
    try {
      await playersService.sendFriendRequest(friendCode);
      setSearchResult((current) =>
        current?.friendCode === friendCode
          ? { ...current, friendshipStatus: 'outgoing' }
          : current,
      );
      resource.reload();
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : 'Не удалось отправить заявку',
      );
    } finally {
      setSaving(false);
    }
  };

  const respondFriendRequest = async (
    id: number,
    status: 'accepted' | 'declined',
  ) => {
    setSaving(true);
    setOperationError(null);
    try {
      await playersService.respondFriendRequest(id, status);
      resource.reload();
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : 'Не удалось обработать заявку',
      );
    } finally {
      setSaving(false);
    }
  };

  return {
    ...resource,
    players: resource.data?.players ?? [],
    friends,
    friendRequests: resource.data?.friendRequests ?? emptyFriendRequests,
    saving,
    searchResult,
    searchError,
    operationError,
    searchByIdentifier,
    sendFriendRequest,
    respondFriendRequest,
  };
}

export function useLobby() {
  const resource = useAsyncResource(() => lobbyService.get(), []);
  const [saving, setSaving] = useState(false);

  const invitePlayer = async (playerId: number) => {
    setSaving(true);
    try {
      await lobbyService.invitePlayer(playerId);
      resource.reload();
    } finally {
      setSaving(false);
    }
  };

  const addGuest = async (name: string) => {
    setSaving(true);
    try {
      await lobbyService.addGuest(name);
      resource.reload();
    } finally {
      setSaving(false);
    }
  };

  const updateGame = async (gameSlug: string) => {
    setSaving(true);
    try {
      await lobbyService.updateGame(gameSlug);
      resource.reload();
    } finally {
      setSaving(false);
    }
  };

  const updateMemberPlacement = async (
    memberId: number,
    placement: number | null,
  ) => {
    setSaving(true);
    try {
      await lobbyService.updateMemberPlacement(memberId, placement);
      resource.reload();
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (memberId: number) => {
    setSaving(true);
    try {
      await lobbyService.removeMember(memberId);
      resource.reload();
    } finally {
      setSaving(false);
    }
  };

  return {
    ...resource,
    lobby: resource.data?.lobby ?? null,
    members: resource.data?.members ?? [],
    availablePlayers: resource.data?.availablePlayers ?? [],
    saving,
    updateGame,
    invitePlayer,
    addGuest,
    updateMemberPlacement,
    removeMember,
  };
}
