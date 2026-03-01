import 'dotenv/config';

async function test() {
  const appId = process.env.EBAY_APP_ID!;
  const certId = process.env.EBAY_CERT_ID!;
  const sandbox = process.env.EBAY_SANDBOX === 'true';

  const baseApi = sandbox
    ? 'https://api.sandbox.ebay.com'
    : 'https://api.ebay.com';

  console.log('App ID:', appId);
  console.log('Sandbox:', sandbox);
  console.log('Base API:', baseApi);

  // Get token
  const credentials = Buffer.from(`${appId}:${certId}`).toString('base64');
  const tokenRes = await fetch(`${baseApi}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });

  console.log('Token status:', tokenRes.status);
  if (tokenRes.status !== 200) {
    console.log('Token error:', await tokenRes.text());
    return;
  }

  const token = (await tokenRes.json()) as { access_token: string };
  console.log('Got token:', token.access_token.substring(0, 20) + '...');

  // ─── Test 1: Query WITHOUT card number (our fix) ───
  const queryFixed = 'Pikachu Grey Felt Hat PSA 10';
  console.log('\n=== Test 1: WITHOUT card number (FIX) ===');
  console.log('Query:', queryFixed);

  const res1 = await searchEbay(baseApi, token.access_token, queryFixed);
  console.log('Total results:', res1.total ?? 0);
  console.log('Items returned:', res1.itemSummaries?.length ?? 0);
  printTopResults(res1);

  // ─── Test 2: Query WITH card number (old behavior) ───
  const queryOld = 'Pikachu Grey Felt Hat 085 PSA 10';
  console.log('\n=== Test 2: WITH card number "085" (OLD) ===');
  console.log('Query:', queryOld);

  const res2 = await searchEbay(baseApi, token.access_token, queryOld);
  console.log('Total results:', res2.total ?? 0);
  console.log('Items returned:', res2.itemSummaries?.length ?? 0);
  printTopResults(res2);

  // ─── Comparison ───
  console.log('\n=== COMPARISON ===');
  console.log(`Without card number: ${res1.total ?? 0} results`);
  console.log(`With card number:    ${res2.total ?? 0} results`);
}

interface EbaySearchResult {
  total?: number;
  itemSummaries?: Array<{ title: string; price?: { value: string } }>;
  warnings?: unknown[];
  errors?: unknown[];
}

async function searchEbay(
  baseApi: string,
  accessToken: string,
  query: string,
): Promise<EbaySearchResult> {
  const params = new URLSearchParams({
    q: query,
    limit: '10',
    sort: 'price',
  });

  const res = await fetch(
    `${baseApi}/buy/browse/v1/item_summary/search?${params}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Content-Type': 'application/json',
      },
    },
  );

  console.log('Search status:', res.status);
  const data = (await res.json()) as EbaySearchResult;

  if (data.warnings) console.log('Warnings:', JSON.stringify(data.warnings, null, 2));
  if (data.errors) console.log('Errors:', JSON.stringify(data.errors, null, 2));

  return data;
}

function printTopResults(data: EbaySearchResult) {
  if (data.itemSummaries && data.itemSummaries.length > 0) {
    console.log('First 5 results:');
    for (const item of data.itemSummaries.slice(0, 5)) {
      console.log(`  - $${item.price?.value ?? '?'} | ${item.title}`);
    }
  }
}

test().catch(console.error);
