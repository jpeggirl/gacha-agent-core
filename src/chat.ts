#!/usr/bin/env node

import 'dotenv/config';
import * as readline from 'node:readline';
import { CardResolver } from './card-resolver/resolver.js';
import { JsonStorageAdapter } from './storage/storage-json.js';
import { PriceEngine } from './pricing/engine.js';
import { EbayScanner } from './scanner/ebay.js';
import { DealScorer } from './scanner/deal-scorer.js';
import { InteractionLogger } from './logging/interaction-logger.js';
import { FeedbackReporter } from './feedback/feedback-reporter.js';
import { loadConfig } from './config.js';
import type {
  GachaAgentConfig,
  ResolvedCard,
  CardCandidate,
  FairMarketValue,
  Grader,
} from './types/index.js';

// ─── Session state ───

interface Session {
  card: ResolvedCard | null;
  pendingCandidates: CardCandidate[] | null;
  grade: number;
  grader: Grader;
  fmv: FairMarketValue | null;
}

const session: Session = { card: null, pendingCandidates: null, grade: 10, grader: 'PSA', fmv: null };

// ─── Intent detection ───

type Intent =
  | { type: 'price'; grade: number; grader: Grader }
  | { type: 'find'; query: string; grade: number; grader: Grader }
  | { type: 'resolve'; query: string }
  | { type: 'feedback'; text: string }
  | { type: 'select'; index: number }
  | { type: 'help' }
  | { type: 'quit' };

function detectIntent(input: string): Intent {
  const lower = input.toLowerCase().trim();

  if (/^(quit|exit|bye|q)$/i.test(lower)) {
    return { type: 'quit' };
  }

  if (/^(help|\?)$/i.test(lower)) {
    return { type: 'help' };
  }

  // Disambiguation selection — bare number while candidates are pending
  if (session.pendingCandidates) {
    const numMatch = lower.match(/^(\d+)$/);
    if (numMatch) {
      const index = parseInt(numMatch[1]!, 10);
      if (index >= 1 && index <= session.pendingCandidates.length) {
        return { type: 'select', index };
      }
    }
  }

  // Feedback — user flagging a bad result
  if (/\b(that's wrong|that is wrong|doesn't sound right|does not sound right|incorrect|not right|bad result|wrong result|that's incorrect|not correct|flag this)\b/.test(lower)) {
    return { type: 'feedback', text: input.trim() };
  }

  // Price lookup
  if (/\b(how much|price|value|worth|fmv|market)\b/.test(lower)) {
    const { grader, grade } = extractGradeInfo(lower);
    return { type: 'price', grade, grader };
  }

  // Find — resolve + search eBay
  const findMatch = lower.match(/\bfind\s+(?:me\s+)?(?:a\s+)?(.+)/i);
  if (findMatch) {
    const query = findMatch[1]!.trim();
    const { grader, grade } = extractGradeInfo(lower);
    return { type: 'find', query, grade, grader };
  }

  // Default — treat as card description to resolve
  return { type: 'resolve', query: input.trim() };
}

function extractGradeInfo(text: string): { grader: Grader; grade: number } {
  // Match "PSA 10", "BGS 9.5", "CGC 10", "SGC 9" etc.
  const graderMatch = text.match(/\b(psa|bgs|cgc|sgc)\s*(\d{1,2}(?:\.\d)?)\b/i);
  if (graderMatch) {
    const grader = graderMatch[1]!.toUpperCase() as Grader;
    const grade = parseFloat(graderMatch[2]!);
    return { grader, grade };
  }
  // Check for bare "grade X" or just keep session defaults
  const gradeMatch = text.match(/\bgrade\s*(\d{1,2}(?:\.\d)?)\b/i);
  if (gradeMatch) return { grader: session.grader, grade: parseFloat(gradeMatch[1]!) };
  return { grader: session.grader, grade: session.grade };
}

// ─── Handlers ───

async function handleResolve(
  query: string,
  resolver: CardResolver,
): Promise<void> {
  console.log(`\n  Resolving "${query}"...`);
  const result = await resolver.resolve(query);

  if (result.success && result.bestMatch) {
    session.card = result.bestMatch;
    session.pendingCandidates = null;
    session.fmv = null;
    printCard(result.bestMatch);
    console.log(
      '\n  Tip: "how much psa 10?" / "find deals"',
    );
  } else if (result.needsDisambiguation) {
    const candidates = result.candidates.slice(0, 5);
    console.log(
      `\n  ${result.disambiguationReason ?? 'Multiple matches'} — did you mean:\n`,
    );
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      console.log(
        `    ${i + 1}. ${c.card.name} — ${c.card.setName} #${c.card.number} (${(c.confidence * 100).toFixed(0)}%)`,
      );
    }
    session.pendingCandidates = candidates;
    console.log(`\n  Type a number (1-${candidates.length}) to select, or describe another card.`);
  } else {
    session.pendingCandidates = null;
    console.log(`\n  No matches found for "${query}".`);
  }
}

