export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'];

/** Rarity by value unless the admin set one explicitly. */
export function rarityOf(value, override) {
  if (override && RARITIES.includes(override)) return override;
  if (value >= 8000) return 'secret';
  if (value >= 2000) return 'mythic';
  if (value >= 600) return 'legendary';
  if (value >= 150) return 'epic';
  if (value >= 40) return 'rare';
  if (value >= 10) return 'uncommon';
  return 'common';
}
