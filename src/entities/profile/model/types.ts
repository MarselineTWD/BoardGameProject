export interface UserProfile {
  id: number;
  name: string;
  city: string;
  experienceLevel: 'beginner' | 'intermediate' | 'advanced';
  preferredPlayers: number;
  maxPlayTime: number;
  bio: string;
  favoriteGenres: string[];
}
