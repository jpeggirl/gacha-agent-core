import type { ScoredDeal, GachaAgentConfig, StorageAdapter, FeedbackEntry, InteractionLog, CardCandidate } from '../types/index.js';
import { randomUUID } from 'node:crypto';

const TELEGRAM_API = 'https://api.telegram.org';
const DEDUP_STORAGE_KEY = 'telegram:dedup';

interface TelegramResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number; username?: string };
    text?: string;
    reply_to_message?: {
      text?: string;
    };
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    message?: { chat: { id: number } };
    data?: string;
  };
}

interface PollingOptions {
  feedbackHandler?: (
    chatId: string,
    userId: string,
    username: string,
    text: string,
    replyToText?: string,
  ) => Promise<void>;
  callbackHandler?: (
    chatId: string,
    userId: string,
    callbackQueryId: string,
    data: string,
  ) => Promise<void>;
}

export class TelegramAlerts {
  private botToken: string;
  private defaultChatId?: string;
  private storage: StorageAdapter;
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateId = 0;

  constructor(config: GachaAgentConfig, storage: StorageAdapter) {
    if (!config.telegram?.botToken) {
      throw new Error('Telegram bot token is required');
    }
    this.botToken = config.telegram.botToken;
    this.defaultChatId = config.telegram.defaultChatId;
    this.storage = storage;
  }

  async sendDealAlert(
    deal: ScoredDeal,
    chatId?: string,
  ): Promise<{ id: string; sentAt: string } | null> {
    const targetChatId = chatId ?? this.defaultChatId;
    if (!targetChatId) {
      throw new Error('No chat ID provided and no default chat ID configured');
    }

    // Deduplicate — don't send the same listing twice
    const dedupeKey = `${deal.listing.itemId}:${targetChatId}`;
    const deduped = await this.getDedupeSet();
    if (deduped.has(dedupeKey)) {
      return null;
    }

    const message = this.formatDealMessage(deal);
    await this.sendMessage(targetChatId, message);

    deduped.add(dedupeKey);
    await this.saveDedupeSet(deduped);

    return {
      id: randomUUID(),
      sentAt: new Date().toISOString(),
    };
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendMessage(chatId, text);
  }

  async sendFeedbackAlert(
    feedback: FeedbackEntry,
    interaction: InteractionLog | null,
    agentId: string,
    chatId: string,
  ): Promise<void> {
    const message = this.formatFeedbackMessage(feedback, interaction, agentId);
    await this.sendMessage(chatId, message);
  }

