export interface DiceSpec {
  count: number;
  sides: number;
  modifier: number;
}

const DICE_NOTATION = /^(\d+)d(\d+)([+-]\d+)?$/;

const specCache = new Map<string, DiceSpec>();

/** Parses RPG dice notation — "2d6", "1d8+4", "3d4-2". Throws on malformed notation so bad data surfaces at once. */
export function parseDice(notation: string): DiceSpec {
  const cached = specCache.get(notation);
  if (cached) return cached;

  const match = DICE_NOTATION.exec(notation.trim());
  if (!match) throw new Error(`Invalid dice notation: "${notation}"`);

  const spec: DiceSpec = {
    count: Number(match[1]),
    sides: Number(match[2]),
    modifier: match[3] ? Number(match[3]) : 0,
  };

  if (spec.count < 1 || spec.sides < 1) throw new Error(`Invalid dice notation: "${notation}"`);

  specCache.set(notation, spec);

  return spec;
}

export function rollDice(notation: string): number {
  const { count, sides, modifier } = parseDice(notation);
  let total = modifier;

  for (let die = 0; die < count; die++) {
    total += 1 + Math.floor(Math.random() * sides);
  }

  return Math.max(0, total);
}

/** Lowest and highest possible results, for tooltips and balance checks. */
export function diceRange(notation: string): [number, number] {
  const { count, sides, modifier } = parseDice(notation);

  return [count + modifier, count * sides + modifier];
}
