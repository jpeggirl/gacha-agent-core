import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';

interface SetAliasEntry {
  setCode: string;
  canonicalName: string;
}

interface SetAliasFileEntry {
  canonicalName: string;
  aliases: string[];
}

type SetAliasFile = Record<string, SetAliasFileEntry>;

/**
 * Prefixes stripped from set names during normalization.
 * Order matters — longer prefixes first to avoid partial matches.
 */
const FRANCHISE_PREFIXES = ['pokemon', 'one piece'];

const LANGUAGE_PREFIXES = ['japanese', 'english', 'en', 'jp', 'jpn'];

const ERA_PREFIXES = [
  'sword & shield', 'sword and shield', 'swsh',
  'scarlet & violet', 'scarlet and violet', 'svi', 'svp', 'ssp',
  'sun & moon', 'sun and moon', 'sm',
  'xy',
  'black & white', 'black and white', 'bw',
  'diamond & pearl', 'diamond and pearl', 'dp',
  'heartgold & soulsilver', 'heartgold and soulsilver', 'hgss',
  'platinum', 'pl',
  'ex', // era prefix "EX Ruby & Sapphire" etc. — only when at start
];

/**
 * Regex to detect inline set codes like "SV2D-CLAY BURST" → extracts "sv2d" and "CLAY BURST"
 */
const INLINE_CODE_RE = /^([a-z]{2,4}\d{1,3}[a-z]?(?:pt\d)?)-(.+)$/i;

export class SetAliasRegistry {
  private aliasMap = new Map<string, SetAliasEntry>();

  constructor() {}

  /**
   * Load aliases from the JSON seed file. Call this at startup.
   */
  loadFromFile(filePath?: string): void {
    const resolvedPath = filePath ?? pathResolve(__dirname, '../../data/set-aliases.json');
    try {
      const raw = readFileSync(resolvedPath, 'utf-8');
      const data = JSON.parse(raw) as SetAliasFile;
      for (const [setCode, entry] of Object.entries(data)) {
        this.register(setCode, entry.canonicalName, entry.aliases);
      }
    } catch (err) {
      console.warn('[SetAliasRegistry] Failed to load set-aliases.json:', err);
    }
  }

  /**
   * Register a set code with its canonical name and optional aliases.
   * Each alias is normalized before insertion for O(1) lookup.
   */
  register(setCode: string, canonicalName: string, aliases?: string[]): void {
    const normalizedCode = setCode.toLowerCase();
    const entry: SetAliasEntry = { setCode: normalizedCode, canonicalName };

    // Always register the set code itself
    this.aliasMap.set(normalizedCode, entry);

    // Register canonical name
    const normalizedCanonical = SetAliasRegistry.normalize(canonicalName);
    if (normalizedCanonical) {
      this.aliasMap.set(normalizedCanonical, entry);
    }

    // Register all provided aliases
    if (aliases) {
      for (const alias of aliases) {
        const normalizedAlias = SetAliasRegistry.normalize(alias);
        if (normalizedAlias) {
          this.aliasMap.set(normalizedAlias, entry);
        }
      }
    }
  }

  /**
   * Look up a set by name, code, or alias. Returns null if not found.
   */
  lookup(setNameOrCode: string): SetAliasEntry | null {
    // Try direct code lookup first
    const directCode = setNameOrCode.toLowerCase().trim();
    const directMatch = this.aliasMap.get(directCode);
    if (directMatch) return directMatch;

    // Try normalized name lookup
    const normalized = SetAliasRegistry.normalize(setNameOrCode);
    if (normalized) {
      const normalizedMatch = this.aliasMap.get(normalized);
      if (normalizedMatch) return normalizedMatch;
    }

    // Try extracting inline code (e.g. "SV2D-CLAY BURST")
    const inlineMatch = setNameOrCode.match(INLINE_CODE_RE);
    if (inlineMatch) {
      const inlineCode = inlineMatch[1]!.toLowerCase();
      const inlineCodeMatch = this.aliasMap.get(inlineCode);
      if (inlineCodeMatch) return inlineCodeMatch;
    }

    return null;
  }

  /**
   * Normalize a set name by stripping franchise, language, era prefixes,
   * inline codes, and cleaning whitespace.
   */
  static normalize(setName: string): string {
    let result = setName.toLowerCase().trim();

    // Strip inline code prefix: "SV2D-CLAY BURST" → "clay burst"
    const inlineMatch = result.match(INLINE_CODE_RE);
    if (inlineMatch) {
      result = inlineMatch[2]!.toLowerCase().trim();
    }

    // Strip franchise prefixes
    for (const prefix of FRANCHISE_PREFIXES) {
      if (result.startsWith(prefix + ' ')) {
        result = result.slice(prefix.length).trim();
      }
    }

    // Strip language prefixes
    for (const prefix of LANGUAGE_PREFIXES) {
      if (result.startsWith(prefix + ' ')) {
        result = result.slice(prefix.length).trim();
      }
    }

    // Strip era prefixes
    for (const prefix of ERA_PREFIXES) {
      if (result.startsWith(prefix + ' ')) {
        result = result.slice(prefix.length).trim();
      }
    }

    // Collapse whitespace
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }

  /**
   * Attempt to extract a set code from an inline format like "SV2D-CLAY BURST"
   */
  static extractInlineCode(setName: string): string | null {
    const match = setName.match(INLINE_CODE_RE);
    return match ? match[1]!.toLowerCase() : null;
  }

  /** Number of registered aliases (for testing) */
  get size(): number {
    return this.aliasMap.size;
  }
}
