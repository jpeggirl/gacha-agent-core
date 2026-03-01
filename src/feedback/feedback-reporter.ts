import { randomUUID } from 'node:crypto';
import type { StorageAdapter, FeedbackEntry, GachaAgentConfig } from '../types/index.js';
import { InteractionLogger } from '../logging/interaction-logger.js';
import { TelegramAlerts } from '../alerts/telegram.js';

export class FeedbackReporter {
  private storage: StorageAdapter;
  private logger: InteractionLogger;
  private alerts: TelegramAlerts | null;
  private developerChatId: string | null;
  private agentId: string;

  constructor(
    storage: StorageAdapter,
    logger: InteractionLogger,
    config: GachaAgentConfig,
    agentId: string,
  ) {
    this.storage = storage;
    this.logger = logger;
    this.agentId = agentId;

    // Developer chat ID: explicit config > DEVELOPER_CHAT_ID env > telegram defaultChatId
    this.developerChatId =
      config.developer?.chatId ??
      process.env.DEVELOPER_CHAT_ID ??
      config.telegram?.defaultChatId ??
      null;

    // Only create alerts if Telegram is configured
    this.alerts = config.telegram?.botToken
      ? new TelegramAlerts(config, storage)
      : null;
  }

  async report(
    feedbackText: string,
    interactionId?: string,
    telegramContext?: FeedbackEntry['telegramContext'],
  ): Promise<FeedbackEntry> {
    // Resolve the interaction: explicit ID > last interaction in logger
    let interaction = null;
    if (interactionId) {
      interaction = await this.logger.getById(interactionId);
    } else {
      interaction = this.logger.getLastInteraction();
    }

    const entry: FeedbackEntry = {
      id: `fb_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      interactionId: interaction?.id ?? null,
      agentId: this.agentId,
      feedbackText,
      timestamp: new Date().toISOString(),
      telegramContext,
    };

    // Persist
    const key = `feedback:${entry.id}`;
    await this.storage.set(key, entry);

    // Send Telegram notification to developer
    if (this.alerts && this.developerChatId) {
      try {
        await this.alerts.sendFeedbackAlert(
          entry,
          interaction,
          this.agentId,
          this.developerChatId,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Feedback] Telegram alert failed: ${msg}`);
      }
    }

    return entry;
  }
}