async function handlePrice(
  grade: number,
  grader: Grader,
  resolver: CardResolver,
  priceEngine: PriceEngine,
  input: string,
): Promise<void> {
  // If no card in session, try to extract a card description from the input
  if (!session.card) {
    const cleaned = input
      .replace(/\b(how much|price|value|worth|fmv|market|is|it|the|(psa|bgs|cgc|sgc)\s*[\d.]+|grade\s*\d+)\b/gi, '')
      .trim();
    if (cleaned.length > 2) {
      await handleResolve(cleaned, resolver);
    }
    if (!session.card) {
      console.log('\n  No card selected. Describe a card first.');
      return;
    }
  }

  session.grade = grade;
  session.grader = grader;
  console.log(
    `\n  Looking up ${session.card.name} ${grader} ${grade}...`,
  );
  const fmv = await priceEngine.getFMV(session.card, grade, grader);
  if (!fmv) {
    console.log('  Could not fetch pricing data.');
    return;
  }

  session.fmv = fmv;
  const approxNote = fmv.pricingSource?.includes('approximate') ? ' (approximate)' : '';
  console.log(`\n  Fair Market Value: $${fmv.fmv.toFixed(2)} (${grader} ${grade})${approxNote}`);
  if (fmv.populationCount) {
    console.log(`  ${grader} Population: ${fmv.populationCount.toLocaleString()}`);
  }
  if (fmv.prices.length > 0) {
    console.log(`\n  Recent sales:`);
    for (const p of fmv.prices.slice(0, 5)) {
      console.log(`    $${p.price.toFixed(2)} — ${p.source} (${p.date})`);
    }
  }
}

async function handleFind(
  query: string,
  grade: number,
  grader: Grader,
  config: GachaAgentConfig,
  resolver: CardResolver,
  priceEngine: PriceEngine,
  dealScorer: DealScorer,
): Promise<void> {
  // Resolve first
  await handleResolve(query, resolver);
  if (!session.card) return;

  session.grade = grade;
  session.grader = grader;

  if (!config.ebay) {
    console.log('\n  eBay not configured — can only resolve, not search.');
    return;
  }

  // Search eBay immediately
  const scanner = new EbayScanner(config);
  console.log(`\n  Searching eBay for ${session.card.name} ${grader} ${grade}...`);
  const scanResult = await scanner.scan(session.card, grade, grader);
  if (scanResult.error) {
    console.log(`  Scan error: ${scanResult.error}`);
    return;
  }
  console.log(`  Found ${scanResult.totalFound} listings`);

  if (scanResult.listings.length === 0) return;

  const fmv = await priceEngine.getFMV(session.card, grade, grader);
  // Split BIN/BestOffer vs Auction listings
  const binListings = scanResult.listings.filter((l) => l.listingType !== 'Auction');
  const auctionListings = scanResult.listings
    .filter((l) => l.listingType === 'Auction')
    .sort((a, b) => {
      if (!a.endDate) return 1;
      if (!b.endDate) return -1;
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    });

  if (fmv) {
    session.fmv = fmv;
    const scored = dealScorer.scoreMany(
      binListings,
      session.card,
      fmv,
    );
    console.log(`\n  Top deals:`);
    for (const deal of scored.slice(0, 5)) {
      const dir = deal.savingsAmount > 0 ? 'below' : 'above';
      console.log(
        `    [${deal.score}] ${deal.signal.toUpperCase()} — $${deal.listing.totalPrice.toFixed(2)} (${Math.abs(deal.savingsPercent)}% ${dir} FMV)`,
      );
      console.log(`      ${deal.listing.itemUrl}`);
    }
  } else {
    console.log('\n  Listings (no FMV available):');
    for (const listing of binListings.slice(0, 5)) {
      console.log(
        `    $${listing.totalPrice.toFixed(2)} — ${listing.title}`,
      );
      console.log(`      ${listing.itemUrl}`);
    }
  }

  // Show auction listings
  if (auctionListings.length > 0) {
    console.log(`\n  Auctions ending soon:`);
    for (const auction of auctionListings.slice(0, 3)) {
      const timeLeft = auction.endDate ? formatTimeRemaining(auction.endDate) : 'unknown';
      const bids = auction.bidCount != null ? `${auction.bidCount} bids` : '';
      console.log(
        `    $${auction.totalPrice.toFixed(2)} — ${timeLeft}${bids ? ' · ' + bids : ''} — ${auction.sellerUsername} (${auction.sellerFeedbackPercent}%)`,
      );
      console.log(`      ${auction.itemUrl}`);
    }
  }
}

