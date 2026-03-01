import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, readFile, stat, writeFile, access, mkdir } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { CardResolver } from './card-resolver/resolver.js';
import { JsonStorageAdapter } from './storage/storage-json.js';
import { PriceEngine } from './pricing/engine.js';
import { EbayScanner } from './scanner/ebay.js';
import { DealScorer } from './scanner/deal-scorer.js';
import { EbayOverrideRegistry } from './scanner/ebay-overrides.js';
import { InventoryManager } from './inventory/manager.js';
import { WatchlistManager } from './watchlist/manager.js';
import { ChatAgent } from './agent/chat.js';
import { CascadingSearch } from './search/cascading-search.js';
import { CardRegistry } from './search/card-registry.js';
import { loadConfig } from './config.js';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, DealSignal, EbayListing, EbaySearchOverride, FairMarketValue, ListingReport, PopularCardSeed, RecentSearchEntry, ResolvedCard } from './types/index.js';

const GACHA_ADMIN_KEY = process.env.GACHA_ADMIN_KEY ?? process.env.GACHA_API_KEY ?? 'gacha_dev_key';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ─── Helpers ───

/** Strip search-engine noise ("Prices", "Price", "Value", etc.) before passing to eBay. */
function cleanForEbay(query: string): string {
  return query
    .replace(/\b(prices?|values?|worth)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function formatReportMarkdown(report: ListingReport): string {
  return [
    `## ${report.id}`,
    '',
    `- timestamp: ${report.timestamp}`,
    `- card: ${report.cardName} (grade ${report.grade})`,
    `- cardId: ${report.cardId}`,
    `- ebayItemId: ${report.ebayItemId}`,
    `- ebayTitle: ${report.ebayTitle}`,
    `- ebayUrl: ${report.ebayUrl}`,
    `- signal: ${report.reportedSignal}`,
    `- score: ${report.reportedScore}`,
    `- fmv: ${report.reportedFmv ?? 'n/a'}`,
    `- price: ${report.reportedPrice}`,
    `- reason: ${report.reason ?? 'n/a'}`,
    '',
  ].join('\n');
}

async function appendReportToMarkdown(filePath: string, report: ListingReport): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, '# Listing Reports\n\n', 'utf-8');
  }
  await appendFile(filePath, formatReportMarkdown(report), 'utf-8');
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

const RECENT_SEARCHES_KEY = 'recent_searches';
const MAX_RECENT_SEARCHES = 30;
const PPT_CONCURRENCY = 3; // Max concurrent PPT API calls to avoid rate limits

