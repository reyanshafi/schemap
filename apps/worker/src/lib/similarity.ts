// Dice-coefficient bigram similarity — the no-AI fallback for column mapping (docs/02 §7).

function bigrams(s: string): Map<string, number> {
  const grams = new Map<string, number>();
  const clean = s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

export function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) {
    return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  }
  let overlap = 0;
  let total = 0;
  for (const [gram, countA] of ga) {
    total += countA;
    const countB = gb.get(gram);
    if (countB) overlap += Math.min(countA, countB);
  }
  for (const count of gb.values()) total += count;
  return (2 * overlap) / total;
}
