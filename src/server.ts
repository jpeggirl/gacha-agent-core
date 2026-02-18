import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { CardResolver } from './card-resolver/resolver.js';
import { WatchlistManager } from './watchlist/manager.js';
import { JsonStorageAdapter } from './watchlist/storage-json.js';
import { PriceEngine } from './pricing/engine.js';
import { EbayScanner } from './scanner/ebay.js';
import { DealScorer } from './scanner/deal-scorer.js';
import type { GachaAgentConfig, Agent, AgentHeartbeatState } from './types/index.js';
import { DEFAULT_SCHEDULER_CONFIG } from './types/index.js';

function env(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

function loadConfig(): GachaAgentConfig {
  return {
    pokemonPriceTracker: {
      apiKey: env('POKEMON_PRICE_TRACKER_API_KEY'),
      baseUrl: env('POKEMON_PRICE_TRACKER_URL', 'https://pokemonpricetracker.com'),
    },
    ebay: process.env.EBAY_APP_ID
      ? {
          appId: env('EBAY_APP_ID'),
          certId: env('EBAY_CERT_ID'),
          sandbox: process.env.EBAY_SANDBOX === 'true',
        }
      : undefined,
    storage: {
      type: 'json',
      jsonPath: process.env.DATA_PATH ?? './data',
    },
    scheduler: DEFAULT_SCHEDULER_CONFIG,
  };
}

// ─── Agent Management ───

const GACHA_ADMIN_KEY = process.env.GACHA_ADMIN_KEY ?? process.env.GACHA_API_KEY ?? 'gacha_dev_key';
const AGENTS_STORAGE_KEY = 'agents';
const HEARTBEAT_PREFIX = 'heartbeat:';

function generateApiKey(): string {
  return `gacha_${randomBytes(24).toString('hex')}`;
}

async function getAgents(storage: JsonStorageAdapter): Promise<Agent[]> {
  return (await storage.get<Agent[]>(AGENTS_STORAGE_KEY)) ?? [];
}

async function saveAgents(storage: JsonStorageAdapter, agents: Agent[]): Promise<void> {
  await storage.set(AGENTS_STORAGE_KEY, agents);
}

async function findAgentByKey(storage: JsonStorageAdapter, apiKey: string): Promise<Agent | null> {
  const agents = await getAgents(storage);
  return agents.find((a) => a.apiKey === apiKey) ?? null;
}

async function getHeartbeatState(
  storage: JsonStorageAdapter,
  agentId: string,
): Promise<AgentHeartbeatState> {
  const state = await storage.get<AgentHeartbeatState>(`${HEARTBEAT_PREFIX}${agentId}`);
  return (
    state ?? {
      agentId,
      activeAlerts: 0,
      errorCount: 0,
    }
  );
}

async function saveHeartbeatState(
  storage: JsonStorageAdapter,
  state: AgentHeartbeatState,
): Promise<void> {
  await storage.set(`${HEARTBEAT_PREFIX}${state.agentId}`, state);
}

// ─── Auth ───

interface AuthResult {
  authenticated: boolean;
  isAdmin: boolean;
  agent?: Agent;
}

async function authenticate(
  req: IncomingMessage,
  storage: JsonStorageAdapter,
): Promise<AuthResult> {
  const auth = req.headers['authorization'];
  if (!auth) return { authenticated: false, isAdmin: false };
  const token = auth.replace('Bearer ', '');

  // Check admin key
  if (token === GACHA_ADMIN_KEY) {
    return { authenticated: true, isAdmin: true };
  }

  // Check registered agents
  const agent = await findAgentByKey(storage, token);
  if (agent) {
    return { authenticated: true, isAdmin: false, agent };
  }

  return { authenticated: false, isAdmin: false };
}

// ─── Helpers ───

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function markdown(res: ServerResponse, content: string) {
  res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  res.end(content);
}

// ─── Skill File Serving ───

const SKILL_DIR = resolve(
  process.env.SKILL_DIR ?? join(process.cwd(), '../gacha-openclaw-skill'),
);

async function serveSkillFile(res: ServerResponse, filename: string): Promise<boolean> {
  try {
    const content = await readFile(join(SKILL_DIR, filename), 'utf-8');
    markdown(res, content);
    return true;
  } catch {
    json(res, 404, { error: `Skill file not found: ${filename}` });
    return false;
  }
}

// ─── Server ───

async function main() {
  const config = loadConfig();
  const storage = new JsonStorageAdapter(config.storage.jsonPath ?? './data');
  const resolver = new CardResolver(config);
  const watchlist = new WatchlistManager(storage);
  const priceEngine = new PriceEngine(config);
  const dealScorer = new DealScorer();
  let scanner: EbayScanner | null = null;
  if (config.ebay) {
    scanner = new EbayScanner(config);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // ─── Public Routes (no auth) ───

    // Health check
    if (path === '/health') {
      return json(res, 200, { status: 'ok' });
    }

    // Skill file serving — public, unauthenticated
    if (path === '/skill.md') {
      return serveSkillFile(res, 'SKILL.md');
    }
    if (path === '/register.md') {
      return serveSkillFile(res, 'register.md');
    }
    if (path === '/heartbeat.md') {
      return serveSkillFile(res, 'heartbeat.md');
    }

    // Agent registration — public (no auth required to register)
    if (method === 'POST' && path === '/api/agents/register') {
      try {
        const body = JSON.parse(await readBody(req)) as {
          name?: string;
          description?: string;
        };
        if (!body.name) {
          return json(res, 400, { error: 'Missing "name" field' });
        }

        const agent: Agent = {
          id: randomUUID(),
          name: body.name,
          description: body.description ?? '',
          apiKey: generateApiKey(),
          createdAt: new Date().toISOString(),
        };

        const agents = await getAgents(storage);
        agents.push(agent);
        await saveAgents(storage, agents);

        // Initialize heartbeat state
        await saveHeartbeatState(storage, {
          agentId: agent.id,
          activeAlerts: 0,
          errorCount: 0,
        });

        console.log(`[AGENT] Registered: ${agent.name} (${agent.id})`);

        return json(res, 201, {
          agent_id: agent.id,
          name: agent.name,
          api_key: agent.apiKey,
          created_at: agent.createdAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return json(res, 400, { error: message });
      }
    }

    // ─── Authenticated Routes ───

    const auth = await authenticate(req, storage);
    if (!auth.authenticated) {
      return json(res, 401, { error: 'Invalid or missing API key' });
    }

    // Update last seen
    if (auth.agent) {
      const agents = await getAgents(storage);
      const idx = agents.findIndex((a) => a.id === auth.agent!.id);
      if (idx !== -1) {
        agents[idx].lastSeenAt = new Date().toISOString();
        await saveAgents(storage, agents);
      }
    }

    const agentId = auth.agent?.id ?? 'admin';

    try {
      // GET /api/agents/me — agent profile
      if (method === 'GET' && path === '/api/agents/me') {
        if (!auth.agent) {
          return json(res, 200, {
            id: 'admin',
            name: 'Admin',
            description: 'Server operator using admin key',
            isAdmin: true,
          });
        }
        return json(res, 200, {
          id: auth.agent.id,
          name: auth.agent.name,
          description: auth.agent.description,
          created_at: auth.agent.createdAt,
          last_seen_at: auth.agent.lastSeenAt,
        });
      }

      // GET /api/heartbeat/state — agent's heartbeat state
      if (method === 'GET' && path === '/api/heartbeat/state') {
        const state = await getHeartbeatState(storage, agentId);
        return json(res, 200, state);
      }

      // POST /api/heartbeat/ping — agent alive ping
      if (method === 'POST' && path === '/api/heartbeat/ping') {
        const state = await getHeartbeatState(storage, agentId);
        state.lastPing = new Date().toISOString();
        await saveHeartbeatState(storage, state);
        return json(res, 200, {
          status: 'ok',
          lastPing: state.lastPing,
          activeAlerts: state.activeAlerts,
          errorCount: state.errorCount,
        });
      }

      // POST /api/resolve — card disambiguation
      if (method === 'POST' && path === '/api/resolve') {
        const body = JSON.parse(await readBody(req)) as { query: string };
        if (!body.query) {
          return json(res, 400, { error: 'Missing "query" field' });
        }
        const result = await resolver.resolve(body.query);
        return json(res, 200, result);
      }

      // POST /api/price — FMV lookup
      if (method === 'POST' && path === '/api/price') {
        const body = JSON.parse(await readBody(req)) as {
          query: string;
          grade?: number;
        };
        if (!body.query) {
          return json(res, 400, { error: 'Missing "query" field' });
        }
        const grade = body.grade ?? 9;
        const result = await resolver.resolve(body.query);
        if (!result.success || !result.bestMatch) {
          return json(res, 200, {
            resolved: false,
            candidates: result.candidates,
          });
        }
        const fmv = await priceEngine.getFMV(result.bestMatch, grade);
        return json(res, 200, { resolved: true, card: result.bestMatch, fmv });
      }

      // POST /api/watch — add to watchlist (uses agent_id as userId)
      if (method === 'POST' && path === '/api/watch') {
        const body = JSON.parse(await readBody(req)) as {
          query: string;
          targetPrice: number;
          userId?: string;
          grade?: number;
        };
        if (!body.query || !body.targetPrice) {
          return json(res, 400, {
            error: 'Missing "query" or "targetPrice"',
          });
        }
        const result = await resolver.resolve(body.query);
        if (!result.success || !result.bestMatch) {
          return json(res, 200, {
            resolved: false,
            candidates: result.candidates,
          });
        }
        const entry = await watchlist.add({
          userId: body.userId ?? agentId,
          card: result.bestMatch,
          targetPrice: body.targetPrice,
          alertChannels: ['telegram'],
        });
        if (body.grade) {
          await watchlist.update(entry.id, {});
        }
        return json(res, 200, { resolved: true, card: result.bestMatch, entry });
      }

      // GET /api/watchlist — list entries (scoped to agent)
      if (method === 'GET' && path === '/api/watchlist') {
        const userId = url.searchParams.get('userId') ?? agentId;
        const entries = await watchlist.listByUser(userId);
        return json(res, 200, { entries });
      }

      // DELETE /api/watchlist/:id
      if (method === 'DELETE' && path.startsWith('/api/watchlist/')) {
        const id = path.split('/').pop()!;
        const removed = await watchlist.remove(id);
        return json(res, 200, { removed });
      }

      // POST /api/scan — scan eBay for deals on a card
      if (method === 'POST' && path === '/api/scan') {
        if (!scanner) {
          return json(res, 503, {
            error: 'eBay scanning not configured',
          });
        }
        const body = JSON.parse(await readBody(req)) as {
          query: string;
          grade?: number;
        };
        if (!body.query) {
          return json(res, 400, { error: 'Missing "query" field' });
        }
        const grade = body.grade ?? 9;
        const result = await resolver.resolve(body.query);
        if (!result.success || !result.bestMatch) {
          return json(res, 200, {
            resolved: false,
            candidates: result.candidates,
          });
        }
        const scanResult = await scanner.scan(result.bestMatch, grade);
        let deals = scanResult.listings.map((l) => ({ listing: l }));

        // Try to score if pricing available
        try {
          const fmv = await priceEngine.getFMV(result.bestMatch, grade);
          deals = dealScorer
            .scoreMany(scanResult.listings, result.bestMatch, fmv)
            .map((d) => ({ ...d }));
        } catch {
          // Return unscored listings if FMV fails
        }

        // Update heartbeat state with scan time
        const state = await getHeartbeatState(storage, agentId);
        state.lastScan = new Date().toISOString();
        await saveHeartbeatState(storage, state);

        return json(res, 200, {
          resolved: true,
          card: result.bestMatch,
          totalFound: scanResult.totalFound,
          deals,
        });
      }

      return json(res, 404, { error: 'Not found' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[API] Error: ${message}`);
      return json(res, 500, { error: message });
    }
  });

  const port = parseInt(process.env.PORT ?? '3577', 10);
  server.listen(port, () => {
    console.log(`Gacha Agent API running on http://localhost:${port}`);
    console.log(`Public:  /skill.md, /register.md, /heartbeat.md`);
    console.log(`Auth:    /api/agents/register (public), /api/agents/me, /api/heartbeat/*`);
    console.log(`API:     /api/resolve, /api/price, /api/watch, /api/watchlist, /api/scan`);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
