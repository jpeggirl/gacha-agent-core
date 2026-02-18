import type {
  ResolvedCard,
  CardCandidate,
  ResolveResult,
  GachaAgentConfig,
} from '../types/index.js';

const CONFIDENCE_THRESHOLD = 0.7;

interface ParseTitleResponse {
  success: boolean;
  data?: {
    cardId: string;
    name: string;
    setName: string;
    setCode: string;
    number: string;
    year: number;
    rarity?: string;
    variant?: string;
    imageUrl?: string;
    confidence: number;
  };
  candidates?: Array<{
    cardId: string;
    name: string;
    setName: string;
    setCode: string;
    number: string;
    year: number;
    rarity?: string;
    variant?: string;
    imageUrl?: string;
    confidence: number;
    matchReason: string;
  }>;
  error?: string;
}

export class CardResolver {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: GachaAgentConfig) {
    this.baseUrl = config.pokemonPriceTracker.baseUrl;
    this.apiKey = config.pokemonPriceTracker.apiKey;
  }

  async resolve(query: string): Promise<ResolveResult> {
    const normalized = this.normalizeQuery(query);

    try {
      const response = await this.callParseTitle(normalized);

      if (!response.success || !response.data) {
        return {
          success: false,
          candidates: [],
          originalQuery: query,
          needsDisambiguation: false,
        };
      }

      const candidates = this.buildCandidates(response);
      const bestMatch = candidates[0]?.card;
      const needsDisambiguation =
        !bestMatch || bestMatch.confidence < CONFIDENCE_THRESHOLD;

      return {
        success: !needsDisambiguation && !!bestMatch,
        bestMatch: needsDisambiguation ? undefined : bestMatch,
        candidates,
        originalQuery: query,
        needsDisambiguation,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        candidates: [],
        originalQuery: query,
        needsDisambiguation: false,
      };
    }
  }

  async resolveWithGrade(
    query: string,
    grade: number,
  ): Promise<ResolveResult> {
    // Append grade info to help the parser if not already present
    const gradePattern = /\b(psa|bgs|cgc)\s*\d+/i;
    const queryWithGrade = gradePattern.test(query)
      ? query
      : `${query} PSA ${grade}`;
    return this.resolve(queryWithGrade);
  }

  private normalizeQuery(query: string): string {
    return query
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/['']/g, "'")
      .replace(/[""]/g, '"');
  }

  private async callParseTitle(
    title: string,
  ): Promise<ParseTitleResponse> {
    const url = `${this.baseUrl}/api/v2/parse-title`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ title }),
    });

    if (!res.ok) {
      throw new Error(
        `PokemonPriceTracker API error: ${res.status} ${res.statusText}`,
      );
    }

    return res.json() as Promise<ParseTitleResponse>;
  }

  private buildCandidates(response: ParseTitleResponse): CardCandidate[] {
    const candidates: CardCandidate[] = [];

    // Add the primary match
    if (response.data) {
      const d = response.data;
      candidates.push({
        card: {
          id: d.cardId,
          name: d.name,
          setName: d.setName,
          setCode: d.setCode,
          number: d.number,
          year: d.year,
          rarity: d.rarity,
          variant: d.variant,
          imageUrl: d.imageUrl,
          confidence: d.confidence,
        },
        confidence: d.confidence,
        matchReason: 'Primary match from parse-title API',
      });
    }

    // Add additional candidates
    if (response.candidates) {
      for (const c of response.candidates) {
        // Skip if same as primary match
        if (response.data && c.cardId === response.data.cardId) continue;
        candidates.push({
          card: {
            id: c.cardId,
            name: c.name,
            setName: c.setName,
            setCode: c.setCode,
            number: c.number,
            year: c.year,
            rarity: c.rarity,
            variant: c.variant,
            imageUrl: c.imageUrl,
            confidence: c.confidence,
          },
          confidence: c.confidence,
          matchReason: c.matchReason,
        });
      }
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  }
}
