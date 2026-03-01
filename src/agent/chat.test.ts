import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { ChatAgent } from './chat.js';
import { CardResolver } from '../card-resolver/resolver.js';
import { PriceEngine } from '../pricing/engine.js';
import { DealScorer } from '../scanner/deal-scorer.js';
import { InventoryManager } from '../inventory/manager.js';
import type { StorageAdapter, GachaAgentConfig, ChatMessage } from '../types/index.js';

// In-memory storage
class MemoryStorage implements StorageAdapter {
  private data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> {
    const val = this.data.get(key);
    return val !== undefined ? (val as T) : null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    return Array.from(this.data.keys()).filter((k) => k.startsWith(prefix));
  }
}

const TEST_CONFIG: GachaAgentConfig = {
  pokemonPriceTracker: {
    apiKey: 'test-key',
    baseUrl: 'https://www.pokemonpricetracker.com',
  },
  priceCharting: {
    apiKey: 'test-pc-key',
  },
  storage: { type: 'json', jsonPath: './test-data' },
};

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Helper to build a mock Gemini text response
function mockGeminiTextResponse(text: string) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: 'model',
        },
        finishReason: 'STOP',
      },
    ],
  };
}

// Helper to build a mock Gemini function call response
function mockGeminiFunctionCallResponse(name: string, args: unknown) {
  return {
    candidates: [
      {
        content: {
          parts: [{ functionCall: { name, args } }],
          role: 'model',
        },
        finishReason: 'STOP',
      },
    ],
  };
}

describe('ChatAgent', () => {
  let chatAgent: ChatAgent;
  let storage: MemoryStorage;
  let geminiCallCount: number;

  beforeEach(() => {
    storage = new MemoryStorage();
    geminiCallCount = 0;
  });

  function setupAgent() {
    chatAgent = new ChatAgent({
      apiKey: 'test-gemini-key',
      resolver: new CardResolver(TEST_CONFIG),
      priceEngine: new PriceEngine(TEST_CONFIG),
      ebayScanner: null,
      dealScorer: new DealScorer(),
      inventoryManager: new InventoryManager(storage),
    });
  }

  describe('simple text response', () => {
    it('returns text from Gemini when no tools are used', async () => {
      server.use(
        http.post(GEMINI_URL, () => {
          return HttpResponse.json(
            mockGeminiTextResponse('Hello! I can help you find Pokemon cards.'),
          );
        }),
      );

      setupAgent();
      const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];
      const response = await chatAgent.chat(messages);

      expect(response.text).toBe('Hello! I can help you find Pokemon cards.');
      expect(response.cards).toBeUndefined();
      expect(response.deals).toBeUndefined();
    });
  });

  describe('tool use: resolve_card', () => {
    it('executes resolve_card tool and returns result', async () => {
      // Mock parse-title API
      server.use(
        http.post('https://www.pokemonpricetracker.com/api/v2/parse-title', () => {
          return HttpResponse.json({
            data: {
              parsed: { confidence: 0.95, cardName: 'Charizard' },
              matches: [
                {
                  tcgPlayerId: '12345',
                  name: 'Charizard',
                  setName: 'Base Set',
                  cardNumber: '4/102',
                  matchScore: 0.95,
                  matchReasons: ['Exact name match'],
                },
              ],
            },
          });
        }),
      );

      // First call: Gemini asks to use resolve_card
      // Second call: Gemini responds with text after seeing tool result
      server.use(
        http.post(GEMINI_URL, () => {
          geminiCallCount++;
          if (geminiCallCount === 1) {
            return HttpResponse.json(
              mockGeminiFunctionCallResponse('resolve_card', { query: 'charizard base set' }),
            );
          }
          return HttpResponse.json(
            mockGeminiTextResponse('I found Charizard from Base Set (#4/102). It\'s one of the most iconic cards!'),
          );
        }),
      );

      setupAgent();
      const messages: ChatMessage[] = [{ role: 'user', content: 'find charizard base set' }];
      const response = await chatAgent.chat(messages);

      expect(response.text).toContain('Charizard');
      expect(response.cards).toHaveLength(1);
      expect(response.cards![0]!.name).toBe('Charizard');
    });
  });

  describe('tool use: check_inventory', () => {
    it('executes check_inventory and returns matching items', async () => {
      // Pre-load inventory
      await storage.set('inventory:item1', {
        id: 'item1',
        name: 'Charizard',
        setName: 'Base Set',
        number: '4/102',
        grade: 10,
        grader: 'PSA',
        price: 42000,
        quantity: 1,
        status: 'available',
        createdAt: new Date().toISOString(),
      });

      server.use(
        http.post(GEMINI_URL, () => {
          geminiCallCount++;
          if (geminiCallCount === 1) {
            return HttpResponse.json(
              mockGeminiFunctionCallResponse('check_inventory', { query: 'charizard' }),
            );
          }
          return HttpResponse.json(
            mockGeminiTextResponse('We have a Charizard Base Set PSA 10 in stock for $42,000!'),
          );
        }),
      );

      setupAgent();
      const messages: ChatMessage[] = [{ role: 'user', content: 'do you have charizard?' }];
      const response = await chatAgent.chat(messages);

      expect(response.text).toContain('Charizard');
      expect(response.inventory).toHaveLength(1);
      expect(response.inventory![0]!.name).toBe('Charizard');
      expect(response.inventory![0]!.price).toBe(42000);
    });
  });

  describe('error handling', () => {
    it('handles Gemini API errors gracefully', async () => {
      server.use(
        http.post(GEMINI_URL, () => {
          return HttpResponse.json(
            { error: { code: 400, message: 'Bad request', status: 'INVALID_ARGUMENT' } },
            { status: 400 },
          );
        }),
      );

      setupAgent();
      const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

      await expect(chatAgent.chat(messages)).rejects.toThrow();
    });
  });

  describe('multi-turn tool use', () => {
    it('handles multiple sequential tool calls', async () => {
      // Mock parse-title for resolve_card
      server.use(
        http.post('https://www.pokemonpricetracker.com/api/v2/parse-title', () => {
          return HttpResponse.json({
            data: {
              parsed: { confidence: 0.95, cardName: 'Pikachu' },
              matches: [
                {
                  tcgPlayerId: '99999',
                  name: 'Pikachu',
                  setName: 'Van Gogh Promo',
                  cardNumber: '085',
                  matchScore: 0.95,
                },
              ],
            },
          });
        }),
      );

      // Three Gemini calls:
      // 1. Tool use: resolve_card
      // 2. Tool use: check_inventory
      // 3. Final text response
      server.use(
        http.post(GEMINI_URL, () => {
          geminiCallCount++;
          if (geminiCallCount === 1) {
            return HttpResponse.json(
              mockGeminiFunctionCallResponse('resolve_card', { query: 'pikachu van gogh' }),
            );
          }
          if (geminiCallCount === 2) {
            return HttpResponse.json(
              mockGeminiFunctionCallResponse('check_inventory', { query: 'pikachu' }),
            );
          }
          return HttpResponse.json(
            mockGeminiTextResponse('I found Pikachu Van Gogh! We don\'t have it in stock right now.'),
          );
        }),
      );

      setupAgent();
      const messages: ChatMessage[] = [{ role: 'user', content: 'do you have pikachu van gogh?' }];
      const response = await chatAgent.chat(messages);

      expect(response.text).toContain('Pikachu');
      expect(response.cards).toHaveLength(1);
      expect(geminiCallCount).toBe(3);
    });
  });
});
