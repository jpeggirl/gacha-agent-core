#!/usr/bin/env node

import 'dotenv/config';
import { CardResolver } from './card-resolver/resolver.js';
import { WatchlistManager } from './watchlist/manager.js';
import { JsonStorageAdapter } from './watchlist/storage-json.js';
import { PriceEngine } from './pricing/engine.js';
import { EbayScanner } from './scanner/ebay.js';
import { DealScorer } from './scanner/deal-scorer.js';
import { TelegramAlerts } from './alerts/telegram.js';
import { ScanScheduler } from './scheduler/scan-scheduler.js';
import type { GachaAgentConfig, ResolvedCard } from './types/index.js';
import { DEFAULT_SCHEDULER_CONFIG } from './types/index.js';

function loadConfig(): GachaAgentConfig {
  return {
    pokemonPriceTracker: {
      apiKey: env('POKEMON_PRICE_TRACKER_API_KEY'),
      baseUrl: env('POKEMON_PRICE_TRACKER_URL', 'https://www.pokemonpricetracker.com'),
    },
    ebay: process.env.EBAY_APP_ID
      ? {
          appId: env('EBAY_APP_ID'),
          certId: env('EBAY_CERT_ID'),
          sandbox: process.env.EBAY_SANDBOX === 'true',
        }
      : undefined,
    telegram: process.env.TELEGRAM_BOT_TOKEN
      ? {
          botToken: env('TELEGRAM_BOT_TOKEN'),
          defaultChatId: process.env.TELEGRAM_CHAT_ID,
        }
      : undefined,
    storage: {
      type: 'json',
      jsonPath: process.env.DATA_PATH ?? './data',
    },
    scheduler: {
      ...DEFAULT_SCHEDULER_CONFIG,
      scanIntervalMs: parseInt(
        process.env.SCAN_INTERVAL_MS ?? String(DEFAULT_SCHEDULER_CONFIG.scanIntervalMs),
        10,
      ),
      minDealScore: parseInt(
        process.env.MIN_DEAL_SCORE ?? String(DEFAULT_SCHEDULER_CONFIG.minDealScore),
        10,
      ),
    },
  };
}

