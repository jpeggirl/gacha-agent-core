import { readFile } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';
import type {
  ResolvedCard,
  CardCandidate,
  ResolveResult,
  GachaAgentConfig,
  Grader,
} from '../types/index.js';
import { computeSKU } from '../search/sku.js';

const AUTO_PROCEED_THRESHOLD = 0.85;
const DISAMBIGUATE_THRESHOLD = 0.70;

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
      cardName?: string;
    };
    matches?: Array<{
      tcgPlayerId?: string | number;
      name: string;
      setName?: string;
      setId?: string | number;
      cardNumber?: string;
      rarity?: string;
      year?: number;
      matchScore?: number;
      matchReasons?: string[];
    }>;
  };
  error?: string;
}

interface SearchCardsResponse {
  data?: Array<{
    tcgPlayerId?: string | number;
    name: string;
    setName?: string;
    setId?: string | number;
    cardNumber?: string;
    rarity?: string;
    imageUrl?: string;
  }>;
  error?: string;
}

interface CardLookupResponse {
  data?: { imageUrl?: string } | Array<{ imageUrl?: string }>;
}

type ParseTitleApiResponse = ParseTitleResponse | ParseTitleV2Response;

interface V2MatchInput {
  name: string;
  setName?: string;
  cardNumber?: string;
  variant?: string;
}

interface AliasFile {
  exact: Record<string, string>;
  patterns: Array<{ match: string; expand: string }>;
}

export class CardResolver {
  private baseUrl: string;
  private apiKey: string;
  private aliasLoadPromise: Promise<void> | null = null;
  private aliasMap: Map<string, string> = new Map();
  private aliasPatterns: Array<{ match: RegExp; expand: string }> = [];

  constructor(config: GachaAgentConfig) {
    this.baseUrl = this.normalizeBaseUrl(config.pokemonPriceTracker.baseUrl);
    this.apiKey = config.pokemonPriceTracker.apiKey;
  }

  private async loadAliases(): Promise<void> {
    if (this.aliasLoadPromise) return this.aliasLoadPromise;
    this.aliasLoadPromise = (async () => {
      try {
        const aliasPath = pathResolve(__dirname, '../../data/card-aliases.json');
        const raw = await readFile(aliasPath, 'utf-8');
        const data = JSON.parse(raw) as AliasFile;
        for (const [key, value] of Object.entries(data.exact ?? {})) {
          this.aliasMap.set(key.toLowerCase(), value);
        }
        for (const pattern of data.patterns ?? []) {
          this.aliasPatterns.push({
            match: new RegExp(pattern.match, 'i'),
            expand: pattern.expand,
          });
        }
      } catch (err) {
        console.warn('[CardResolver] Failed to load card aliases:', err);
      }
    })();
    return this.aliasLoadPromise;
  }

  private expandAlias(query: string): string {
    const trimmed = query.trim();

    // Strip trailing grade modifier (e.g. "PSA 10", "grade 9", "BGS 9.5")
    const gradePattern = /\s+(psa|bgs|cgc|grade)\s+[\d.]+$/i;
    const gradeMatch = trimmed.match(gradePattern);
    const withoutGrade = gradeMatch
      ? trimmed.slice(0, gradeMatch.index).trim()
      : trimmed;
    const gradeSuffix = gradeMatch ? gradeMatch[0] : '';

    // Exact match (case-insensitive)
    const exactMatch = this.aliasMap.get(withoutGrade.toLowerCase());
    if (exactMatch) {
      return exactMatch + gradeSuffix;
    }

    // Pattern match (first wins)
    for (const pattern of this.aliasPatterns) {
      if (pattern.match.test(withoutGrade)) {
        return withoutGrade.replace(pattern.match, pattern.expand) + gradeSuffix;
      }
    }

    return query;
  }

