import { SchemaType, type FunctionDeclaration } from '@google/generative-ai';

export const TOOL_DEFINITIONS: FunctionDeclaration[] = [
  {
    name: 'resolve_card',
    description:
      'Identify a Pokemon card from a natural language description. Use this when the user mentions a card by name, set, or number. Returns the resolved card with ID, name, set, number, and confidence score. If disambiguation is needed, returns multiple candidates for the user to choose from.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: 'Natural language card description, e.g. "Charizard Base Set 4/102" or "pikachu gold star"',
        } as const,
      },
      required: ['query'],
    },
  },
  {
    name: 'get_price',
    description:
      'Get the fair market value (FMV) for a graded Pokemon card. Requires a card ID from resolve_card. Returns pricing data including FMV, grade, grader, and pricing source.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        card_id: {
          type: SchemaType.STRING,
          description: 'The card ID from resolve_card result',
        } as const,
        card_name: {
          type: SchemaType.STRING,
          description: 'The card name for display purposes',
        } as const,
        card_number: {
          type: SchemaType.STRING,
          description: 'The card number (e.g. "4/102")',
        } as const,
        grade: {
          type: SchemaType.NUMBER,
          description: 'PSA/BGS/CGC grade (1-10). Default 9.',
        } as const,
        grader: {
          type: SchemaType.STRING,
          description: 'Grading company: PSA, BGS, CGC, or SGC. Default PSA.',
        } as const,
      },
      required: ['card_id', 'card_name', 'card_number'],
    },
  },
  {
    name: 'search_ebay',
    description:
      'Search eBay for active listings of a graded Pokemon card and score them as deals. Use after resolve_card to find deals. Returns scored listings with deal signals (strong_buy, buy, fair, overpriced, avoid).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        card_id: {
          type: SchemaType.STRING,
          description: 'The card ID from resolve_card result',
        } as const,
        card_name: {
          type: SchemaType.STRING,
          description: 'The card name',
        } as const,
        set_name: {
          type: SchemaType.STRING,
          description: 'The card set name',
        } as const,
        card_number: {
          type: SchemaType.STRING,
          description: 'The card number',
        } as const,
        grade: {
          type: SchemaType.NUMBER,
          description: 'PSA/BGS/CGC grade (1-10). Default 9.',
        } as const,
        grader: {
          type: SchemaType.STRING,
          description: 'Grading company: PSA, BGS, CGC, or SGC. Default PSA.',
        } as const,
      },
      required: ['card_id', 'card_name', 'card_number'],
    },
  },
  {
    name: 'check_inventory',
    description:
      "Check if Gacha has a Pokemon card in stock. Use this when users ask about buying from Gacha, what's available, or if we have a specific card. Returns matching inventory items with prices.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: 'Search query — card name, set name, or general text',
        } as const,
        grade: {
          type: SchemaType.NUMBER,
          description: 'Optional grade filter',
        } as const,
        grader: {
          type: SchemaType.STRING,
          description: 'Optional grader filter: PSA, BGS, CGC, or SGC.',
        } as const,
      },
      required: ['query'],
    },
  },
];
