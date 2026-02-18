import type { ScoredDeal, DealAlert, GachaAgentConfig } from '../types/index.js';
import { randomUUID } from 'node:crypto';

const TELEGRAM_API = 'https://api.telegram.org';

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

export class TelegramAlerts {
  private botToken: string;
  private defaultChatId?: string;
  private sentAlerts: Set<string> = new Set(); // dedupe by itemId

  constructor(config: GachaAgentConfig) {
    if (!config.telegram?.botToken) {
      throw new Error('Telegram bot token is required');
    }
    this.botToken = config.telegram.botToken;
    this.defaultChatId = config.telegram.defaultChatId;
  }

  async sendDealAlert(
    deal: ScoredDeal,
    watchlistEntryId: string,
    chatId?: string,
  ): Promise<DealAlert | null> {
    const targetChatId = chatId ?? this.defaultChatId;
    if (!targetChatId) {
      throw new Error('No chat ID provided and no default chat ID configured');
    }

    // Deduplicate — don't send the same listing twice
    const dedupeKey = `${deal.listing.itemId}:${targetChatId}`;
    if (this.sentAlerts.has(dedupeKey)) {
      return null;
    }

    const message = this.formatDealMessage(deal);
    await this.sendMessage(targetChatId, message);

    this.sentAlerts.add(dedupeKey);

    return {
      id: randomUUID(),
      deal,
      watchlistEntryId,
      sentAt: new Date().toISOString(),
      channel: 'telegram',
    };
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendMessage(chatId, text);
  }

  clearDedupeCache(): void {
    this.sentAlerts.clear();
  }

  private formatDealMessage(deal: ScoredDeal): string {
    const { listing, card, fmv, score, signal, savingsPercent, savingsAmount } =
      deal;

    const signalEmoji: Record<string, string> = {
      strong_buy: '🟢🟢',
      buy: '🟢',
      fair: '🟡',
      overpriced: '🟠',
      avoid: '🔴',
    };

    const emoji = signalEmoji[signal] ?? '⚪';
    const direction = savingsAmount > 0 ? 'BELOW' : 'ABOVE';

    const lines = [
      `${emoji} <b>${signal.toUpperCase().replace('_', ' ')}</b> — Deal Score: ${score}/100`,
      '',
      `<b>${card.name}</b>`,
      `${card.setName} #${card.number} ${card.variant ?? ''}`.trim(),
      '',
      `💰 <b>$${listing.totalPrice.toFixed(2)}</b> (${Math.abs(savingsPercent)}% ${direction} FMV)`,
      `📊 FMV: $${fmv.fmv.toFixed(2)} | Savings: $${Math.abs(savingsAmount).toFixed(2)}`,
      '',
      `🏷️ ${listing.listingType} | Seller: ${listing.sellerUsername} (${listing.sellerFeedbackPercent}%)`,
      listing.shippingCost > 0
        ? `📦 +$${listing.shippingCost.toFixed(2)} shipping`
        : '📦 Free shipping',
      '',
      `📝 ${deal.reasoning}`,
      '',
      `<a href="${listing.itemUrl}">View on eBay →</a>`,
    ];

    return lines.join('\n');
  }

  private async sendMessage(
    chatId: string,
    text: string,
  ): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });

    if (!res.ok) {
      const body = (await res.json()) as TelegramResponse;
      throw new Error(
        `Telegram API error: ${res.status} — ${body.description ?? 'Unknown error'}`,
      );
    }
  }
}