function env(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help') {
    printHelp();
    return;
  }

  const config = loadConfig();
  const storage = new JsonStorageAdapter(config.storage.jsonPath ?? './data');
  const resolver = new CardResolver(config);
  const watchlist = new WatchlistManager(storage);
  const priceEngine = new PriceEngine(config);
  const dealScorer = new DealScorer();

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
        console.error('Usage: gacha price <card description> <grade>');
        process.exit(1);
      }
      console.log(`Looking up price: "${query}" PSA ${grade}...`);
      const result = await resolver.resolve(query);
      if (!result.success || !result.bestMatch) {
        console.log('Could not resolve card.');
        break;
      }
      printCard(result.bestMatch);
      const fmv = await priceEngine.getFMV(result.bestMatch, grade);
      console.log(`\nFair Market Value: $${fmv.fmv.toFixed(2)} (PSA ${grade})`);
      if (fmv.populationCount) {
        console.log(`PSA Population: ${fmv.populationCount}`);
      }
      console.log(`\nRecent sales:`);
      for (const p of fmv.prices.slice(0, 5)) {
        console.log(`  $${p.price.toFixed(2)} — ${p.source} (${p.date})`);
      }
      break;
    }

    case 'watch': {
      const priceIdx = args.findIndex((a) => a.startsWith('$'));
      if (priceIdx === -1) {
        console.error('Usage: gacha watch <card description> $<target_price>');
        process.exit(1);
      }
      const cardQuery = args.slice(0, priceIdx).join(' ');
      const targetPrice = parseFloat(args[priceIdx]!.replace('$', ''));
      const userId = process.env.USER_ID ?? 'default';

      console.log(`Resolving: "${cardQuery}"...`);
      const result = await resolver.resolve(cardQuery);
      if (!result.success || !result.bestMatch) {
        console.log('Could not resolve card.');
        break;
      }
      printCard(result.bestMatch);

      const entry = await watchlist.add({
        userId,
        card: result.bestMatch,
        targetPrice,
      });
      console.log(
        `\nAdded to watchlist! Target: $${targetPrice.toFixed(2)}`,
      );
      console.log(`Entry ID: ${entry.id}`);
      break;
    }

    case 'list': {
      const userId = process.env.USER_ID ?? 'default';
      const entries = await watchlist.listByUser(userId);
      if (entries.length === 0) {
        console.log('No watchlist entries.');
        break;
      }
      console.log(`\nWatchlist (${entries.length} entries):\n`);
      for (const entry of entries) {
        const status = entry.active ? '✓' : '✗';
        console.log(
          `  ${status} ${entry.card.name} — ${entry.card.setName} | Target: $${entry.targetPrice.toFixed(2)}`,
        );
        if (entry.lastScannedAt) {
          console.log(`    Last scanned: ${entry.lastScannedAt}`);
        }
      }
      break;
    }

    case 'scan': {
      if (!config.ebay) {
        console.error('eBay credentials required. Set EBAY_APP_ID and EBAY_CERT_ID.');
        process.exit(1);
      }
      const scanner = new EbayScanner(config);
      const userId = process.env.USER_ID ?? 'default';
      const entries = await watchlist.listByUser(userId);

      if (entries.length === 0) {
        console.log('No watchlist entries to scan.');
        break;
      }

      for (const entry of entries.filter((e) => e.active)) {
        const grade = (entry.metadata?.grade as number) ?? 9;
        console.log(`\nScanning: ${entry.card.name} PSA ${grade}...`);

        const scanResult = await scanner.scan(entry.card, grade);
        console.log(`Found ${scanResult.totalFound} listings`);

        if (scanResult.listings.length === 0) continue;

        try {
          const fmv = await priceEngine.getFMV(entry.card, grade);
          const scored = dealScorer.scoreMany(scanResult.listings, entry.card, fmv);

          console.log(`\nTop deals:`);
          for (const deal of scored.slice(0, 3)) {
            console.log(
              `  [${deal.score}] ${deal.signal.toUpperCase()} — $${deal.listing.totalPrice.toFixed(2)} (${deal.savingsPercent}% ${deal.savingsAmount > 0 ? 'below' : 'above'} FMV)`,
            );
            console.log(`    ${deal.reasoning}`);
            console.log(`    ${deal.listing.itemUrl}`);
          }
        } catch (e) {
          console.log(`  (Could not fetch FMV — showing raw listings)`);
          for (const listing of scanResult.listings.slice(0, 3)) {
            console.log(
              `  $${listing.totalPrice.toFixed(2)} — ${listing.title}`,
            );
            console.log(`    ${listing.itemUrl}`);
          }
        }
      }
      break;
    }

    case 'run': {
      if (!config.ebay) {
        console.error('eBay credentials required for scheduler.');
        process.exit(1);
      }
      if (!config.telegram) {
        console.error('Telegram credentials required for scheduler.');
        process.exit(1);
      }
      const scanner = new EbayScanner(config);
      const alerts = new TelegramAlerts(config);
      const scheduler = new ScanScheduler(
        config,
        watchlist,
        scanner,
        priceEngine,
        dealScorer,
        alerts,
      );

      console.log('Starting Gacha Agent scheduler...');
      scheduler.start();

      // Graceful shutdown
      const shutdown = () => {
        console.log('\nShutting down...');
        scheduler.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
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
  watch <description> $<price>    Add a card to your watchlist
  list                            Show your watchlist
  scan                            Scan eBay for deals on your watchlist
  run                             Start the 24/7 scan scheduler

Environment Variables:
  POKEMON_PRICE_TRACKER_API_KEY   Required — API key for PokemonPriceTracker
  POKEMON_PRICE_TRACKER_URL       Optional — API base URL
  EBAY_APP_ID                     Required for scan/run — eBay app ID
  EBAY_CERT_ID                    Required for scan/run — eBay cert ID
  EBAY_SANDBOX                    Optional — "true" for eBay sandbox
  TELEGRAM_BOT_TOKEN              Required for run — Telegram bot token
  TELEGRAM_CHAT_ID                Optional — default Telegram chat ID
  DATA_PATH                       Optional — path for data storage (default: ./data)
  USER_ID                         Optional — user ID (default: "default")
  SCAN_INTERVAL_MS                Optional — scan interval in ms (default: 900000)
  MIN_DEAL_SCORE                  Optional — minimum deal score for alerts (default: 60)
`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
