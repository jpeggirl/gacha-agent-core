/**
 * One-time script to populate imageUrl in data/popular-cards.json
 * using the free pokemontcg.io API (no auth required).
 *
 * Usage: npx tsx src/scripts/populate-seed-images.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface SeedCard {
  id: string;
  name: string;
  setName: string;
  number: string;
  imageUrl?: string;
  [key: string]: unknown;
}

interface PokemonTcgCard {
  images?: { small?: string; large?: string };
}

interface PokemonTcgResponse {
  data?: PokemonTcgCard[];
}

async function fetchImageFromPokemonTcg(
  name: string,
  setName: string,
  number: string,
): Promise<string | null> {
  // Extract just the card number (before the /)
  const cardNum = number.split('/')[0]!;
  const query = `name:"${name}" set.name:"${setName}" number:"${cardNum}"`;
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=1`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  pokemontcg.io returned ${res.status}`);
    return null;
  }

  const body = (await res.json()) as PokemonTcgResponse;
  return body.data?.[0]?.images?.large ?? body.data?.[0]?.images?.small ?? null;
}

async function main() {
  const seedPath = join(process.cwd(), 'data', 'popular-cards.json');
  const raw = await readFile(seedPath, 'utf-8');
  const cards: SeedCard[] = JSON.parse(raw);

  console.log(`Fetching image URLs for ${cards.length} seed cards...\n`);

  let updated = 0;
  for (const card of cards) {
    if (card.imageUrl) {
      console.log(`  [skip] ${card.name} (already has imageUrl)`);
      continue;
    }

    const imageUrl = await fetchImageFromPokemonTcg(card.name, card.setName, card.number);
    if (imageUrl) {
      card.imageUrl = imageUrl;
      updated++;
      console.log(`  [ok]   ${card.name} (${card.setName}) -> ${imageUrl}`);
    } else {
      console.warn(`  [miss] ${card.name} (${card.setName} ${card.number}) — no image found`);
    }

    // Rate limit: pokemontcg.io allows 30 req/min without API key
    await new Promise((r) => setTimeout(r, 2500));
  }

  await writeFile(seedPath, JSON.stringify(cards, null, 2) + '\n');
  console.log(`\nDone. Updated ${updated}/${cards.length} cards.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
