#!/usr/bin/env node

import 'dotenv/config';
import { CardResolver } from './card-resolver/resolver.js';
import { PriceEngine } from './pricing/engine.js';
import { loadConfig } from './config.js';
import type { ResolvedCard, Grader } from './types/index.js';

function parseGraderFlag(args: string[]): { grader: Grader; remaining: string[] } {
  const graderIdx = args.indexOf('--grader');
  if (graderIdx === -1) return { grader: 'PSA', remaining: args };
  const graderValue = args[graderIdx + 1]?.toUpperCase();
  const validGraders = new Set(['PSA', 'BGS', 'CGC', 'SGC']);
  const grader: Grader = validGraders.has(graderValue ?? '') ? (graderValue as Grader) : 'PSA';
  const remaining = [...args.slice(0, graderIdx), ...args.slice(graderIdx + 2)];
  return { grader, remaining };
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  const { grader, remaining: args } = parseGraderFlag(rawArgs);

  if (!command || command === 'help') {
    printHelp();
    return;
  }

  const config = loadConfig();
  const resolver = new CardResolver(config);
  const priceEngine = new PriceEngine(config);

  switch (command) {
    case 'resolve': {
      const query = args.join(' ');
      if (!query) {
        console.error('Usage: gacha resolve <card description>');
        process.exit(1);
      }
      console.log(`Resolving: "${query}"...`);
      const result = await resolver.resolve(query);

      if (result.success && result.bestMatch) {
        printCard(result.bestMatch);
      } else if (result.needsDisambiguation) {
        console.log('\nMultiple matches found — please be more specific:\n');
        for (const candidate of result.candidates.slice(0, 5)) {
          console.log(
            `  [${(candidate.confidence * 100).toFixed(0)}%] ${candidate.card.name} — ${candidate.card.setName} #${candidate.card.number} ${candidate.card.variant ?? ''}`,
          );
          console.log(`         ${candidate.matchReason}`);
        }
      } else {
        console.log('No matches found.');
      }
      break;
    }

    case 'price': {
      const query = args.slice(0, -1).join(' ');
      const grade = parseInt(args[args.length - 1] ?? '9', 10);
      if (!query) {
        console.error('Usage: gacha price <card description> <grade> [--grader PSA|BGS|CGC|SGC]');
        process.exit(1);
      }
      console.log(`Looking up price: "${query}" ${grader} ${grade}...`);
      const result = await resolver.resolve(query);
      if (!result.success || !result.bestMatch) {
        console.log('Could not resolve card.');
        break;
      }
      printCard(result.bestMatch);
      const fmv = await priceEngine.getFMV(result.bestMatch, grade, grader);
      if (!fmv) {
        console.log('\nCould not fetch pricing data.');
        break;
      }
      const approxNote = fmv.pricingSource?.includes('approximate') ? ' (approximate)' : '';
      console.log(`\nFair Market Value: $${fmv.fmv.toFixed(2)} (${grader} ${grade})${approxNote}`);
      if (fmv.populationCount) {
        console.log(`${grader} Population: ${fmv.populationCount}`);
      }
      console.log(`\nRecent sales:`);
      for (const p of fmv.prices.slice(0, 5)) {
        console.log(`  $${p.price.toFixed(2)} — ${p.source} (${p.date})`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printCard(card: ResolvedCard) {
  console.log(`\n  Card: ${card.name}`);
  console.log(`  Set:  ${card.setName} (#${card.number})`);
  console.log(`  Year: ${card.year}`);
  if (card.variant) console.log(`  Variant: ${card.variant}`);
  if (card.rarity) console.log(`  Rarity: ${card.rarity}`);
  console.log(`  Confidence: ${(card.confidence * 100).toFixed(0)}%`);
}

function printHelp() {
  console.log(`
Gacha Agent — Pokemon Card Deal Finder

Commands:
  resolve <description>           Resolve a card from natural language
  price <description> <grade>     Get fair market value for a graded card

Options:
  --grader PSA|BGS|CGC|SGC        Grading company (default: PSA)

Environment Variables:
  POKEMON_PRICE_TRACKER_API_KEY   Required — API key for PokemonPriceTracker
  POKEMON_PRICE_TRACKER_URL       Optional — API base URL
  PRICECHARTING_API_KEY           Required — PriceCharting API key
`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
