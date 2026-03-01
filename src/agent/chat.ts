import { GoogleGenerativeAI, type Content, type Part, type FunctionCallPart } from '@google/generative-ai';
import type { CardResolver } from '../card-resolver/resolver.js';
import type { PriceEngine } from '../pricing/engine.js';
import type { EbayScanner } from '../scanner/ebay.js';
import type { DealScorer } from '../scanner/deal-scorer.js';
import type { InventoryManager } from '../inventory/manager.js';
import { TOOL_DEFINITIONS } from './tools.js';
import type {
  ChatMessage,
  AgentResponse,
  ResolvedCard,
  ScoredDeal,
  InventoryItem,
  FairMarketValue,
  CardCandidate,
  Grader,
} from '../types/index.js';

const SYSTEM_PROMPT = `You are Gacha, a friendly and knowledgeable Pokemon card expert. You help users find, price, and buy graded Pokemon cards.

Your capabilities:
- Identify cards from natural language descriptions (use resolve_card)
- Look up fair market values for graded cards (use get_price)
- Search eBay for deals on specific cards (use search_ebay)
- Check Gacha's inventory for cards in stock (use check_inventory)

Guidelines:
- Be conversational and helpful. Keep responses concise but informative.
- When a user mentions a card, resolve it first, then get pricing or search for deals as appropriate.
- When showing prices, always mention the grade and grader (e.g. "PSA 10").
- When comparing deals, explain the savings percentage and deal signal clearly.
- If a card can't be resolved, suggest alternative names or ask the user to be more specific.
- If disambiguation is needed (multiple possible cards), present the options clearly and ask the user to pick one.
- If the user asks what you have in stock, use check_inventory.
- For price comparisons across grades, call get_price multiple times with different grades.
- Always use tools to get real data — never guess at prices or availability.`;

const MAX_TOOL_ROUNDS = 10;

interface ToolCallCollector {
  cards: ResolvedCard[];
  deals: ScoredDeal[];
  inventory: InventoryItem[];
  fmv: FairMarketValue | null;
  disambiguation: CardCandidate[];
}

export class ChatAgent {
  private genAI: GoogleGenerativeAI;
  private resolver: CardResolver;
  private priceEngine: PriceEngine;
  private ebayScanner: EbayScanner | null;
  private dealScorer: DealScorer;
  private inventoryManager: InventoryManager;

  constructor(deps: {
    apiKey: string;
    resolver: CardResolver;
    priceEngine: PriceEngine;
    ebayScanner: EbayScanner | null;
    dealScorer: DealScorer;
    inventoryManager: InventoryManager;
  }) {
    this.genAI = new GoogleGenerativeAI(deps.apiKey);
    this.resolver = deps.resolver;
    this.priceEngine = deps.priceEngine;
    this.ebayScanner = deps.ebayScanner;
    this.dealScorer = deps.dealScorer;
    this.inventoryManager = deps.inventoryManager;
  }

