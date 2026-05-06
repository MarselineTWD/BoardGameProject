export type PlayerSkillLevel =
  | 'casual'
  | 'intermediate'
  | 'advanced'
  | 'expert';

export interface Player {
  id: number;
  username: string;
  name: string;
  city: string;
  skillLevel: PlayerSkillLevel;
  rating: number;
  gamesPlayed: number;
  wins: number;
  isFriend: boolean;
  isCurrentUser: boolean;
  friendshipStatus: 'self' | 'none' | 'outgoing' | 'incoming' | 'accepted';
  avatarColor: string;
  friendCode: string;
  createdAt: string;
}

export interface FriendRequestUser {
  id: number;
  name: string;
  username: string;
  friendCode: string;
  rating: number;
  avatarColor: string;
}

export interface FriendRequest {
  id: number;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  respondedAt: string | null;
  fromUser: FriendRequestUser;
  toUser: FriendRequestUser;
}

export interface FriendRequestsState {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export interface Lobby {
  id: number;
  name: string;
  status: 'draft' | 'ready' | 'closed';
  gameSlug: string | null;
  gameName: string | null;
  createdAt: string;
}

export interface LobbyMember {
  id: number;
  lobbyId: number;
  playerId: number | null;
  name: string;
  city: string;
  skillLevel: PlayerSkillLevel | 'guest';
  rating: number | null;
  isFriend: boolean;
  isGuest: boolean;
  avatarColor: string;
  seatOrder: number;
  placement: number | null;
}

export interface LobbyState {
  lobby: Lobby;
  members: LobbyMember[];
  availablePlayers: Player[];
}

export interface LobbyInvitationNotification {
  id: string;
  sessionId: string;
  sessionTitle: string;
  genre: string;
  tone: string;
  createdAt: string;
  updatedAt: string;
  fromUser: {
    id: number | null;
    name: string;
    username: string;
  };
}

export interface NotificationsState {
  friendRequests: FriendRequest[];
  lobbyInvitations: LobbyInvitationNotification[];
  unreadCount: number;
}
