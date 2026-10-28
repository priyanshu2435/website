'use strict';

const MAX_SEARCH_QUERIES = 3;
const MIN_PRIMARY_RESULTS_BEFORE_EXPANSION = 8;
const MIN_RELEVANCE_SCORE = 18;

const COMMON_CORRECTIONS = {
  bluetooh: 'bluetooth',
  blutooth: 'bluetooth',
  earbudz: 'earbuds',
  gamng: 'gaming',
  headphons: 'headphones',
  hedphones: 'headphones',
  iphon: 'iphone',
  lapotp: 'laptop',
  samsng: 'samsung',
  samsun: 'samsung',
  shooes: 'shoes',
  shose: 'shoes'
};

const QUERY_EXPANSIONS = [
  {
    pattern: /\brunning shoes?\b/,
    replacements: ['running sneakers', 'jogging shoes']
  },
  {
    pattern: /\bshoes?\b/,
    replacements: ['sneakers', 'running shoes']
  },
  {
    pattern: /\bmobile\b/,
    replacements: ['smartphone', 'mobile phone']
  },
  {
    pattern: /\bphones?\b/,
    replacements: ['smartphone', 'mobile phone']
  },
  {
    pattern: /\bwireless earbuds?\b/,
    replacements: ['Bluetooth earbuds', 'TWS earbuds']
  },
  {
    pattern: /\bearbuds?\b/,
    replacements: ['wireless earbuds', 'Bluetooth earbuds']
  },
  {
    pattern: /\bgaming mice\b/,
    replacements: ['gaming mouse', 'mouse for gaming']
  },
  {
    pattern: /\bgaming mouse\b/,
    replacements: ['gaming mice', 'mouse for gaming']
  },
  {
    pattern: /\bmice\b/,
    replacements: ['mouse']
  },
  {
    pattern: /\blaptops?\b/,
    replacements: ['notebook', 'notebook computer']
  }
];

const SYNONYM_GROUPS = [
  ['shoe', 'sneaker', 'trainer'],
  ['phone', 'smartphone', 'mobile', 'cellphone'],
  ['wireless', 'bluetooth'],
  ['earbud', 'airpod', 'tws'],
  ['laptop', 'notebook'],
  ['mouse', 'mice']
];

const BRANDS = new Set([
  'acer', 'adidas', 'apple', 'asus', 'boat', 'dell', 'hp', 'honor',
  'huawei', 'lenovo', 'lg', 'logitech', 'motorola', 'nike', 'oneplus',
  'oppo', 'puma', 'realme', 'samsung', 'sony', 'xiaomi'
]);

function normalizeQuery(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s+(gb|tb|mb|mah|hz|khz|mhz|ghz|mm|cm|kg|g|ml|l)\b/g, '$1$2')
    .replace(/(\d)\.(\d)/g, '$1dot$2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function correctQuery(normalizedQuery) {
  return normalizedQuery
    .split(' ')
    .map((token) => COMMON_CORRECTIONS[token] || token)
    .join(' ');
}

function buildSearchQueries(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const queries = [{ query: normalized, kind: 'original' }];
  const corrected = correctQuery(normalized);
  const candidates = [];

  if (corrected !== normalized) {
    candidates.push({ query: corrected, kind: 'correction' });
  }

  for (const expansion of QUERY_EXPANSIONS) {
    if (!expansion.pattern.test(corrected)) continue;

    for (const replacement of expansion.replacements) {
      const expanded = corrected.replace(expansion.pattern, replacement);
      if (expanded !== corrected) {
        candidates.push({ query: normalizeQuery(expanded), kind: 'category' });
      }
    }
  }

  const seen = new Set([normalized]);
  for (const candidate of candidates) {
    if (seen.has(candidate.query)) continue;
    seen.add(candidate.query);
    queries.push(candidate);
    if (queries.length === MAX_SEARCH_QUERIES) break;
  }

  return queries;
}

function tokenize(value) {
  return normalizeQuery(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      if (token === 'mice') return 'mouse';
      if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
      if (token.endsWith('s') && token.length > 4 && !token.endsWith('ss')) {
        return token.slice(0, -1);
      }
      return token;
    });
}

function editDistanceAtMostTwo(left, right) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 3;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;

    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost
      );
      rowMinimum = Math.min(rowMinimum, current[column]);
    }

    if (rowMinimum > 2) return 3;
    previous = current;
  }

  return previous[right.length];
}

function tokenSynonyms(token) {
  return SYNONYM_GROUPS.find((group) => group.includes(token)) || [token];
}

function getProductText(product) {
  return [
    product.name,
    product.brand,
    product.category,
    product.description
  ].filter((value) => typeof value === 'string').join(' ');
}