  async chat(messages: ChatMessage[]): Promise<AgentResponse> {
    const collector: ToolCallCollector = {
      cards: [],
      deals: [],
      inventory: [],
      fmv: null,
      disambiguation: [],
    };

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: TOOL_DEFINITIONS }],
    });

    // Convert ChatMessage[] to Gemini Content[] format
    // The last user message is sent via sendMessage; prior messages form history
    const history: Content[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i]!;
      history.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }

    const lastMessage = messages[messages.length - 1]!;
    const chat = model.startChat({ history });

    let response = await chat.sendMessage(lastMessage.content);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const candidate = response.response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts ?? [];
      const functionCalls = parts.filter(
        (p): p is FunctionCallPart => 'functionCall' in p,
      );

      // No function calls — we're done
      if (functionCalls.length === 0) {
        const text = parts
          .filter((p): p is Part & { text: string } => 'text' in p)
          .map((p) => p.text)
          .join('');

        return {
          text,
          cards: collector.cards.length > 0 ? collector.cards : undefined,
          deals: collector.deals.length > 0 ? collector.deals : undefined,
          inventory: collector.inventory.length > 0 ? collector.inventory : undefined,
          fmv: collector.fmv ?? undefined,
          disambiguation: collector.disambiguation.length > 0 ? collector.disambiguation : undefined,
        };
      }

      // Execute all function calls and send results back
      const functionResponses: Part[] = [];
      for (const fc of functionCalls) {
        const result = await this.executeTool(
          fc.functionCall.name,
          (fc.functionCall.args ?? {}) as Record<string, unknown>,
          collector,
        );
        functionResponses.push({
          functionResponse: {
            name: fc.functionCall.name,
            response: { result },
          },
        });
      }

      response = await chat.sendMessage(functionResponses);
    }

    // Hit max rounds — return what we have
    return {
      text: "I've been working on your request but it's taking longer than expected. Here's what I found so far.",
      cards: collector.cards.length > 0 ? collector.cards : undefined,
      deals: collector.deals.length > 0 ? collector.deals : undefined,
      inventory: collector.inventory.length > 0 ? collector.inventory : undefined,
      fmv: collector.fmv ?? undefined,
    };
  }

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
    collector: ToolCallCollector,
  ): Promise<unknown> {
    switch (name) {
      case 'resolve_card':
        return this.executeResolveCard(input, collector);
      case 'get_price':
        return this.executeGetPrice(input, collector);
      case 'search_ebay':
        return this.executeSearchEbay(input, collector);
      case 'check_inventory':
        return this.executeCheckInventory(input, collector);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private async executeResolveCard(
    input: Record<string, unknown>,
    collector: ToolCallCollector,
  ): Promise<unknown> {
    const query = input.query as string;
    const result = await this.resolver.resolve(query);

    if (result.success && result.bestMatch) {
      collector.cards.push(result.bestMatch);
    }

    if (result.needsDisambiguation) {
      collector.disambiguation = result.candidates;
    }

    return result;
  }

  private async executeGetPrice(
    input: Record<string, unknown>,
    collector: ToolCallCollector,
  ): Promise<unknown> {
    const cardId = input.card_id as string;
    const cardName = input.card_name as string;
    const cardNumber = input.card_number as string;
    const grade = (input.grade as number) ?? 9;
    const grader = (input.grader as Grader) ?? 'PSA';

    const card: ResolvedCard = {
      id: cardId,
      name: cardName,
      setName: '',
      setCode: '',
      number: cardNumber,
      year: new Date().getFullYear(),
      confidence: 1,
    };

    const fmv = await this.priceEngine.getFMV(card, grade, grader);
    if (fmv) {
      collector.fmv = fmv;
    }

    return fmv ?? { error: `No pricing data available for ${cardName} ${grader} ${grade}` };
  }

  private async executeSearchEbay(
    input: Record<string, unknown>,
    collector: ToolCallCollector,
  ): Promise<unknown> {
    if (!this.ebayScanner) {
      return { error: 'eBay scanning is not configured' };
    }

    const cardId = input.card_id as string;
    const cardName = input.card_name as string;
    const setName = (input.set_name as string) ?? '';
    const cardNumber = input.card_number as string;
    const grade = (input.grade as number) ?? 9;
    const grader = (input.grader as Grader) ?? 'PSA';

    const card: ResolvedCard = {
      id: cardId,
      name: cardName,
      setName,
      setCode: '',
      number: cardNumber,
      year: new Date().getFullYear(),
      confidence: 1,
    };

    const scanResult = await this.ebayScanner.scan(card, grade, grader);

    const fmv = await this.priceEngine.getFMV(card, grade, grader);
    if (fmv && scanResult.listings.length > 0) {
      const scored = this.dealScorer.scoreMany(scanResult.listings, card, fmv);
      collector.deals.push(...scored);
      collector.fmv = fmv;
      return {
        totalFound: scanResult.totalFound,
        fmv: { fmv: fmv.fmv, grade: fmv.grade, grader: fmv.grader },
        deals: scored.slice(0, 5).map((d) => ({
          title: d.listing.title,
          price: d.listing.totalPrice,
          score: d.score,
          signal: d.signal,
          savingsPercent: d.savingsPercent,
          listingType: d.listing.listingType,
          url: d.listing.itemUrl,
        })),
      };
    }

    return {
      totalFound: scanResult.totalFound,
      listings: scanResult.listings.slice(0, 5).map((l) => ({
        title: l.title,
        price: l.totalPrice,
        listingType: l.listingType,
        url: l.itemUrl,
      })),
    };
  }

  private async executeCheckInventory(
    input: Record<string, unknown>,
    collector: ToolCallCollector,
  ): Promise<unknown> {
    const query = input.query as string;
    const grade = input.grade as number | undefined;
    const grader = input.grader as Grader | undefined;

    let items: InventoryItem[];

    if (grade || grader) {
      const resolved = await this.resolver.resolve(query);
      if (resolved.success && resolved.bestMatch) {
        items = await this.inventoryManager.matchCard(resolved.bestMatch, grade, grader);
      } else {
        items = await this.inventoryManager.search(query);
      }
    } else {
      items = await this.inventoryManager.search(query);
    }

    collector.inventory.push(...items);

    if (items.length === 0) {
      return { found: 0, message: `No matching items in Gacha inventory for "${query}"` };
    }

    return {
      found: items.length,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        setName: item.setName,
        grade: item.grade,
        grader: item.grader,
        price: item.price,
        quantity: item.quantity,
        variant: item.variant,
        imageUrl: item.imageUrl,
      })),
    };
  }
}