  async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption: string,
    replyMarkup?: unknown,
  ): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendPhoto`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const resp = (await res.json()) as TelegramResponse;
      throw new Error(
        `Telegram API error: ${res.status} \u2014 ${resp.description ?? 'Unknown error'}`,
      );
    }
  }

  async sendDisambiguationCards(
    chatId: string,
    sessionId: string,
    candidates: CardCandidate[],
  ): Promise<void> {
    const prefix = sessionId.slice(0, 8);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const card = c.card;
      const caption = `<b>${escapeHtml(card.name)}</b>\n${escapeHtml(card.setName)} #${escapeHtml(card.number)}${card.variant ? ' ' + escapeHtml(card.variant) : ''}\nConfidence: ${(c.confidence * 100).toFixed(0)}%`;
      const keyboard = {
        inline_keyboard: [
          [{ text: `Select #${i + 1}`, callback_data: `dis:${prefix}:${i}` }],
        ],
      };
      if (card.imageUrl) {
        await this.sendPhoto(chatId, card.imageUrl, caption, keyboard);
      } else {
        await this.sendMessageWithKeyboard(chatId, caption, keyboard);
      }
    }
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/answerCallbackQuery`;
    const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
    if (text) body.text = text;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const resp = (await res.json()) as TelegramResponse;
      throw new Error(
        `Telegram API error: ${res.status} \u2014 ${resp.description ?? 'Unknown error'}`,
      );
    }
  }

  private async sendMessageWithKeyboard(
    chatId: string,
    text: string,
    replyMarkup: unknown,
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
        reply_markup: replyMarkup,
      }),
    });
    if (!res.ok) {
      const body = (await res.json()) as TelegramResponse;
      throw new Error(
        `Telegram API error: ${res.status} \u2014 ${body.description ?? 'Unknown error'}`,
      );
    }
  }

  async clearDedupeCache(): Promise<void> {
    await this.storage.set(DEDUP_STORAGE_KEY, []);
  }

  formatDealMessage(deal: ScoredDeal): string {
    const { listing, card, fmv, score, signal, savingsPercent, savingsAmount } =
      deal;

    const signalEmoji: Record<string, string> = {
      strong_buy: '\u{1F7E2}\u{1F7E2}',
      buy: '\u{1F7E2}',
      fair: '\u{1F7E1}',
      overpriced: '\u{1F7E0}',
      avoid: '\u{1F534}',
    };

    const emoji = signalEmoji[signal] ?? '\u26AA';
    const direction = savingsAmount > 0 ? 'BELOW' : 'ABOVE';

    const gradeLabel = `${fmv.grader} ${fmv.grade}`;
    const approxNote = fmv.pricingSource?.includes('approximate')
      ? ` (FMV approx from PSA)`
      : '';

    const lines = [
      `${emoji} <b>${signal.toUpperCase().replace('_', ' ')}</b> \u2014 Deal Score: ${score}/100`,
      '',
      `<b>${card.name}</b> \u2014 ${gradeLabel}`,
      `${card.setName} #${card.number} ${card.variant ?? ''}`.trim(),
      '',
      `\u{1F4B0} <b>$${listing.totalPrice.toFixed(2)}</b> (${Math.abs(savingsPercent)}% ${direction} FMV)`,
      `\u{1F4CA} FMV: $${fmv.fmv.toFixed(2)}${approxNote} | Savings: $${Math.abs(savingsAmount).toFixed(2)}`,
      '',
      `\u{1F3F7}\uFE0F ${listing.listingType} | Seller: ${listing.sellerUsername} (${listing.sellerFeedbackPercent}%)`,
      listing.shippingCost > 0
        ? `\u{1F4E6} +$${listing.shippingCost.toFixed(2)} shipping`
        : '\u{1F4E6} Free shipping',
      '',
      `\u{1F4DD} ${deal.reasoning}`,
      '',
      `<a href="${listing.itemUrl}">View on eBay \u2192</a>`,
    ];

    return lines.join('\n');
  }

  formatFeedbackMessage(
    feedback: FeedbackEntry,
    interaction: InteractionLog | null,
    agentId: string,
  ): string {
    const lines: string[] = [
      `\u{1F6A8} <b>USER FEEDBACK</b>`,
      '',
      `<b>Agent:</b> ${escapeHtml(agentId)}`,
      `<b>Feedback ID:</b> ${escapeHtml(feedback.id)}`,
      `<b>Interaction ID:</b> ${escapeHtml(feedback.interactionId ?? 'none')}`,
      '',
      `<b>Feedback:</b> ${escapeHtml(feedback.feedbackText)}`,
    ];

    if (interaction) {
      lines.push('');
      lines.push(`<b>Query:</b> ${escapeHtml(String(typeof interaction.input === 'string' ? interaction.input : JSON.stringify(interaction.input)))}`);
      lines.push(`<b>Output:</b> ${escapeHtml(String(typeof interaction.output === 'string' ? interaction.output : JSON.stringify(interaction.output)))}`);
    }

    return lines.join('\n');
  }

  startPolling(options: PollingOptions): void {
    if (this.pollingTimer) return;
    this.poll(options);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private async poll(options: PollingOptions): Promise<void> {
    try {
      const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`;
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
        if (body.ok && body.result) {
          for (const update of body.result) {
            this.lastUpdateId = update.update_id;
            await this.handleUpdate(update, options);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Telegram] Polling error: ${msg}`);
    }

    this.pollingTimer = setTimeout(() => this.poll(options), 1000);
  }

  private async handleUpdate(
    update: TelegramUpdate,
    options: PollingOptions,
  ): Promise<void> {
    // Route callback_query updates
    if (update.callback_query) {
      const cq = update.callback_query;
      if (cq.data && options.callbackHandler) {
        const chatId = String(cq.message?.chat?.id ?? '');
        const userId = String(cq.from.id);
        await options.callbackHandler(chatId, userId, cq.id, cq.data);
      }
      return;
    }

    const message = update.message;
    if (!message?.text) return;

    const text = message.text.trim();
    const chatId = String(message.chat.id);
    const userId = String(message.from?.id ?? '');
    const username = message.from?.username ?? '';
    const replyToText = message.reply_to_message?.text;

    // Handle /feedback command
    if (text.startsWith('/feedback') && options.feedbackHandler) {
      const feedbackText = text.replace(/^\/feedback\s*/, '').trim();
      if (feedbackText) {
        await options.feedbackHandler(chatId, userId, username, feedbackText, replyToText);
      }
    }
  }

  private async getDedupeSet(): Promise<Set<string>> {
    const keys = await this.storage.get<string[]>(DEDUP_STORAGE_KEY);
    return new Set(keys ?? []);
  }

  private async saveDedupeSet(deduped: Set<string>): Promise<void> {
    await this.storage.set(DEDUP_STORAGE_KEY, [...deduped]);
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
        `Telegram API error: ${res.status} \u2014 ${body.description ?? 'Unknown error'}`,
      );
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
