import type {
  ResolvedCard,
  CardCandidate,
  ResolveResult,
  GachaAgentConfig,
} from '../types/index.js';

const CONFIDENCE_THRESHOLD = 0.7;

interface ParseTitleResponse {
  success?: boolean;
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

interface ParseTitleV2Response {
  data?: {
    parsed?: {
      confidence?: number;
      variant?: string;
    };
    matches?: Array<{
      tcgPlayerId?: string | number;
      name: string;
      setName?: string;
      setId?: string | number;
      cardNumber?: string;
      rarity?: string;
      matchScore?: number;
      matchReasons?: string[];
    }>;
  };
  error?: string;
}

type ParseTitleApiResponse = ParseTitleResponse | ParseTitleV2Response;

interface V2MatchInput {
  name: string;
  setName?: string;
  cardNumber?: string;
  variant?: string;
}

export class CardResolver {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: GachaAgentConfig) {
    this.baseUrl = this.normalizeBaseUrl(config.pokemonPriceTracker.baseUrl);
    this.apiKey = config.pokemonPriceTracker.apiKey;
  }

  async resolve(query: string): Promise<ResolveResult> {
    const normalized = this.normalizeQuery(query);

    try {
      const response = await this.callParseTitle(normalized);
      const candidates = this.buildCandidates(response, query);
      if (candidates.length === 0) {
        return {
          success: false,
          candidates: [],
          originalQuery: query,
          needsDisambiguation: false,
        };
      }
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
  ): Promise<ParseTitleApiResponse> {
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

    return res.json() as Promise<ParseTitleApiResponse>;
  }

  private buildCandidates(
    response: ParseTitleApiResponse,
    originalQuery: string,
  ): CardCandidate[] {
    if (this.isLegacyResponse(response)) {
      return this.buildLegacyCandidates(response);
    }

    return this.buildV2Candidates(response, originalQuery);
  }

  private isLegacyResponse(
    response: ParseTitleApiResponse,
  ): response is ParseTitleResponse {
    const primary = (response as ParseTitleResponse).data;
    return Boolean(primary && typeof primary.cardId === 'string');
  }

  private buildLegacyCandidates(response: ParseTitleResponse): CardCandidate[] {
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

  private buildV2Candidates(
    response: ParseTitleV2Response,
    originalQuery: string,
  ): CardCandidate[] {
    const candidates: CardCandidate[] = [];
    const parsedConfidence = this.clampConfidence(
      response.data?.parsed?.confidence ?? 0,
    );
    const variant = response.data?.parsed?.variant;
    const matches = response.data?.matches ?? [];
    const extractedYear = this.extractYear(originalQuery);

    for (const [index, match] of matches.entries()) {
      if (!match?.name) continue;

      const matchConfidence = this.clampConfidence(match.matchScore ?? 0);
      const baseConfidence = this.clampConfidence(
        Math.max(matchConfidence, parsedConfidence * 0.7),
      );
      const relevanceAdjustment = this.computeRelevanceAdjustment(
        originalQuery,
        {
          name: match.name,
          setName: match.setName,
          cardNumber: match.cardNumber,
          variant,
        },
        index,
      );
      const confidence = this.clampConfidence(
        baseConfidence + relevanceAdjustment,
      );
      const setCode = match.setId != null ? String(match.setId) : 'unknown';
      const number = match.cardNumber ?? 'unknown';
      const id =
        match.tcgPlayerId != null
          ? String(match.tcgPlayerId)
          : `${setCode}:${number}:${match.name}`;

      candidates.push({
        card: {
          id,
          name: match.name,
          setName: match.setName ?? 'Unknown Set',
          setCode,
          number,
          year: extractedYear,
          rarity: match.rarity,
          variant,
          confidence,
        },
        confidence,
        matchReason:
          match.matchReasons?.join('; ') ??
          'Match from parse-title API matches',
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  }

  private clampConfidence(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private extractYear(query: string): number {
    const match = query.match(/\b(19|20)\d{2}\b/);
    return match ? parseInt(match[0], 10) : new Date().getFullYear();
  }

  private computeRelevanceAdjustment(
    query: string,
    match: V2MatchInput,
    index: number,
  ): number {
    const normalizedQuery = this.normalizeForMatch(query);
    const normalizedName = this.normalizeForMatch(match.name);
    const normalizedSet = this.normalizeForMatch(match.setName ?? '');
    const normalizedNumber = this.normalizeForMatch(match.cardNumber ?? '');
    const queryVariant = this.detectVariant(normalizedQuery);
    const candidateVariant = this.detectVariant(
      `${normalizedName} ${this.normalizeForMatch(match.variant ?? '')}`,
    );

    let adjustment = 0;

    // "Charizard ex" should prefer Charizard variants over unrelated suffixes.
    if (queryVariant) {
      if (candidateVariant === queryVariant) {
        adjustment += 0.2;
      } else if (candidateVariant && candidateVariant !== queryVariant) {
        adjustment -= 0.25;
      } else {
        adjustment -= 0.05;
      }
    }

    if (normalizedQuery.includes(normalizedName)) {
      adjustment += 0.12;
    }

    const queryTokens = this.queryTokens(normalizedQuery);
    const candidateTokens = new Set(
      `${normalizedName} ${normalizedSet} ${normalizedNumber}`
        .split(/\s+/)
        .filter(Boolean),
    );
    const shared = queryTokens.filter((token) => candidateTokens.has(token));
    if (queryTokens.length > 0) {
      adjustment += (shared.length / queryTokens.length) * 0.18;
    }

    const numberHints = this.extractNumberHints(normalizedQuery);
    if (numberHints.some((hint) => normalizedNumber.includes(hint))) {
      adjustment += 0.18;
    } else if (
      numberHints.some((hint) => normalizedSet.includes(hint))
    ) {
      adjustment += 0.12;
    }

    // Slightly reduce bias from API ordering so better semantic matches can win.
    adjustment -= index * 0.01;
    return adjustment;
  }

  private normalizeForMatch(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9/ ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private queryTokens(normalizedQuery: string): string[] {
    const stopwords = new Set([
      'pokemon',
      'card',
      'cards',
      'psa',
      'bgs',
      'cgc',
      'the',
      'and',
      'grade',
    ]);

    return normalizedQuery
      .split(/\s+/)
      .filter((token) => token.length > 1)
      .filter((token) => !stopwords.has(token))
      .filter((token) => !/^(19|20)\d{2}$/.test(token));
  }

  private detectVariant(normalizedText: string): string | null {
    const variants = [
      'vmax',
      'vstar',
      'gx',
      'ex',
      'tag team',
      'radiant',
      'mega',
    ];

    for (const variant of variants) {
      if (normalizedText.includes(variant)) {
        return variant;
      }
    }
    return null;
  }

  private extractNumberHints(normalizedQuery: string): string[] {
    const hints = new Set<string>();
    for (const match of normalizedQuery.matchAll(/\b\d{1,3}\/\d{1,3}\b/g)) {
      hints.add(match[0]);
    }

    for (const match of normalizedQuery.matchAll(/\b\d{2,3}\b/g)) {
      const token = match[0];
      // Ignore likely grading numbers.
      if (token === '10' || token === '9' || token === '8') continue;
      hints.add(token);
    }

    return Array.from(hints);
  }

  private normalizeBaseUrl(baseUrl: string): string {
    // The API redirects non-www -> www and strips Authorization on redirect.
    // Normalizing here keeps Bearer auth intact for fetch requests.
    return baseUrl.replace(
      '://pokemonpricetracker.com',
      '://www.pokemonpricetracker.com',
    );
  }
}