/** Run async tasks with bounded concurrency to avoid API rate limits. */
async function throttled<T>(items: T[], concurrency: number, fn: (item: T) => Promise<unknown>): Promise<PromiseSettledResult<unknown>[]> {
  const results: PromiseSettledResult<unknown>[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

interface TrendingCard {
  card: ResolvedCard;
  defaultGrade: number;
  fmv: number | null;
}

async function recordRecentSearch(
  storage: JsonStorageAdapter,
  card: ResolvedCard,
  query: string,
): Promise<void> {
  const existing = (await storage.get<RecentSearchEntry[]>(RECENT_SEARCHES_KEY)) ?? [];
  const entry: RecentSearchEntry = { card, query, timestamp: new Date().toISOString() };
  // Deduplicate by card.id (keep most recent)
  const filtered = existing.filter((e) => e.card.id !== card.id);
  const updated = [entry, ...filtered].slice(0, MAX_RECENT_SEARCHES);
  await storage.set(RECENT_SEARCHES_KEY, updated);
}

async function serveStatic(res: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return false;
    const content = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// ─── Server ───

async function main() {
  const config = loadConfig();
  const storage = new JsonStorageAdapter(config.storage.jsonPath ?? './data');
  const reportsMarkdownPath = join(config.storage.jsonPath ?? './data', 'listing-reports.md');
  const resolver = new CardResolver(config);
  const priceEngine = new PriceEngine(config);
  const dealScorer = new DealScorer();
  const inventoryManager = new InventoryManager(storage);

  let scanner: EbayScanner | null = null;
  if (config.ebay) {
    scanner = new EbayScanner(config);
  }

  const ebayOverrides = new EbayOverrideRegistry(storage);
  const cardRegistry = new CardRegistry(storage);
  const cascadingSearch = new CascadingSearch(inventoryManager, resolver, cardRegistry);
  const watchlistManager = new WatchlistManager(storage);

  let chatAgent: ChatAgent | null = null;
  if (config.gemini?.apiKey) {
    chatAgent = new ChatAgent({
      apiKey: config.gemini.apiKey,
      resolver,
      priceEngine,
      ebayScanner: scanner,
      dealScorer,
      inventoryManager,
    });
  }

  // Load popular cards seed data
  let popularCards: PopularCardSeed[] = [];
  try {
    const seedPath = join(process.cwd(), 'data', 'popular-cards.json');
    const raw = await readFile(seedPath, 'utf-8');
    popularCards = JSON.parse(raw) as PopularCardSeed[];
    console.log(`  Loaded ${popularCards.length} popular cards`);

    // Pre-warm search cache with popular cards
    const warmUpQueries = popularCards.map((c) => `${c.name} ${c.setName}`);
    cascadingSearch.warmUp(warmUpQueries).catch((err) =>
      console.warn('[Server] Cache warm-up failed:', err),
    );
  } catch (err) {
    console.warn('[Server] Could not load popular-cards.json:', err);
  }

  function cardFromParams(
    id: string,
    params: URLSearchParams,
  ): ResolvedCard {
    // Try popular cards first (has full data)
    const popular = popularCards.find((c) => c.id === id);
    if (popular) {
      return {
        id: popular.id,
        name: popular.name,
        setName: popular.setName,
        setCode: popular.setCode,
        number: popular.number,
        year: popular.year,
        rarity: popular.rarity,
        variant: popular.variant,
        imageUrl: popular.imageUrl,
        confidence: popular.confidence,
      };
    }
    // Fall back to query params — use || so empty strings become falsy defaults
    // that query builders naturally skip (e.g. if (card.number) { ... })
    return {
      id,
      name: params.get('name') || 'Unknown',
      setName: params.get('setName') || '',
      setCode: params.get('setCode') || '',
      number: params.get('number') || '',
      year: parseInt(params.get('year') || String(new Date().getFullYear()), 10),
      rarity: params.get('rarity') || undefined,
      variant: params.get('variant') || undefined,
      imageUrl: params.get('imageUrl') || undefined,
      confidence: 1.0,
    };
  }

  const publicDir = join(process.cwd(), 'public');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }

    // ─── API Routes ───

    // Health check
    if (path === '/health') {
      return json(res, 200, {
        status: 'ok',
        chat: chatAgent ? 'enabled' : 'disabled (no GEMINI_API_KEY)',
        ebay: scanner ? 'enabled' : 'disabled',
      });
    }

    // POST /api/chat — Main AI chat endpoint
    if (method === 'POST' && path === '/api/chat') {
      if (!chatAgent) {
        return json(res, 503, { error: 'Chat agent not configured. Set GEMINI_API_KEY.' });
      }

      try {
        const body = JSON.parse(await readBody(req)) as { messages?: ChatMessage[] };
        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
          return json(res, 400, { error: 'Missing or empty "messages" array' });
        }

        const response = await chatAgent.chat(body.messages);
        return json(res, 200, response);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[API /api/chat] Error: ${message}`);
        return json(res, 500, { error: message });
      }
    }

    // POST /api/admin/inventory/import — CSV import (admin key auth)
    if (method === 'POST' && path === '/api/admin/inventory/import') {
      const auth = req.headers['authorization'];
      const token = auth?.replace('Bearer ', '');
      if (token !== GACHA_ADMIN_KEY) {
        return json(res, 401, { error: 'Invalid admin key' });
      }

      try {
        const csvContent = await readBody(req);
        if (!csvContent.trim()) {
          return json(res, 400, { error: 'Empty CSV body' });
        }
        const result = await inventoryManager.importFromCSV(csvContent);
        return json(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // POST /api/admin/ebay-overrides — Create/update eBay search override
    if (method === 'POST' && path === '/api/admin/ebay-overrides') {
      const auth = req.headers['authorization'];
      const token = auth?.replace('Bearer ', '');
      if (token !== GACHA_ADMIN_KEY) {
        return json(res, 401, { error: 'Invalid admin key' });
      }
      try {
        const body = JSON.parse(await readBody(req)) as {
          cardId?: string;
          customQuery?: string;
          requiredKeywords?: string[];
          excludeKeywords?: string[];
          notes?: string;
        };
        if (!body.cardId || !body.notes) {
          return json(res, 400, { error: 'Missing required fields: cardId, notes' });
        }
        const override = await ebayOverrides.set({
          cardId: body.cardId,
          customQuery: body.customQuery,
          requiredKeywords: body.requiredKeywords,
          excludeKeywords: body.excludeKeywords,
          notes: body.notes,
        });
        return json(res, 201, override);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/admin/ebay-overrides — List all eBay search overrides
    if (method === 'GET' && path === '/api/admin/ebay-overrides') {
      const auth = req.headers['authorization'];
      const token = auth?.replace('Bearer ', '');
      if (token !== GACHA_ADMIN_KEY) {
        return json(res, 401, { error: 'Invalid admin key' });
      }
      try {
        const overrides = await ebayOverrides.getAll();
        return json(res, 200, { overrides, total: overrides.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // DELETE /api/admin/ebay-overrides/:cardId — Remove eBay search override
    const overrideDeleteMatch = path.match(/^\/api\/admin\/ebay-overrides\/([^/]+)$/);
    if (method === 'DELETE' && overrideDeleteMatch) {
      const auth = req.headers['authorization'];
      const token = auth?.replace('Bearer ', '');
      if (token !== GACHA_ADMIN_KEY) {
        return json(res, 401, { error: 'Invalid admin key' });
      }
      try {
        const cardId = decodeURIComponent(overrideDeleteMatch[1]!);
        const deleted = await ebayOverrides.delete(cardId);
        if (!deleted) {
          return json(res, 404, { error: 'Override not found' });
        }
        return json(res, 200, { deleted: true, cardId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/inventory — List all available inventory
    if (method === 'GET' && path === '/api/inventory') {
      try {
        const items = await inventoryManager.getAvailable();
        return json(res, 200, { items, total: items.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/popular — Recent searches only
    if (method === 'GET' && path === '/api/popular') {
      try {
        const recentSearches = (await storage.get<RecentSearchEntry[]>(RECENT_SEARCHES_KEY)) ?? [];
        const defaultGrade = 10;

        const recentResults = await throttled(
          recentSearches.slice(0, MAX_RECENT_SEARCHES),
          PPT_CONCURRENCY,
          async (entry) => {
            let fmv: number | null = null;
            try {
              const result = await priceEngine.getFMV(entry.card, defaultGrade, 'PSA');
              fmv = result?.fmv ?? null;
            } catch {
              // FMV fetch failed — still show the card
            }
            return { card: entry.card, defaultGrade, fmv };
          },
        );
        const cards = recentResults
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<TrendingCard>).value);

        return json(res, 200, { cards });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/search?q=<query> — Card search
    if (method === 'GET' && path === '/api/search') {
      const query = url.searchParams.get('q');
      if (!query) {
        return json(res, 400, { error: 'Missing "q" query parameter' });
      }
      try {
        const result = await cascadingSearch.search(query);
        const response: {
          query: string;
          results: typeof result.candidates;
          bestMatch: ResolvedCard | null;
          needsDisambiguation: boolean;
          ebayListings?: EbayListing[];
        } = {
          query,
          results: result.candidates.slice(0, 12),
          bestMatch: result.bestMatch ?? null,
          needsDisambiguation: result.needsDisambiguation,
        };

        // eBay fallback: when no card results found, search eBay directly
        if (result.candidates.length === 0 && scanner) {
          try {
            const ebayQuery = cleanForEbay(query);
            const ebayListings = await scanner.searchByQuery(ebayQuery);
            response.ebayListings = ebayListings.slice(0, 8);
          } catch (err) {
            console.warn('[Server] eBay fallback search failed:', err);
          }
        }

        json(res, 200, response);

        // Fire-and-forget: record recent search (bestMatch or top candidate)
        const cardToRecord = result.bestMatch ?? result.candidates[0]?.card;
        if (cardToRecord) {
          recordRecentSearch(storage, cardToRecord, query).catch((err) =>
            console.warn('[Server] Failed to record recent search:', err),
          );
        }
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/search/ebay?q=<query> — Direct eBay search (for fallback when card results miss)
    if (method === 'GET' && path === '/api/search/ebay') {
      const query = url.searchParams.get('q');
      if (!query) {
        return json(res, 400, { error: 'Missing "q" query parameter' });
      }
      if (!scanner) {
        return json(res, 503, { error: 'eBay scanner not configured. Set EBAY_APP_ID and EBAY_CERT_ID.' });
      }
      try {
        const ebayQuery = cleanForEbay(query);
        const ebayListings = await scanner.searchByQuery(ebayQuery);
        return json(res, 200, { query, listings: ebayListings.slice(0, 12) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/cards/:id/pricing?grade=10&name=...&setName=...&number=...
    const pricingMatch = path.match(/^\/api\/cards\/([^/]+)\/pricing$/);
    if (method === 'GET' && pricingMatch) {
      const cardId = decodeURIComponent(pricingMatch[1]!);
      const grade = parseInt(url.searchParams.get('grade') ?? '10', 10);
      try {
        const card = cardFromParams(cardId, url.searchParams);

        // Fire-and-forget: record card detail view as recent search
        recordRecentSearch(storage, card, card.name).catch((err) =>
          console.warn('[Server] Failed to record recent search:', err),
        );

        const multiSource = await priceEngine.getMultiSourcePricing(card, grade, 'PSA');
        return json(res, 200, {
          card: multiSource.card,
          grade: multiSource.grade,
          grader: multiSource.grader,
          fmv: multiSource.fmv,
          allGrades: multiSource.allGrades,
          sources: multiSource.sources,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/cards/:id/deals?grade=10&name=...&setName=...&number=...
    const dealsMatch = path.match(/^\/api\/cards\/([^/]+)\/deals$/);
    if (method === 'GET' && dealsMatch) {
      if (!scanner) {
        return json(res, 503, { error: 'eBay scanner not configured. Set EBAY_APP_ID and EBAY_CERT_ID.' });
      }
      const cardId = decodeURIComponent(dealsMatch[1]!);
      const grade = parseInt(url.searchParams.get('grade') ?? '10', 10);
      try {
        const card = cardFromParams(cardId, url.searchParams);
        const override = await ebayOverrides.get(cardId);
        // scan() for BIN/BestOffer deals, scanAuctions() for auctions (separate query strategy)
        const [scanResult, auctionListings, multiSource] = await Promise.all([
          scanner.scan(card, grade, 'PSA', override ?? undefined),
          scanner.scanAuctions(card, grade, 'PSA', override ?? undefined),
          priceEngine.getMultiSourcePricing(card, grade, 'PSA'),
        ]);
        let deals: unknown[] = [];
        let totalListingsFound = scanResult.totalFound;

        const binListings = scanResult.listings.filter((l) => l.listingType !== 'Auction');

        if (multiSource.fmv != null) {
          const fmv: FairMarketValue = {
            cardId: card.id,
            grade,
            grader: 'PSA',
            fmv: multiSource.fmv,
            currency: 'USD',
            prices: [],
            lastUpdated: new Date().toISOString(),
            pricingSource: 'multi-source',
          };
          const scored = dealScorer.scoreMany(binListings, card, fmv);
          deals = scored.slice(0, 5);
        }
        // Phase 2.1: Score auctions against FMV (same as BIN deals)
        let scoredAuctions: unknown[];
        if (multiSource.fmv != null) {
          const fmvForAuctions: FairMarketValue = {
            cardId: card.id,
            grade,
            grader: 'PSA',
            fmv: multiSource.fmv,
            currency: 'USD',
            prices: [],
            lastUpdated: new Date().toISOString(),
            pricingSource: 'multi-source',
          };
          scoredAuctions = dealScorer.scoreMany(auctionListings, card, fmvForAuctions).slice(0, 10);
        } else {
          scoredAuctions = auctionListings.slice(0, 10);
        }

        return json(res, 200, {
          card,
          grade,
          grader: 'PSA',
          fmv: multiSource.fmv,
          deals,
          auctions: scoredAuctions,
          totalListingsFound,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // POST /api/cards/register — Register a user-discovered card from eBay fallback
    if (method === 'POST' && path === '/api/cards/register') {
      try {
        const body = JSON.parse(await readBody(req)) as {
          name?: string;
          imageUrl?: string;
          ebayItemId?: string;
          query?: string;
        };
        if (!body.name || !body.ebayItemId || !body.query) {
          return json(res, 400, { error: 'Missing required fields: name, ebayItemId, query' });
        }
        const entry = await cardRegistry.register({
          name: body.name,
          imageUrl: body.imageUrl,
          ebayItemId: body.ebayItemId,
          query: body.query,
        });
        cascadingSearch.invalidateQuery(body.query);
        return json(res, 201, { registered: entry.card.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // POST /api/watchlist — Add card to watchlist
    if (method === 'POST' && path === '/api/watchlist') {
      try {
        const body = JSON.parse(await readBody(req)) as {
          email?: string;
          cardId?: string;
          grade?: number;
          cardName?: string;
          setName?: string;
          imageUrl?: string;
        };
        if (!body.email || !body.cardId || !body.grade || !body.cardName) {
          return json(res, 400, { error: 'Missing required fields: email, cardId, grade, cardName' });
        }
        // Basic email validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
          return json(res, 400, { error: 'Invalid email format' });
        }
        const entry = await watchlistManager.add({
          email: body.email,
          cardId: body.cardId,
          grade: body.grade,
          cardName: body.cardName,
          setName: body.setName,
          imageUrl: body.imageUrl,
        });
        return json(res, 201, entry);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/watchlist?email=<email> — Get watchlist entries
    if (method === 'GET' && path === '/api/watchlist') {
      const email = url.searchParams.get('email');
      if (!email) {
        return json(res, 400, { error: 'Missing "email" query parameter' });
      }
      try {
        const entries = await watchlistManager.getByEmail(email);
        return json(res, 200, { entries, total: entries.length });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // POST /api/reports — Report a wrong listing
    if (method === 'POST' && path === '/api/reports') {
      try {
        const body = JSON.parse(await readBody(req)) as {
          ebayItemId?: string;
          ebayTitle?: string;
          ebayUrl?: string;
          cardId?: string;
          cardName?: string;
          grade?: number;
          signal?: DealSignal;
          score?: number;
          fmv?: number | null;
          price?: number;
          reason?: string;
          setName?: string;
          setCode?: string;
          number?: string;
          year?: number;
          variant?: string;
        };
        if (!body.ebayItemId || !body.ebayTitle || !body.ebayUrl || !body.cardId || !body.cardName || body.grade == null || !body.signal || body.score == null || body.price == null) {
          return json(res, 400, { error: 'Missing required fields: ebayItemId, ebayTitle, ebayUrl, cardId, cardName, grade, signal, score, price' });
        }
        const id = 'rpt_' + randomUUID().replace(/-/g, '').slice(0, 12);
        const report: ListingReport = {
          id,
          ebayItemId: body.ebayItemId,
          ebayTitle: body.ebayTitle,
          ebayUrl: body.ebayUrl,
          cardId: body.cardId,
          cardName: body.cardName,
          grade: body.grade,
          reportedSignal: body.signal,
          reportedScore: body.score,
          reportedFmv: body.fmv ?? null,
          reportedPrice: body.price,
          reason: body.reason,
          timestamp: new Date().toISOString(),
        };

        // Store to markdown (existing) and JSON (new — queryable)
        await appendReportToMarkdown(reportsMarkdownPath, report);
        await ebayOverrides.storeReport(report);

        // Analyze report and auto-generate override if needed
        const card = cardFromParams(body.cardId, new URLSearchParams({
          name: body.cardName,
          setName: body.setName ?? '',
          setCode: body.setCode ?? '',
          number: body.number ?? '',
          year: String(body.year ?? new Date().getFullYear()),
          variant: body.variant ?? '',
        }));
        const autoOverride = await ebayOverrides.suggestFromReport(card, report);
        if (autoOverride) {
          console.log(`[Server] Auto-override created for card ${body.cardId}: ${autoOverride.notes}`);
        }

        return json(res, 201, { id, autoOverride: autoOverride ?? undefined });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // GET /api/admin/reports/:cardId — Reports for a specific card
    const reportsMatch = path.match(/^\/api\/admin\/reports\/([^/]+)$/);
    if (method === 'GET' && reportsMatch) {
      const auth = req.headers['authorization'];
      const token = auth?.replace('Bearer ', '');
      if (token !== GACHA_ADMIN_KEY) {
        return json(res, 401, { error: 'Invalid admin key' });
      }
      try {
        const cardId = decodeURIComponent(reportsMatch[1]!);
        const reports = await ebayOverrides.getReports(cardId);
        const override = await ebayOverrides.get(cardId);
        return json(res, 200, { cardId, reports, total: reports.length, override: override ?? undefined });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 500, { error: message });
      }
    }

    // ─── Static File Serving ───

    if (method === 'GET') {
      // Try exact file path
      const filePath = path === '/' ? join(publicDir, 'index.html') : join(publicDir, path);

      // Prevent directory traversal
      if (!filePath.startsWith(publicDir)) {
        return json(res, 403, { error: 'Forbidden' });
      }

      const served = await serveStatic(res, filePath);
      if (served) return;

      // SPA fallback — serve index.html for non-API routes
      const indexServed = await serveStatic(res, join(publicDir, 'index.html'));
      if (indexServed) return;
    }

    return json(res, 404, { error: 'Not found' });
  });

  const port = parseInt(process.env.PORT ?? '3577', 10);
  server.listen(port, () => {
    console.log(`Gacha running on http://localhost:${port}`);
    console.log(`  Popular:   GET /api/popular (recent searches)`);
    console.log(`  Search:    GET /api/search?q=...`);
    console.log(`  Pricing:   GET /api/cards/:id/pricing?grade=10`);
    console.log(`  Deals:     GET /api/cards/:id/deals?grade=10 ${scanner ? '(ready)' : '(disabled — no eBay creds)'}`);
    console.log(`  Register:  POST /api/cards/register`);
    console.log(`  Watchlist: GET/POST /api/watchlist`);
    console.log(`  Reports:   POST /api/reports`);
    console.log(`  Reports:   GET /api/admin/reports/:cardId (admin)`);
    console.log(`  Chat:      POST /api/chat ${chatAgent ? '(ready)' : '(disabled — no GEMINI_API_KEY)'}`);
    console.log(`  Inventory: GET /api/inventory`);
    console.log(`  Overrides: GET/POST/DELETE /api/admin/ebay-overrides (admin)`);
    console.log(`  Health:    GET /health`);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
