import { create } from 'zustand';

export type ComplexityPreference = 'light' | 'medium' | 'heavy' | 'any';
export type FinderLimitPreference = number | 'any';

export interface FinderPreferencesState {
  players: FinderLimitPreference;
  maxDuration: FinderLimitPreference;
  complexity: ComplexityPreference;
  strategyFocus: number;
  interactionFocus: number;
  accessibilityNeed: number;
  themeSlug: string;
  setField: <
    Key extends keyof Omit<FinderPreferencesState, 'setField' | 'reset'>,
  >(
    key: Key,
    value: FinderPreferencesState[Key],
  ) => void;
  reset: () => void;
}

const initialState = {
  players: 'any' as FinderLimitPreference,
  maxDuration: 'any' as FinderLimitPreference,
  complexity: 'medium' as ComplexityPreference,
  strategyFocus: 65,
  interactionFocus: 55,
  accessibilityNeed: 60,
  themeSlug: 'any',
};

export const useFinderPreferencesStore = create<FinderPreferencesState>(
  (set) => ({
    ...initialState,
    setField: (key, value) => set(() => ({ [key]: value })),
    reset: () => set(initialState),
  }),
);
