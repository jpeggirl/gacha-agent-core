import { randomUUID } from 'node:crypto';
import type { InventoryItem, Grader } from '../types/index.js';
import type { SetAliasRegistry } from '../search/set-aliases.js';
import { computeSKU } from '../search/sku.js';

const VALID_GRADERS = new Set<string>(['PSA', 'BGS', 'CGC', 'SGC']);

export interface ParseResult {
  items: InventoryItem[];
  errors: string[];
}

/**
 * Extract numeric grade from PSA grade text.
 * e.g. "GEM MT 10" → 10, "MINT 9" → 9, "NM-MT+ 8.5" → 8.5
 */
export function parseGradeNumber(gradeText: string): number {
  const match = gradeText.match(/(\d+(?:\.\d+)?)\s*$/);
  return match ? parseFloat(match[1]!) : NaN;
}

/**
 * Parse a Gacha DB export CSV (22K+ rows with uuid, details JSON blob).
 * Filters to only PSA cards (cardId starts with "psa-") that are enabled.
 */
export function parseGachaExportCSV(csvContent: string, registry?: SetAliasRegistry): ParseResult {
  const lines = csvContent.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { items: [], errors: ['CSV must have a header row and at least one data row'] };
  }

  const header = parseCSVLine(lines[0]!);
  const columnMap = buildColumnMap(header);

  const requiredColumns = ['uuid', 'cardid', 'value', 'enabled', 'details'];
  const missing = requiredColumns.filter((c) => columnMap[c] === undefined);
  if (missing.length > 0) {
    return { items: [], errors: [`Missing required columns: ${missing.join(', ')}`] };
  }

  const items: InventoryItem[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const rowNum = i + 1;

    try {
      const cardId = getField(fields, columnMap, 'cardid')?.trim() ?? '';
      if (!cardId.startsWith('psa-')) continue; // Skip mystery cards

      const enabled = getField(fields, columnMap, 'enabled')?.trim();
      if (enabled !== 'true') continue; // Skip disabled cards

      const detailsRaw = getField(fields, columnMap, 'details')?.trim() ?? '';
      if (!detailsRaw) {
        errors.push(`Row ${rowNum}: empty details`);
        continue;
      }

      let details: Record<string, unknown>;
      try {
        details = JSON.parse(detailsRaw);
      } catch {
        errors.push(`Row ${rowNum}: invalid JSON in details`);
        continue;
      }

      const name = (details.name as string | undefined)?.trim();
      if (!name) {
        errors.push(`Row ${rowNum}: missing name in details`);
        continue;
      }

      const gradeText = (details.grade as string | undefined)?.trim() ?? '';
      const grade = parseGradeNumber(gradeText);
      if (isNaN(grade) || grade < 1 || grade > 10) {
        errors.push(`Row ${rowNum}: invalid grade "${gradeText}"`);
        continue;
      }

      const valueStr = getField(fields, columnMap, 'value')?.trim();
      const price = valueStr ? parseFloat(valueStr) : NaN;
      if (isNaN(price) || price < 0) {
        errors.push(`Row ${rowNum}: invalid value "${valueStr}"`);
        continue;
      }

      const gradingService = ((details.gradingService as string) ?? 'PSA').toUpperCase();
      const grader: Grader = VALID_GRADERS.has(gradingService) ? (gradingService as Grader) : 'PSA';

      const yearStr = details.year as string | undefined;
      const year = yearStr ? parseInt(yearStr, 10) : undefined;

      const totalPopulation = details.totalPopulation as number | undefined;

      const createdAt = getField(fields, columnMap, 'createdat')?.trim() ?? new Date().toISOString();

      const setName = (details.setName as string | undefined)?.trim() ?? '';
      const cardNumber = (details.cardNumber as string | undefined)?.trim() ?? '';

      // Compute SKU if registry is available
      let sku: string | undefined;
      if (registry && setName && cardNumber) {
        const setMatch = registry.lookup(setName);
        if (setMatch) {
          sku = computeSKU(setMatch.setCode, cardNumber) || undefined;
        }
      }

      items.push({
        id: getField(fields, columnMap, 'uuid')?.trim() ?? randomUUID(),
        name,
        setName,
        number: cardNumber,
        grade,
        grader,
        price,
        quantity: 1,
        imageUrl: (details.img as string | undefined) || undefined,
        variant: (details.variety as string | undefined)?.trim() || undefined,
        certNumber: (details.certNumber as string | undefined)?.trim() || undefined,
        populationCount: typeof totalPopulation === 'number' ? totalPopulation : undefined,
        year: year && !isNaN(year) ? year : undefined,
        sku,
        status: 'available',
        createdAt,
      });
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { items, errors };
}

export function parseInventoryCSV(csvContent: string, registry?: SetAliasRegistry): ParseResult {
  const lines = csvContent.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { items: [], errors: ['CSV must have a header row and at least one data row'] };
  }

  const header = parseCSVLine(lines[0]!);
  const columnMap = buildColumnMap(header);

  const requiredColumns = ['name', 'grade', 'price'];
  const missing = requiredColumns.filter((c) => columnMap[c] === undefined);
  if (missing.length > 0) {
    return { items: [], errors: [`Missing required columns: ${missing.join(', ')}`] };
  }

  const items: InventoryItem[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const rowNum = i + 1;

    try {
      const name = getField(fields, columnMap, 'name')?.trim();
      if (!name) {
        errors.push(`Row ${rowNum}: missing name`);
        continue;
      }

      const gradeStr = getField(fields, columnMap, 'grade')?.trim();
      const grade = gradeStr ? parseFloat(gradeStr) : NaN;
      if (isNaN(grade) || grade < 1 || grade > 10) {
        errors.push(`Row ${rowNum}: invalid grade "${gradeStr}"`);
        continue;
      }

      const priceStr = getField(fields, columnMap, 'price')?.trim();
      const price = priceStr ? parseFloat(priceStr.replace(/[$,]/g, '')) : NaN;
      if (isNaN(price) || price < 0) {
        errors.push(`Row ${rowNum}: invalid price "${priceStr}"`);
        continue;
      }

      const graderStr = (getField(fields, columnMap, 'grader') ?? 'PSA').trim().toUpperCase();
      const grader: Grader = VALID_GRADERS.has(graderStr) ? (graderStr as Grader) : 'PSA';

      const quantityStr = getField(fields, columnMap, 'quantity')?.trim();
      const quantity = quantityStr ? parseInt(quantityStr, 10) : 1;

      const setNameVal = getField(fields, columnMap, 'set')?.trim() ?? '';
      const numberVal = getField(fields, columnMap, 'number')?.trim() ?? '';

      // Compute SKU if registry is available
      let csvSku: string | undefined;
      if (registry && setNameVal && numberVal) {
        const setMatch = registry.lookup(setNameVal);
        if (setMatch) {
          csvSku = computeSKU(setMatch.setCode, numberVal) || undefined;
        }
      }

      items.push({
        id: randomUUID(),
        name,
        setName: setNameVal,
        number: numberVal,
        grade,
        grader,
        price,
        quantity: isNaN(quantity) || quantity < 1 ? 1 : quantity,
        imageUrl: getField(fields, columnMap, 'image_url')?.trim() || undefined,
        variant: getField(fields, columnMap, 'variant')?.trim() || undefined,
        certNumber: getField(fields, columnMap, 'cert_number')?.trim() || undefined,
        sku: csvSku,
        status: 'available',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      errors.push(`Row ${rowNum}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { items, errors };
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function buildColumnMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    const col = header[i]!.trim().toLowerCase().replace(/\s+/g, '_');
    map[col] = i;
  }
  return map;
}

function getField(
  fields: string[],
  columnMap: Record<string, number>,
  column: string,
): string | undefined {
  const idx = columnMap[column];
  if (idx === undefined) return undefined;
  return fields[idx];
}
