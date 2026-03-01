import type { GachaAgentConfig } from './types/index.js';

export function env(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

export function loadConfig(): GachaAgentConfig {
  return {
    pokemonPriceTracker: {
      apiKey: env('POKEMON_PRICE_TRACKER_API_KEY'),
      baseUrl: env('POKEMON_PRICE_TRACKER_URL', 'https://www.pokemonpricetracker.com'),
    },
    priceCharting: {
      apiKey: env('PRICECHARTING_API_KEY'),
    },
    ebay: process.env.EBAY_APP_ID
      ? {
          appId: env('EBAY_APP_ID'),
          certId: env('EBAY_CERT_ID'),
          sandbox: process.env.EBAY_SANDBOX === 'true',
          whitelistSellers: process.env.EBAY_WHITELIST_SELLERS
            ? process.env.EBAY_WHITELIST_SELLERS.split(',').map(s => s.trim()).filter(Boolean)
            : undefined,
        }
      : undefined,
    telegram: process.env.TELEGRAM_BOT_TOKEN
      ? {
          botToken: env('TELEGRAM_BOT_TOKEN'),
          defaultChatId: process.env.TELEGRAM_CHAT_ID,
        }
      : undefined,
    pokemonTcg: process.env.POKEMON_TCG_API_KEY
      ? { apiKey: process.env.POKEMON_TCG_API_KEY }
      : undefined,
    gemini: process.env.GEMINI_API_KEY
      ? { apiKey: process.env.GEMINI_API_KEY }
      : undefined,
    storage: {
      type: 'json',
      jsonPath: process.env.DATA_PATH ?? './data',
    },
    developer: process.env.DEVELOPER_CHAT_ID
      ? { chatId: process.env.DEVELOPER_CHAT_ID }
      : undefined,
  };
}
