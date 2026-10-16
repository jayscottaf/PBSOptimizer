export const recommendationGoals = {
  balanced: 'Balanced',
  qol: 'Quality of life',
  credit: 'Credit per day',
  efficiency: 'Credit / block efficiency',
} as const;
export type RecommendationGoal = keyof typeof recommendationGoals;