// ─── Time helpers ───

function formatTimeRemaining(endDate: string): string {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return 'ended';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ─── Display helpers ───

function printCard(card: ResolvedCard): void {
  console.log(`\n  Card: ${card.name}`);
  console.log(`  Set:  ${card.setName} (#${card.number})`);
  console.log(`  Year: ${card.year}`);
  if (card.variant) console.log(`  Variant: ${card.variant}`);
  if (card.rarity) console.log(`  Rarity: ${card.rarity}`);
  console.log(`  Confidence: ${(card.confidence * 100).toFixed(0)}%`);
}

function printHelp(): void {
  console.log(`
  Just type naturally. Examples:

    pikachu ex 238 surging sparks     Resolve a card
    1, 2, 3...                        Pick a card from disambiguation list
    how much is it psa 10?            Price lookup (uses last card)
    how much bgs 9.5?                 Price lookup with BGS grader
    find me a charizard vmax          Resolve + search eBay
    that's wrong / not right           Flag last result for developer review

  Graders: PSA, BGS, CGC, SGC (default: PSA). Just prefix grade with grader name.
  The chat remembers your last card and grader.
  Type "quit" to exit.
`);
}

// ─── Main REPL ───

async function main(): Promise<void> {
  const config = loadConfig();
  const storage = new JsonStorageAdapter(config.storage.jsonPath ?? './data');
  const resolver = new CardResolver(config);
  const priceEngine = new PriceEngine(config);
  const dealScorer = new DealScorer();
  const interactionLogger = new InteractionLogger(storage, 'chat-repl');
  const feedbackReporter = new FeedbackReporter(storage, interactionLogger, config, 'chat-repl');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nYou: ',
  });

  console.log('\n  Gacha Agent — Chat Mode');
  console.log('  Type naturally. Say "help" for examples, "quit" to exit.');

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    const intent = detectIntent(input);

    try {
      switch (intent.type) {
        case 'quit':
          console.log('\n  See you later!\n');
          rl.close();
          process.exit(0);
          break;

        case 'help':
          printHelp();
          break;

        case 'select': {
          const candidate = session.pendingCandidates![intent.index - 1]!;
          session.card = candidate.card;
          session.pendingCandidates = null;
          session.fmv = null;
          printCard(candidate.card);
          await interactionLogger.log('resolve', `select #${intent.index}`, candidate.card);
          break;
        }

        case 'resolve':
          await handleResolve(intent.query, resolver);
          await interactionLogger.log('resolve', intent.query, session.card ?? 'no match');
          break;

        case 'price':
          await handlePrice(intent.grade, intent.grader, resolver, priceEngine, input);
          await interactionLogger.log('price', { query: input, grade: intent.grade, grader: intent.grader }, session.fmv ?? 'no pricing');
          break;

        case 'find':
          await handleFind(
            intent.query,
            intent.grade,
            intent.grader,
            config,
            resolver,
            priceEngine,
            dealScorer,
          );
          await interactionLogger.log('find', { query: intent.query, grade: intent.grade, grader: intent.grader }, session.card ?? 'no match');
          break;

        case 'feedback': {
          const fb = await feedbackReporter.report(intent.text);
          if (fb.interactionId) {
            console.log(`\n  Thanks, flagged for review. (ref: ${fb.interactionId})`);
          } else {
            console.log(`\n  Thanks, flagged for review.`);
          }
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  Error: ${msg}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
