'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildSearchQueries,
  normalizeQuery,
  rankProducts,
  runRelatedSearch
} = require('../product-search');

function product(name, details = {}) {
  return {
    name,
    platform: details.platform || 'Amazon',
    productUrl: details.productUrl || `https://www.amazon.in/dp/${name.replace(/\W+/g, '-')}`,
    quantity: details.quantity || '',
    brand: details.brand || '',
    category: details.category || '',
    description: details.description || ''
  };
}

test('normalizes case, punctuation, spacing, and storage units', () => {
  assert.equal(
    normalizeQuery('  IPHON,   15 Pro 128 GB  '),
    'iphon 15 pro 128gb'
  );
});

test('expands category phrases and common spelling corrections within the query cap', () => {
  assert.deepEqual(
    buildSearchQueries('shoes').map(({ query }) => query),
    ['shoes', 'sneakers', 'running shoes']
  );
  assert.ok(buildSearchQueries('iphon').some(({ query }) => query === 'iphone'));
  assert.ok(buildSearchQueries('samsung phone').some(({ query }) => query === 'samsung smartphone'));
  assert.ok(buildSearchQueries('wireless earbuds').some(({ query }) => query === 'bluetooth earbuds'));
  assert.ok(buildSearchQueries('gaming mouse').some(({ query }) => query === 'gaming mice'));
  assert.ok(buildSearchQueries('laptop').length <= 3);
});

test('ranks related products and excludes unrelated categories', () => {
  const ranked = rankProducts([
    product('Nike Air Zoom running shoes'),
    product('Adidas casual sneakers'),
    product('Logitech gaming mouse'),
    product('Dell laptop')
  ], 'shoes');

  assert.deepEqual(ranked.map((item) => item.name), [
    'Nike Air Zoom running shoes',
    'Adidas casual sneakers'
  ]);
});

test('keeps specific categories such as running shoes and gaming mice relevant', () => {
  assert.deepEqual(
    rankProducts([
      product('Nike running sneakers'),
      product('Logitech G502 gaming mouse'),
      product('Basic office mouse'),
      product('Dell laptop')
    ], 'running shoes').map((item) => item.name),
    ['Nike running sneakers']
  );

  assert.deepEqual(
    rankProducts([
      product('Logitech G502 gaming mouse'),
      product('Basic office mouse'),
      product('Wireless gaming keyboard')
    ], 'gaming mouse').map((item) => item.name),
    ['Logitech G502 gaming mouse']
  );
});

test('fuzzy matches a misspelling but preserves required brand and model specifications', () => {
  assert.equal(rankProducts([
    product('Apple iPhone 15 Pro 128GB')
  ], 'iphone').length, 1);
  assert.equal(rankProducts([
    product('Apple iPhone 15 Pro 128GB')
  ], 'iphon').length, 1);

  assert.equal(rankProducts([
    product('Samsung Galaxy S24 Ultra 256GB', { category: 'smartphone' }),
    product('Samsung Galaxy S24 Ultra 128GB', { category: 'smartphone' }),
    product('Google Pixel 9 Pro 256GB', { category: 'smartphone' })
  ], 'samsung phone 256gb').length, 1);

  assert.deepEqual(rankProducts([
    product('Samsung Galaxy S25 Ultra SM-S938B'),
    product('Samsung Galaxy S24 Ultra SM-S928B')
  ], 'SM-S928B').map((item) => item.name), [
    'Samsung Galaxy S24 Ultra SM-S928B'
  ]);
});

test('deduplicates the same seller URL but keeps distinct product variants', () => {
  const results = rankProducts([
    product('Samsung Galaxy S24 128GB', { productUrl: 'https://www.amazon.in/dp/phone-1?utm_source=search' }),
    product('Samsung Galaxy S24 128GB', { productUrl: 'https://www.amazon.in/dp/phone-1' }),
    product('Samsung Galaxy S24 256GB', { productUrl: 'https://www.amazon.in/dp/phone-2' })
  ], 'Samsung Galaxy S24');

  assert.equal(results.length, 2);
});

test('searches the original query first, limits expansions, and tolerates partial failures', async () => {
  const calls = [];
  const result = await runRelatedSearch('running shoes', async (query, options) => {
    calls.push({ query, options });
    if (options.primary) return [product('Nike running shoes')];
    if (query === 'running sneakers') return [product('Adidas running sneakers')];
    throw new Error('Provider temporarily unavailable');
  });

  assert.equal(calls[0].query, 'running shoes');
  assert.equal(calls.filter(({ options }) => options.primary).length, 1);
  assert.ok(calls.length <= 3);
  assert.equal(result.items.length, 2);
  assert.equal(result.partialFailures.length, 1);
  assert.equal(result.source, 'live');
});

test('returns no unrelated product for a query with no relevant results', async () => {
  const result = await runRelatedSearch('vintage telescope', async () => [
    product('Wireless Bluetooth headphones'),
    product('Running shoes')
  ]);

  assert.deepEqual(result.items, []);
  assert.equal(result.source, 'empty');
});
