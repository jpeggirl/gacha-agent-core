import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { TelegramAlerts } from './telegram.js';
import { InMemoryStorage } from '../mocks/in-memory-storage.js';
import type { ScoredDeal, GachaAgentConfig, ResolvedCard, FairMarketValue, CardCandidate } from '../types/index.js';

// ─── Helpers ───

const config: GachaAgentConfig = {
  pokemonPriceTracker: {
    apiKey: 'test-key',
    baseUrl: 'https://www.pokemonpricetracker.com',
  },
  telegram: {
    botToken: 'test-token-123',
    defaultChatId: '999',
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

const testCard: ResolvedCard = {
  id: 'base1-4',
  name: 'Charizard',
  setName: 'Base Set',
  setCode: 'base1',
  number: '4',
  year: 1999,
  confidence: 0.95,
};

const testFmv: FairMarketValue = {
  cardId: 'base1-4',
  grade: 9,
  grader: 'PSA',
  fmv: 500.0,
  currency: 'USD',
  prices: [{ source: 'psa', price: 500, currency: 'USD', date: '2026-01-01', saleType: 'completed' }],
  lastUpdated: '2026-01-01T00:00:00Z',
};

const testDeal: ScoredDeal = {
  listing: {
    itemId: 'item-001',
    title: 'PSA 9 Charizard Base Set',
    price: 400.0,
    currency: 'USD',
    shippingCost: 0,
    totalPrice: 400.0,
    listingType: 'BuyItNow',
    sellerUsername: 'card_seller',
    sellerFeedbackScore: 1000,
    sellerFeedbackPercent: 99.5,
    itemUrl: 'https://www.ebay.com/itm/item-001',
  },
  card: testCard,
  fmv: testFmv,
  score: 80,
  signal: 'buy',
  reasoning: 'Good deal — 20% below FMV with reliable seller',
  savingsPercent: 20,
  savingsAmount: 100,
};

// Wildcard Telegram handlers
function telegramHandler(callCount: { count: number }) {
  return http.post(
    /https:\/\/api\.telegram\.org\/bot.+\/sendMessage/,
    () => {
      callCount.count++;
      return HttpResponse.json({ ok: true, result: { message_id: callCount.count } });
    },
  );
}

function telegramPhotoHandler(callCount: { count: number }, capturedBodies: unknown[] = []) {
  return http.post(
    /https:\/\/api\.telegram\.org\/bot.+\/sendPhoto/,
    async ({ request }) => {
      callCount.count++;
      const body = await request.json();
      capturedBodies.push(body);
      return HttpResponse.json({ ok: true, result: { message_id: callCount.count } });
    },
  );
}

function telegramAnswerCallbackHandler(capturedBodies: unknown[] = []) {
  return http.post(
    /https:\/\/api\.telegram\.org\/bot.+\/answerCallbackQuery/,
    async ({ request }) => {
      const body = await request.json();
      capturedBodies.push(body);
      return HttpResponse.json({ ok: true });
    },
  );
}

// ─── Tests ───

describe('TelegramAlerts', () => {
  let storage: InMemoryStorage;
  let alerts: TelegramAlerts;
  let callCount: { count: number };

  beforeEach(() => {
    storage = new InMemoryStorage();
    alerts = new TelegramAlerts(config, storage);
    callCount = { count: 0 };
    server.use(telegramHandler(callCount));
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it('sends a deal alert and returns an alert record', async () => {
    const result = await alerts.sendDealAlert(testDeal, '111');

    expect(result).not.toBeNull();
    expect(result!.id).toBeTruthy();
    expect(result!.sentAt).toBeTruthy();
    expect(callCount.count).toBe(1);
  });

  it('dedup prevents re-send: second call returns null and API is called only once', async () => {
    const first = await alerts.sendDealAlert(testDeal, '111');
    const second = await alerts.sendDealAlert(testDeal, '111');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(callCount.count).toBe(1);
  });

  it('dedup persists across instances: new instance with same storage skips re-send', async () => {
    // Instance A sends the deal
    await alerts.sendDealAlert(testDeal, '222');
    expect(callCount.count).toBe(1);

    // Instance B created with the same storage — simulates restart
    const alertsB = new TelegramAlerts(config, storage);
    const result = await alertsB.sendDealAlert(testDeal, '222');

    expect(result).toBeNull();
    expect(callCount.count).toBe(1); // No new API call
  });

  it('different chatIds are not deduped: same deal to two chatIds both succeed', async () => {
    const result111 = await alerts.sendDealAlert(testDeal, '111');
    const result222 = await alerts.sendDealAlert(testDeal, '222');

    expect(result111).not.toBeNull();
    expect(result222).not.toBeNull();
    expect(callCount.count).toBe(2);
  });

  it('clearDedupeCache resets dedup: same deal can be re-sent after clear', async () => {
    await alerts.sendDealAlert(testDeal, '111');
    expect(callCount.count).toBe(1);

    await alerts.clearDedupeCache();

    const result = await alerts.sendDealAlert(testDeal, '111');
    expect(result).not.toBeNull();
    expect(callCount.count).toBe(2);
  });

  it('message formatting: contains card name, price, FMV, signal, reasoning, and eBay link', () => {
    const message = alerts.formatDealMessage(testDeal);

    expect(message).toContain('Charizard');
    expect(message).toContain('$400.00');
    expect(message).toContain('$500.00'); // FMV
    expect(message).toContain('BUY'); // signal uppercased
    expect(message).toContain('Good deal — 20% below FMV with reliable seller'); // reasoning
    expect(message).toContain('https://www.ebay.com/itm/item-001'); // eBay link
    expect(message).toContain('80/100'); // deal score
    expect(message).toContain('BELOW'); // direction
  });

  it('message includes grader label', () => {
    const message = alerts.formatDealMessage(testDeal);
    expect(message).toContain('PSA 9');
  });

  it('message shows approximate FMV note for cross-grader estimate', () => {
    const approxFmv: FairMarketValue = {
      ...testFmv,
      grader: 'BGS',
      pricingSource: 'PriceCharting PSA 10 (approximate for BGS 10)',
    };
    const bgsDeal: ScoredDeal = { ...testDeal, fmv: approxFmv };
    const message = alerts.formatDealMessage(bgsDeal);
    expect(message).toContain('BGS 9');
    expect(message).toContain('FMV approx from PSA');
  });

  it('throws when no chatId provided and no defaultChatId configured', async () => {
    const configNoChatId: GachaAgentConfig = {
      ...config,
      telegram: { botToken: 'test-token-123' },
    };
    const noDefaultAlerts = new TelegramAlerts(configNoChatId, storage);

    await expect(
      noDefaultAlerts.sendDealAlert(testDeal),
    ).rejects.toThrow('No chat ID provided and no default chat ID configured');
  });

  it('throws when no botToken in config', () => {
    const configNoToken: GachaAgentConfig = {
      ...config,
      telegram: { botToken: '' },
    };

    expect(() => new TelegramAlerts(configNoToken, storage)).toThrow(
      'Telegram bot token is required',
    );
  });
});

// ─── Disambiguation Tests ───

const testCandidates: CardCandidate[] = [
  {
    card: {
      id: '12345',
      name: 'Charizard',
      setName: 'Base Set',
      setCode: 'base1',
      number: '4',
      year: 1999,
      confidence: 0.78,
      imageUrl: 'https://images.example.com/charizard.jpg',
    },
    confidence: 0.78,
    matchReason: 'name match',
  },
  {
    card: {
      id: '12346',
      name: 'Charizard',
      setName: 'Base Set 2',
      setCode: 'base2',
      number: '4',
      year: 2000,
      confidence: 0.72,
      // no imageUrl — tests text fallback
    },
    confidence: 0.72,
    matchReason: 'name match',
  },
];

describe('TelegramAlerts — sendPhoto', () => {
  let storage: InMemoryStorage;
  let alerts: TelegramAlerts;

  beforeEach(() => {
    storage = new InMemoryStorage();
    alerts = new TelegramAlerts(config, storage);
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it('sends correct payload to Telegram sendPhoto API', async () => {
    const capturedBodies: unknown[] = [];
    server.use(telegramPhotoHandler({ count: 0 }, capturedBodies));

    await alerts.sendPhoto('123', 'https://img.example.com/card.jpg', '<b>Test</b>', {
      inline_keyboard: [[{ text: 'Select', callback_data: 'test' }]],
    });

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0] as Record<string, unknown>;
    expect(body.chat_id).toBe('123');
    expect(body.photo).toBe('https://img.example.com/card.jpg');
    expect(body.caption).toBe('<b>Test</b>');
    expect(body.parse_mode).toBe('HTML');
    expect(body.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Select', callback_data: 'test' }]],
    });
  });
});

describe('TelegramAlerts — sendDisambiguationCards', () => {
  let storage: InMemoryStorage;
  let alerts: TelegramAlerts;

  beforeEach(() => {
    storage = new InMemoryStorage();
    alerts = new TelegramAlerts(config, storage);
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it('sends photos for candidates with imageUrl, text for those without', async () => {
    const photoBodies: unknown[] = [];
    const photoCount = { count: 0 };
    const msgCount = { count: 0 };
    server.use(
      telegramPhotoHandler(photoCount, photoBodies),
      telegramHandler(msgCount),
    );

    await alerts.sendDisambiguationCards('123', 'dis_abcdefgh1234', testCandidates);

    // First candidate has image → sendPhoto
    expect(photoCount.count).toBe(1);
    // Second candidate has no image → sendMessage (with keyboard)
    expect(msgCount.count).toBe(1);

    const photoBody = photoBodies[0] as Record<string, unknown>;
    expect(photoBody.photo).toBe('https://images.example.com/charizard.jpg');
    expect(photoBody.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Select #1', callback_data: 'dis:dis_abcd:0' }]],
    });
  });

  it('callback_data uses first 8 chars of sessionId as prefix', async () => {
    const photoBodies: unknown[] = [];
    server.use(
      telegramPhotoHandler({ count: 0 }, photoBodies),
      telegramHandler({ count: 0 }),
    );

    await alerts.sendDisambiguationCards('123', 'dis_xyz12345abcd', testCandidates);

    const photoBody = photoBodies[0] as Record<string, unknown>;
    const keyboard = photoBody.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> };
    expect(keyboard.inline_keyboard[0][0].callback_data).toBe('dis:dis_xyz1:0');
  });
});

describe('TelegramAlerts — answerCallbackQuery', () => {
  let storage: InMemoryStorage;
  let alerts: TelegramAlerts;

  beforeEach(() => {
    storage = new InMemoryStorage();
    alerts = new TelegramAlerts(config, storage);
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it('calls answerCallbackQuery endpoint with correct payload', async () => {
    const capturedBodies: unknown[] = [];
    server.use(telegramAnswerCallbackHandler(capturedBodies));

    await alerts.answerCallbackQuery('cq-123', 'Card selected!');

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0] as Record<string, unknown>;
    expect(body.callback_query_id).toBe('cq-123');
    expect(body.text).toBe('Card selected!');
  });
});

describe('TelegramAlerts — handleUpdate callback_query routing', () => {
  let storage: InMemoryStorage;
  let alerts: TelegramAlerts;

  beforeEach(() => {
    storage = new InMemoryStorage();
    alerts = new TelegramAlerts(config, storage);
  });

  afterEach(() => {
    alerts.stopPolling();
    server.resetHandlers();
  });

  it('routes callback_query to callbackHandler', async () => {
    let receivedData: { chatId: string; userId: string; queryId: string; data: string } | null = null;

    // Mock getUpdates to return a callback_query update then stop
    let getUpdatesCalls = 0;
    server.use(
      http.get(
        /https:\/\/api\.telegram\.org\/bot.+\/getUpdates/,
        () => {
          getUpdatesCalls++;
          if (getUpdatesCalls === 1) {
            return HttpResponse.json({
              ok: true,
              result: [
                {
                  update_id: 100,
                  callback_query: {
                    id: 'cq-456',
                    from: { id: 789, username: 'testuser' },
                    message: { chat: { id: 111 } },
                    data: 'dis:abcdefgh:2',
                  },
                },
              ],
            });
          }
          return HttpResponse.json({ ok: true, result: [] });
        },
      ),
    );

    alerts.startPolling({
      callbackHandler: async (chatId, userId, queryId, data) => {
        receivedData = { chatId, userId, queryId, data };
      },
    });

    // Wait for poll cycle
    await new Promise((r) => setTimeout(r, 200));

    expect(receivedData).not.toBeNull();
    expect(receivedData!.chatId).toBe('111');
    expect(receivedData!.userId).toBe('789');
    expect(receivedData!.queryId).toBe('cq-456');
    expect(receivedData!.data).toBe('dis:abcdefgh:2');
  });
});