function scoreProduct(product, query) {
  const normalizedQuery = normalizeQuery(query);
  const queryTokens = tokenize(normalizedQuery);
  const title = normalizeQuery(product.name);
  const text = normalizeQuery(getProductText(product));
  const textTokens = new Set(tokenize(text));
  const titleTokens = new Set(tokenize(title));
  const queryTokenSet = new Set(queryTokens);

  if (!queryTokens.length || !title) return 0;

  const requiredTokens = queryTokens.filter((token) =>
    /\d/.test(token) || BRANDS.has(token)
  );
  // Never fuzzy-match a requested brand or model/specification token.
  if (requiredTokens.some((token) => !textTokens.has(token))) return 0;

  let score = title === normalizedQuery ? 120 : 0;
  if (title.includes(normalizedQuery)) score = Math.max(score, 100);

  let matchedTokens = 0;
  let exactTitleMatches = 0;
  for (const token of queryTokenSet) {
    if (textTokens.has(token)) {
      matchedTokens += 1;
      score += titleTokens.has(token) ? 17 : 12;
      if (titleTokens.has(token)) exactTitleMatches += 1;
      continue;
    }

    const synonyms = tokenSynonyms(token);
    if (synonyms.some((synonym) => textTokens.has(synonym))) {
      matchedTokens += 1;
      score += 20;
      continue;
    }

    const maxDistance = token.length >= 8 ? 2 : 1;
    const hasFuzzyMatch = [...textTokens].some((candidate) =>
      candidate.length >= 4 &&
      Math.abs(candidate.length - token.length) <= maxDistance &&
      editDistanceAtMostTwo(token, candidate) <= maxDistance
    );

    if (hasFuzzyMatch) {
      matchedTokens += 1;
      score += 19;
    }
  }

  if (matchedTokens < queryTokenSet.size) {
    score -= (queryTokenSet.size - matchedTokens) * 14;
  }

  if (matchedTokens === queryTokenSet.size && queryTokenSet.size > 1) {
    score += 18;
  }
  score += exactTitleMatches * 3;

  return score >= MIN_RELEVANCE_SCORE ? score : 0;
}

function normalizeProductUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|gclid|fbclid|ref|tag)$/.test(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return '';
  }
}

function productIdentity(product) {
  const seller = normalizeQuery(product.platform);
  if (product.providerProductId) {
    return `${seller}:id:${String(product.providerProductId).toLowerCase()}`;
  }

  const url = normalizeProductUrl(product.productUrl);
  if (url) return `${seller}:url:${url}`;

  return `${seller}:name:${normalizeQuery(product.name)}:${normalizeQuery(product.quantity)}`;
}

function rankProducts(products, query, limit = 200) {
  const unique = new Map();

  for (const product of products) {
    const score = scoreProduct(product, query);
    if (!score) continue;

    const key = productIdentity(product);
    const previous = unique.get(key);
    if (!previous || score > previous.score) {
      unique.set(key, { product, score });
    }
  }

  return [...unique.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ product }) => product);
}

async function runRelatedSearch(query, searchProvider, limit = 200) {
  const searches = buildSearchQueries(query);
  if (!searches.length) {
    return { items: [], source: 'empty', queriesSearched: 0, partialFailures: [] };
  }

  const errors = [];
  let primaryResults = [];
  try {
    primaryResults = await searchProvider(searches[0].query, { primary: true });
  } catch (error) {
    errors.push(error);
  }

  const primaryRanked = rankProducts(primaryResults, searches[0].query, limit);
  // Keep the original query first; category alternatives run only when useful.
  const needsExpansion = searches.length > 1 && (
    errors.length > 0 ||
    primaryRanked.length < MIN_PRIMARY_RESULTS_BEFORE_EXPANSION ||
    searches.some((search) => search.kind === 'category')
  );
  const secondarySearches = needsExpansion ? searches.slice(1) : [];
  const settled = await Promise.allSettled(
    secondarySearches.map((search) =>
      Promise.resolve().then(() =>
        searchProvider(search.query, { primary: false })
      )
    )
  );

  const products = [...primaryResults];
  let successfulSearches = errors.length === 0 ? 1 : 0;
  settled.forEach((result) => {
    if (result.status === 'fulfilled') {
      successfulSearches += 1;
      products.push(...result.value);
    } else {
      errors.push(result.reason);
    }
  });

  if (!successfulSearches) {
    throw errors[0] || new Error('All product searches failed.');
  }

  const items = rankProducts(products, normalizeQuery(query), limit);
  return {
    items,
    source: items.length ? 'live' : 'empty',
    queriesSearched: 1 + secondarySearches.length,
    partialFailures: errors
  };
}

module.exports = {
  buildSearchQueries,
  normalizeQuery,
  rankProducts,
  runRelatedSearch,
  scoreProduct
};