  async resolve(query: string): Promise<ResolveResult> {
    await this.loadAliases();
    const expanded = this.expandAlias(query);
    const normalized = this.normalizeQuery(expanded);

    try {
      const response = await this.callParseTitle(normalized);
      let candidates = this.buildCandidates(response, query);

      // Fallback: if parse-title returned no matches, try the search endpoint
      if (candidates.length === 0) {
        const searchQuery = this.buildSearchQuery(response, normalized);
        if (searchQuery) {
          const searchResponse = await this.callSearchCards(searchQuery);
          candidates = this.buildSearchCandidates(searchResponse, query);
        }
      }

      if (candidates.length === 0) {
        return {
          success: false,
          candidates: [],
          originalQuery: query,
          needsDisambiguation: false,
        };
      }
      const bestMatch = candidates[0]?.card;
      const confidence = bestMatch?.confidence ?? 0;

      // Two-tier confidence gate:
      // >= AUTO_PROCEED_THRESHOLD (0.85): auto-proceed
      // >= DISAMBIGUATE_THRESHOLD (0.70): needs disambiguation
      // < DISAMBIGUATE_THRESHOLD: no match
      if (confidence >= AUTO_PROCEED_THRESHOLD) {
        return {
          success: true,
          bestMatch,
          candidates,
          originalQuery: query,
          needsDisambiguation: false,
        };
      }

      if (confidence >= DISAMBIGUATE_THRESHOLD) {
        return {
          success: false,
          bestMatch: undefined,
          candidates,
          originalQuery: query,
          needsDisambiguation: true,
          disambiguationReason: `Confidence ${(confidence * 100).toFixed(0)}% is below auto-proceed threshold (${(AUTO_PROCEED_THRESHOLD * 100).toFixed(0)}%)`,
        };
      }

      return {
        success: false,
        bestMatch: undefined,
        candidates,
        originalQuery: query,
        needsDisambiguation: false,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(`[CardResolver] ${message}`);
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
    grader: Grader = 'PSA',
  ): Promise<ResolveResult> {
    // Append grade info to help the parser if not already present
    const gradePattern = /\b(psa|bgs|cgc|sgc)\s*\d+/i;
    const queryWithGrade = gradePattern.test(query)
      ? query
      : `${query} ${grader} ${grade}`;
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

      // Only apply the parsed variant to a candidate if its own name/rarity
      // already contains that variant. This prevents e.g. "ex" being applied
      // to "Tohoku's Pikachu" just because the query contained "ex".
      const candidateVariant = this.candidateMatchesVariant(variant, match)
        ? variant
        : undefined;

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
          variant: candidateVariant,
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
      const sku = (setCode !== 'unknown' && number !== 'unknown')
        ? computeSKU(setCode, number) || undefined
        : undefined;

      candidates.push({
        card: {
          id,
          name: match.name,
          setName: match.setName ?? 'Unknown Set',
          setCode,
          number,
          year: match.year ?? extractedYear,
          rarity: match.rarity,
          variant: candidateVariant,
          confidence,
          sku,
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

  private candidateMatchesVariant(
    parsedVariant: string | undefined,
    match: { name: string; rarity?: string },
  ): boolean {
    if (!parsedVariant) return false;
    const combined = this.normalizeForMatch(
      `${match.name} ${match.rarity ?? ''}`,
    );
    return this.detectVariant(combined) === parsedVariant.toLowerCase();
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

    // Penalize candidates with zero name-token overlap with the query.
    // e.g. "MEGA LATIAS EX" has zero overlap with "Tohoku's Pikachu".
    const nameTokens = normalizedName.split(/\s+/).filter((t) => t.length > 1);
    if (nameTokens.length > 0) {
      const nameOverlap = nameTokens.filter((t) => normalizedQuery.includes(t));
      if (nameOverlap.length === 0) {
        adjustment -= 0.25;
      }
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

    // Number-match boost: reduced when there's no name overlap to prevent
    // number-only matches from winning over name-matching candidates.
    const hasNameOverlap = nameTokens.length > 0 &&
      nameTokens.some((t) => normalizedQuery.includes(t));
    const numberHints = this.extractNumberHints(normalizedQuery);
    if (numberHints.some((hint) => normalizedNumber.includes(hint))) {
      adjustment += hasNameOverlap ? 0.18 : 0.06;
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
      'sgc',
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

  async enrichCandidatesWithImages(
    candidates: CardCandidate[],
  ): Promise<CardCandidate[]> {
    const top = candidates.slice(0, 5);
    const enriched = await Promise.all(
      top.map(async (candidate) => {
        if (candidate.card.imageUrl) return candidate;
        const imageUrl = await this.fetchImageUrl(candidate.card);
        if (!imageUrl) return candidate;
        return {
          ...candidate,
          card: { ...candidate.card, imageUrl },
        };
      }),
    );
    return [...enriched, ...candidates.slice(5)];
  }

  async fetchImageUrl(card: Pick<ResolvedCard, 'id' | 'name' | 'setName' | 'number'>): Promise<string | null> {
    try {
      // Fast path: exact lookup by numeric tcgPlayerId when available.
      if (/^\d+$/.test(card.id)) {
        const idData = await this.fetchCardLookupData(`tcgPlayerId=${encodeURIComponent(card.id)}`);
        const idImage = this.extractImageUrl(idData);
        if (idImage) return idImage;
      }

      // Fallback: search by identity terms when parse-title ids are not resolvable.
      const query = this.buildImageSearchQuery(card);
      if (!query) return null;
      const searchData = await this.fetchCardLookupData(
        `search=${encodeURIComponent(query)}`,
      );
      const searchImage = this.extractImageUrl(searchData);
      if (searchImage) return searchImage;

      // Final fallback: tcgplayer CDN image pattern for numeric product ids.
      if (/^\d+$/.test(card.id)) {
        return `https://tcgplayer-cdn.tcgplayer.com/product/${card.id}_in_200x200.jpg`;
      }
      return null;
    } catch {
      return null;
    }
  }

  private buildImageSearchQuery(
    card: Pick<ResolvedCard, 'name' | 'setName' | 'number'>,
  ): string {
    const parts = [card.name];
    if (card.setName && card.setName !== 'Unknown Set') {
      parts.push(card.setName);
    }
    if (card.number && card.number !== 'unknown') {
      parts.push(card.number);
    }
    return parts.join(' ').trim();
  }

  private async fetchCardLookupData(query: string): Promise<CardLookupResponse['data']> {
    const url = `${this.baseUrl}/api/v2/cards?${query}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as CardLookupResponse;
    return body.data;
  }

  private extractImageUrl(data: CardLookupResponse['data']): string | null {
    if (!data) return null;
    if (Array.isArray(data)) {
      return data[0]?.imageUrl ?? null;
    }
    return data.imageUrl ?? null;
  }

  private buildSearchQuery(
    parseTitleResponse: ParseTitleApiResponse,
    normalizedQuery: string,
  ): string | null {
    // Prefer cardName from parse-title's parsed data if available
    const v2 = parseTitleResponse as ParseTitleV2Response;
    let searchText = v2.data?.parsed?.cardName ?? normalizedQuery;

    // Strip grade-related terms (the search endpoint doesn't use them)
    searchText = searchText
      .replace(/\b(psa|bgs|cgc|sgc)\s*[\d.]+\b/gi, '')
      .replace(/\bgrade\s*\d+\b/gi, '')
      .trim();

    return searchText.length > 0 ? searchText : null;
  }

  private async callSearchCards(query: string): Promise<SearchCardsResponse> {
    const url = `${this.baseUrl}/api/v2/cards?search=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!res.ok) {
      throw new Error(
        `PokemonPriceTracker search API error: ${res.status} ${res.statusText}`,
      );
    }

    return res.json() as Promise<SearchCardsResponse>;
  }

  private buildSearchCandidates(
    response: SearchCardsResponse,
    originalQuery: string,
  ): CardCandidate[] {
    const candidates: CardCandidate[] = [];
    const results = response.data ?? [];
    const extractedYear = this.extractYear(originalQuery);

    for (const [index, item] of results.entries()) {
      if (!item?.name) continue;

      const setCode = item.setId != null ? String(item.setId) : 'unknown';
      const number = item.cardNumber ?? 'unknown';
      const id =
        item.tcgPlayerId != null
          ? String(item.tcgPlayerId)
          : `${setCode}:${number}:${item.name}`;

      const baseConfidence = 0.6;
      const relevanceAdjustment = this.computeRelevanceAdjustment(
        originalQuery,
        {
          name: item.name,
          setName: item.setName,
          cardNumber: item.cardNumber,
        },
        index,
      );
      const confidence = this.clampConfidence(
        baseConfidence + relevanceAdjustment,
      );

      const searchSku = (setCode !== 'unknown' && number !== 'unknown')
        ? computeSKU(setCode, number) || undefined
        : undefined;

      candidates.push({
        card: {
          id,
          name: item.name,
          setName: item.setName ?? 'Unknown Set',
          setCode,
          number,
          year: extractedYear,
          rarity: item.rarity,
          imageUrl: item.imageUrl,
          confidence,
          sku: searchSku,
        },
        confidence,
        matchReason: 'Match from search fallback',
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
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
