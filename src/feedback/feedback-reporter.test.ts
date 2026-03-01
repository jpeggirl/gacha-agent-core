import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { FeedbackReporter } from './feedback-reporter.js';
import { InteractionLogger } from '../logging/interaction-logger.js';
import { TelegramAlerts } from '../alerts/telegram.js';
import { InMemoryStorage } from '../mocks/in-memory-storage.js';
import type { GachaAgentConfig, FeedbackEntry, InteractionLog } from '../types/index.js';

// ─── Config ───

const config: GachaAgentConfig = {
  pokemonPriceTracker: {
    apiKey: 'test-key',
    baseUrl: 'https://www.pokemonpricetracker.com',
  },
  telegram: {
    botToken: 'test-token-123',
    defaultChatId: '999',
  },
  developer: {
    chatId: '888',
  },
  storage: { type: 'json', jsonPath: '/tmp/test.json' },
  scheduler: {
    scanIntervalMs: 15 * 60 * 1000,
    ebayDailyLimit: 5000,
    pricingDailyLimit: 100,
    minDealScore: 60,
    maxConcurrentScans: 3,
  },
};

// Telegram handler that captures messages
function telegramHandler(captured: { messages: string[] }) {
  return http.post(
    /https:\/\/api\.telegram\.org\/bot.+\/sendMessage/,
    async ({ request }) => {
      const body = await request.json() as { text?: string };
      if (body.text) captured.messages.push(body.text);
      return HttpResponse.json({ ok: true, result: { message_id: 1 } });
    },
  );
}

// ─── Tests ───

describe('FeedbackReporter', () => {
  let storage: InMemoryStorage;
  let logger: InteractionLogger;
  let reporter: FeedbackReporter;
  let captured: { messages: string[] };

  beforeEach(() => {
    storage = new InMemoryStorage();
    logger = new InteractionLogger(storage, 'test-agent');
    reporter = new FeedbackReporter(storage, logger, config, 'test-agent');
    captured = { messages: [] };
    server.use(telegramHandler(captured));
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it('creates a FeedbackEntry with correct fields', async () => {
    const entry = await reporter.report("that doesn't sound right");

    expect(entry.id).toMatch(/^fb_/);
    expect(entry.agentId).toBe('test-agent');
    expect(entry.feedbackText).toBe("that doesn't sound right");
    expect(entry.timestamp).toBeTruthy();
    expect(entry.interactionId).toBeNull(); // no interaction logged yet
  });

  it('links feedback to the last interaction', async () => {
    const interaction = await logger.log('resolve', 'pikachu base set', { name: 'Pikachu' });
    const entry = await reporter.report("that's wrong");

    expect(entry.interactionId).toBe(interaction.id);
  });

  it('links feedback to a specific interactionId when provided', async () => {
    const int1 = await logger.log('resolve', 'query1', 'result1');
    await logger.log('price', 'query2', 'result2'); // this is now "last"

    const entry = await reporter.report("wrong card", int1.id);
    expect(entry.interactionId).toBe(int1.id);
  });

  it('persists feedback entry to storage', async () => {
    const entry = await reporter.report("bad result");

    const stored = await storage.get<FeedbackEntry>(`feedback:${entry.id}`);
    expect(stored).not.toBeNull();
    expect(stored!.feedbackText).toBe("bad result");
  });

  it('sends Telegram notification to developer chatId', async () => {
    await logger.log('resolve', 'pikachu base set', { name: 'Pikachu' });
    await reporter.report("that's wrong");

    expect(captured.messages).toHaveLength(1);
    const msg = captured.messages[0]!;
    expect(msg).toContain('USER FEEDBACK');
    expect(msg).toContain('test-agent');
    expect(msg).toContain("that's wrong");
    expect(msg).toContain('pikachu base set');
  });

  it('includes interaction output in Telegram message', async () => {
    await logger.log('price', { query: 'charizard', grade: 10 }, { fmv: 1850 });
    await reporter.report("incorrect price");

    expect(captured.messages).toHaveLength(1);
    const msg = captured.messages[0]!;
    expect(msg).toContain('1850');
    expect(msg).toContain('incorrect price');
  });

  it('works without Telegram configured (no crash)', async () => {
    const configNoTelegram: GachaAgentConfig = {
      ...config,
      telegram: undefined,
    };
    const reporterNoTg = new FeedbackReporter(storage, logger, configNoTelegram, 'test-agent');

    const entry = await reporterNoTg.report("bad result");
    expect(entry.id).toMatch(/^fb_/);
    // No Telegram call made
    expect(captured.messages).toHaveLength(0);
  });
});

describe('TelegramAlerts.formatFeedbackMessage', () => {
  let storage: InMemoryStorage;
  let alerts: TelegramAlerts;

  beforeEach(() => {
    storage = new InMemoryStorage();
    alerts = new TelegramAlerts(config, storage);
  });

  it('formats a feedback message with interaction context', () => {
    const interaction: InteractionLog = {
      id: 'int_abc123',
      agentId: 'openclaw',
      type: 'resolve',
      input: 'pikachu grey felt hat psa 10',
      output: { name: 'Pikachu with Grey Felt Hat', set: 'SVPen #085' },
      timestamp: '2026-02-20T10:30:00.000Z',
    };

    const feedback: FeedbackEntry = {
      id: 'fb_def456',
      interactionId: 'int_abc123',
      agentId: 'openclaw',
      feedbackText: "that doesn't sound right",
      timestamp: '2026-02-20T10:31:00.000Z',
    };

    const message = alerts.formatFeedbackMessage(feedback, interaction, 'openclaw');

    expect(message).toContain('USER FEEDBACK');
    expect(message).toContain('openclaw');
    expect(message).toContain('pikachu grey felt hat psa 10');
    expect(message).toContain("that doesn't sound right");
    expect(message).toContain('int_abc123');
  });

  it('formats a feedback message without interaction', () => {
    const feedback: FeedbackEntry = {
      id: 'fb_nointeraction',
      interactionId: null,
      agentId: 'agent-1',
      feedbackText: 'something is off',
      timestamp: '2026-02-20T12:00:00.000Z',
    };

    const message = alerts.formatFeedbackMessage(feedback, null, 'agent-1');

    expect(message).toContain('USER FEEDBACK');
    expect(message).toContain('agent-1');
    expect(message).toContain('something is off');
    expect(message).not.toContain('Query:');
    expect(message).toContain('none'); // interaction ID is "none"
  });

  it('escapes HTML in user input', () => {
    const interaction: InteractionLog = {
      id: 'int_html',
      agentId: 'agent-1',
      type: 'resolve',
      input: '<script>alert("xss")</script>',
      output: 'safe output',
      timestamp: '2026-02-20T12:00:00.000Z',
    };

    const feedback: FeedbackEntry = {
      id: 'fb_html',
      interactionId: 'int_html',
      agentId: 'agent-1',
      feedbackText: '<b>bold</b> feedback',
      timestamp: '2026-02-20T12:00:00.000Z',
    };

    const message = alerts.formatFeedbackMessage(feedback, interaction, 'agent-1');

    expect(message).not.toContain('<script>');
    expect(message).toContain('&lt;script&gt;');
    expect(message).toContain('&lt;b&gt;bold&lt;/b&gt; feedback');
  });
});
