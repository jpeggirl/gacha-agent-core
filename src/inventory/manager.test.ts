import { describe, it, expect, beforeEach } from 'vitest';
import { InventoryManager } from './manager.js';
import { parseGachaExportCSV, parseGradeNumber } from './csv-parser.js';
import type { StorageAdapter, ResolvedCard } from '../types/index.js';

// In-memory storage for testing
class MemoryStorage implements StorageAdapter {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    const val = this.data.get(key);
    return val !== undefined ? (val as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return Array.from(this.data.keys()).filter((k) => k.startsWith(prefix));
  }
}

const SAMPLE_CSV = `name,set,number,grade,grader,price,quantity,variant,cert_number,image_url
Charizard,Base Set,4/102,10,PSA,42000,1,Holo,,
Pikachu,Van Gogh Promo,085,10,PSA,1500,1,Felt Hat,,
Sylveon VMAX,Evolving Skies,212/203,10,PSA,240,3,Alt Art,,
Blastoise,Base Set,2/102,9,BGS,4200,1,Holo,,`;

describe('InventoryManager', () => {
  let storage: MemoryStorage;
  let manager: InventoryManager;

  beforeEach(() => {
    storage = new MemoryStorage();
    manager = new InventoryManager(storage);
  });

  describe('importFromCSV', () => {
    it('imports valid CSV rows', async () => {
      const result = await manager.importFromCSV(SAMPLE_CSV);
      expect(result.imported).toBe(4);
      expect(result.errors).toHaveLength(0);
    });

    it('returns items with correct fields', async () => {
      await manager.importFromCSV(SAMPLE_CSV);
      const items = await manager.getAll();
      const charizard = items.find((i) => i.name === 'Charizard');

      expect(charizard).toBeDefined();
      expect(charizard!.setName).toBe('Base Set');
      expect(charizard!.number).toBe('4/102');
      expect(charizard!.grade).toBe(10);
      expect(charizard!.grader).toBe('PSA');
      expect(charizard!.price).toBe(42000);
      expect(charizard!.quantity).toBe(1);
      expect(charizard!.variant).toBe('Holo');
      expect(charizard!.status).toBe('available');
    });

    it('reports errors for invalid rows', async () => {
      const csv = `name,grade,price
ValidCard,10,100
,10,100
BadGrade,15,100
BadPrice,10,-5`;

      const result = await manager.importFromCSV(csv);
      expect(result.imported).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects CSV with missing required columns', async () => {
      const csv = `foo,bar\n1,2`;
      const result = await manager.importFromCSV(csv);
      expect(result.imported).toBe(0);
      expect(result.errors[0]).toContain('Missing required columns');
    });

    it('rejects CSV with too few rows', async () => {
      const result = await manager.importFromCSV('name,grade,price');
      expect(result.imported).toBe(0);
      expect(result.errors[0]).toContain('at least one data row');
    });

    it('defaults grader to PSA when not specified', async () => {
      const csv = `name,grade,price\nTestCard,9,50`;
      await manager.importFromCSV(csv);
      const items = await manager.getAll();
      expect(items[0]!.grader).toBe('PSA');
    });

    it('defaults quantity to 1 when not specified', async () => {
      const csv = `name,grade,price\nTestCard,9,50`;
      await manager.importFromCSV(csv);
      const items = await manager.getAll();
      expect(items[0]!.quantity).toBe(1);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await manager.importFromCSV(SAMPLE_CSV);
    });

    it('finds items by name', async () => {
      const results = await manager.search('charizard');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Charizard');
    });

    it('finds items by set name', async () => {
      const results = await manager.search('base set');
      expect(results).toHaveLength(2); // Charizard + Blastoise
    });

    it('finds items by multiple terms', async () => {
      const results = await manager.search('sylveon alt art');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Sylveon VMAX');
    });

    it('returns empty for no matches', async () => {
      const results = await manager.search('mewtwo');
      expect(results).toHaveLength(0);
    });

    it('splits "/" so "fa/eevee" matches items with "eevee"', async () => {
      // Sylveon VMAX has "Evolving Skies" set — "evolving" should match
      const results = await manager.search('evolving/skies');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Sylveon VMAX');
    });

    it('strips "#" so "#212" matches number "212/203"', async () => {
      const results = await manager.search('#212');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('Sylveon VMAX');
    });

    it('treats "pokemon" as stopword', async () => {
      // "pokemon base set" should match same as "base set" (2 items)
      const results = await manager.search('pokemon base set');
      expect(results).toHaveLength(2);
    });
  });

  describe('matchCard', () => {
    beforeEach(async () => {
      await manager.importFromCSV(SAMPLE_CSV);
    });

    it('matches by card name', async () => {
      const card: ResolvedCard = {
        id: '1', name: 'Charizard', setName: 'Base Set', setCode: 'BS',
        number: '4/102', year: 1999, confidence: 1,
      };
      const results = await manager.matchCard(card);
      expect(results).toHaveLength(1);
    });

    it('filters by grade', async () => {
      const card: ResolvedCard = {
        id: '1', name: 'Blastoise', setName: 'Base Set', setCode: 'BS',
        number: '2/102', year: 1999, confidence: 1,
      };
      const results10 = await manager.matchCard(card, 10);
      expect(results10).toHaveLength(0);

      const results9 = await manager.matchCard(card, 9);
      expect(results9).toHaveLength(1);
    });

    it('filters by grader', async () => {
      const card: ResolvedCard = {
        id: '1', name: 'Blastoise', setName: 'Base Set', setCode: 'BS',
        number: '2/102', year: 1999, confidence: 1,
      };
      const resultsPSA = await manager.matchCard(card, undefined, 'PSA');
      expect(resultsPSA).toHaveLength(0);

      const resultsBGS = await manager.matchCard(card, undefined, 'BGS');
      expect(resultsBGS).toHaveLength(1);
    });
  });

  describe('getAvailable', () => {
    it('only returns available items', async () => {
      await manager.importFromCSV(SAMPLE_CSV);
      const items = await manager.getAvailable();
      expect(items).toHaveLength(4);
      expect(items.every((i) => i.status === 'available')).toBe(true);
    });
  });

  describe('importFromCSV — Gacha export format', () => {
    const GACHA_CSV = [
      'uuid,createdAt,cardId,nftId,value,enabled,details,mintedAt,setId,updatedAt,gradeId,lang,owner',
      '11111111-aaaa-bbbb-cccc-dddddddddddd,2025-09-18 07:24:42+00,psa-112139421,,20.21,true,"{""img"":""https://example.com/img.jpg"",""name"":""CHARIZARD V"",""year"":""2020"",""grade"":""GEM MT 10"",""psaId"":""112139421"",""setName"":""POKEMON SWSH BLACK STAR PROMO"",""variety"":""CHMPN.PATH"",""cardNumber"":""050"",""certNumber"":""112139421"",""gradingService"":""PSA"",""totalPopulation"":29069,""populationHigher"":47630}",,psa,,112139421,en,',
      '22222222-aaaa-bbbb-cccc-dddddddddddd,2025-10-07 10:36:51+00,psa-126646408,,25.13,true,"{""img"":""https://example.com/pika.jpg"",""name"":""PIKACHU"",""year"":""2022"",""grade"":""NM-MT 8"",""psaId"":""126646408"",""setName"":""POKEMON JAPANESE SV PROMO"",""variety"":""SCARLET/VIOLET"",""cardNumber"":""001"",""certNumber"":""126646408"",""gradingService"":""PSA"",""totalPopulation"":2711,""populationHigher"":67505}",,psa,,126646408,en,',
      // Mystery card — should be filtered out
      '33333333-aaaa-bbbb-cccc-dddddddddddd,2025-09-30 21:25:41+00,mystery,23537,0.01,true,"{""img"":""https://example.com/myst.jpg"",""name"":""Corphish"",""types"":[]}",,,,en,',
      // Disabled PSA card — should be filtered out
      '44444444-aaaa-bbbb-cccc-dddddddddddd,2025-09-18 07:24:42+00,psa-999999999,,64,false,"{""img"":""https://example.com/kab.jpg"",""name"":""KABUTOPS"",""year"":""1999"",""grade"":""MINT 9"",""setName"":""POKEMON FOSSIL"",""variety"":""1ST EDITION"",""cardNumber"":""24"",""certNumber"":""999999999"",""gradingService"":""PSA"",""totalPopulation"":600,""populationHigher"":337}",,psa,,999999999,en,',
    ].join('\n');

    it('auto-detects Gacha export format and imports PSA cards', async () => {
      const result = await manager.importFromCSV(GACHA_CSV);
      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('maps Gacha export fields correctly', async () => {
      await manager.importFromCSV(GACHA_CSV);
      const items = await manager.getAll();
      const charizard = items.find((i) => i.name === 'CHARIZARD V');

      expect(charizard).toBeDefined();
      expect(charizard!.id).toBe('11111111-aaaa-bbbb-cccc-dddddddddddd');
      expect(charizard!.setName).toBe('POKEMON SWSH BLACK STAR PROMO');
      expect(charizard!.number).toBe('050');
      expect(charizard!.grade).toBe(10);
      expect(charizard!.grader).toBe('PSA');
      expect(charizard!.price).toBe(20.21);
      expect(charizard!.quantity).toBe(1);
      expect(charizard!.variant).toBe('CHMPN.PATH');
      expect(charizard!.certNumber).toBe('112139421');
      expect(charizard!.imageUrl).toBe('https://example.com/img.jpg');
      expect(charizard!.year).toBe(2020);
      expect(charizard!.populationCount).toBe(29069);
      expect(charizard!.status).toBe('available');
    });

    it('filters out mystery cards', async () => {
      const result = await manager.importFromCSV(GACHA_CSV);
      const items = await manager.getAll();
      expect(items.find((i) => i.name === 'Corphish')).toBeUndefined();
      expect(result.imported).toBe(2);
    });

    it('filters out disabled cards', async () => {
      await manager.importFromCSV(GACHA_CSV);
      const items = await manager.getAll();
      expect(items.find((i) => i.name === 'KABUTOPS')).toBeUndefined();
    });
  });
});

describe('parseGradeNumber', () => {
  it.each([
    ['GEM MT 10', 10],
    ['MINT 9', 9],
    ['NM-MT 8', 8],
    ['NM-MT+ 8.5', 8.5],
    ['NM 7', 7],
    ['EX-MT 6', 6],
    ['EX 5', 5],
    ['VG-EX 4', 4],
    ['VG 3', 3],
  ])('parses "%s" → %d', (text, expected) => {
    expect(parseGradeNumber(text)).toBe(expected);
  });

  it('returns NaN for invalid grade text', () => {
    expect(parseGradeNumber('UNKNOWN')).toBeNaN();
    expect(parseGradeNumber('')).toBeNaN();
  });
});

describe('parseGachaExportCSV', () => {
  it('returns error for CSV with missing required columns', () => {
    const csv = 'name,grade,price\nfoo,10,100';
    const result = parseGachaExportCSV(csv);
    expect(result.imported).toBeUndefined;
    expect(result.items).toHaveLength(0);
    expect(result.errors[0]).toContain('Missing required columns');
  });

  it('returns error for too few rows', () => {
    const csv = 'uuid,createdAt,cardId,nftId,value,enabled,details';
    const result = parseGachaExportCSV(csv);
    expect(result.items).toHaveLength(0);
    expect(result.errors[0]).toContain('at least one data row');
  });

  it('reports error for row with invalid JSON in details', () => {
    const csv = [
      'uuid,createdAt,cardId,nftId,value,enabled,details',
      'aaa-bbb,2025-01-01,psa-123,,10,true,not-json',
    ].join('\n');
    const result = parseGachaExportCSV(csv);
    expect(result.items).toHaveLength(0);
    expect(result.errors[0]).toContain('invalid JSON');
  });
});
