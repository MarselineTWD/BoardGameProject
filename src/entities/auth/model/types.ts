import { PlayerSkillLevel } from '../../players/model/types';

export interface AuthUser {
  id: number;
  email: string;
  username: string;
  name: string;
  city: string;
  skillLevel: PlayerSkillLevel;
  rating: number;
  gamesPlayed: number;
  wins: number;
  avatarColor: string;
  friendCode: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {
  city?: string;
  skillLevel?: PlayerSkillLevel;
}
