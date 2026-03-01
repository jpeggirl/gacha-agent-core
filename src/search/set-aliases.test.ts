import { describe, it, expect, beforeEach } from 'vitest';
import { SetAliasRegistry } from './set-aliases.js';

describe('SetAliasRegistry', () => {
  let registry: SetAliasRegistry;

  beforeEach(() => {
    registry = new SetAliasRegistry();
    // Register some test entries manually
    registry.register('swsh7', 'Evolving Skies', [
      'evolving skies',
      'sword & shield evolving skies',
      'sword and shield evolving skies',
    ]);
    registry.register('base1', 'Base Set', ['base set', 'base']);
    registry.register('sv2a', 'Pokemon 151', ['pokemon 151', '151']);
    registry.register('sv2d', 'Clay Burst', ['clay burst']);
  });

  describe('lookup', () => {
    it('finds by exact set code', () => {
      const result = registry.lookup('swsh7');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('swsh7');
      expect(result!.canonicalName).toBe('Evolving Skies');
    });

    it('finds by canonical name', () => {
      const result = registry.lookup('Evolving Skies');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('swsh7');
    });

    it('finds by alias', () => {
      const result = registry.lookup('sword & shield evolving skies');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('swsh7');
    });

    it('is case-insensitive', () => {
      const result = registry.lookup('EVOLVING SKIES');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('swsh7');
    });

    it('returns null for unknown set', () => {
      expect(registry.lookup('nonexistent set')).toBeNull();
    });

    it('finds by short alias "base"', () => {
      const result = registry.lookup('base');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('base1');
    });

    it('finds by numeric-like alias "151"', () => {
      const result = registry.lookup('151');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('sv2a');
    });
  });

  describe('normalize', () => {
    it('strips "POKEMON" prefix', () => {
      expect(SetAliasRegistry.normalize('POKEMON EVOLVING SKIES')).toBe('evolving skies');
    });

    it('strips language prefix', () => {
      expect(SetAliasRegistry.normalize('JAPANESE CLAY BURST')).toBe('clay burst');
    });

    it('strips era prefix', () => {
      expect(SetAliasRegistry.normalize('SWORD & SHIELD EVOLVING SKIES')).toBe('evolving skies');
    });

    it('strips combined franchise + era prefix', () => {
      expect(SetAliasRegistry.normalize('POKEMON SWORD & SHIELD EVOLVING SKIES')).toBe('evolving skies');
    });

    it('strips "SWORD AND SHIELD" (with "and")', () => {
      expect(SetAliasRegistry.normalize('SWORD AND SHIELD EVOLVING SKIES')).toBe('evolving skies');
    });

    it('extracts inline code "SV2D-CLAY BURST" → "clay burst"', () => {
      expect(SetAliasRegistry.normalize('SV2D-CLAY BURST')).toBe('clay burst');
    });

    it('strips "SUN & MOON" era prefix', () => {
      expect(SetAliasRegistry.normalize('SUN & MOON TEAM UP')).toBe('team up');
    });

    it('handles already-clean names', () => {
      expect(SetAliasRegistry.normalize('Evolving Skies')).toBe('evolving skies');
    });

    it('collapses extra whitespace', () => {
      expect(SetAliasRegistry.normalize('  POKEMON   BASE  SET  ')).toBe('base set');
    });
  });

  describe('extractInlineCode', () => {
    it('extracts "sv2d" from "SV2D-CLAY BURST"', () => {
      expect(SetAliasRegistry.extractInlineCode('SV2D-CLAY BURST')).toBe('sv2d');
    });

    it('extracts "sv2p" from "SV2P-SNOW HAZARD"', () => {
      expect(SetAliasRegistry.extractInlineCode('SV2P-SNOW HAZARD')).toBe('sv2p');
    });

    it('returns null for no inline code', () => {
      expect(SetAliasRegistry.extractInlineCode('Evolving Skies')).toBeNull();
    });
  });

  describe('register', () => {
    it('allows adding new sets dynamically', () => {
      registry.register('test1', 'Test Set', ['my test set']);
      const result = registry.lookup('my test set');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('test1');
      expect(result!.canonicalName).toBe('Test Set');
    });
  });

  describe('loadFromFile', () => {
    it('loads from default file path without error', () => {
      const freshRegistry = new SetAliasRegistry();
      freshRegistry.loadFromFile();
      // Should have loaded entries
      expect(freshRegistry.size).toBeGreaterThan(0);
      // Verify a known entry
      const result = freshRegistry.lookup('evolving skies');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('swsh7');
    });
  });

  describe('lookup with inline codes from inventory set names', () => {
    it('finds "POKEMON JAPANESE SV2D-CLAY BURST" via inline code extraction', () => {
      const result = registry.lookup('SV2D-CLAY BURST');
      expect(result).not.toBeNull();
      expect(result!.setCode).toBe('sv2d');
    });
  });
});
