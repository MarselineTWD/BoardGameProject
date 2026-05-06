export interface Review {
  id: number;
  lobbyId: number | null;
  gameSlug: string;
  gameName: string;
  title: string;
  rating: number;
  sessionMood: string;
  notes: string;
  wouldReplay: boolean;
  playedAt: string;
  playersCount: number;
}

export type ReviewPayload = Omit<Review, 'id' | 'lobbyId'> & {
  lobbyId?: number | null;
};
