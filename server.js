/**
 * QuickCompare Engine — Express + reliable product search aggregation
 */
'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const SERPAPI_KEY = (process.env.SERPAPI_KEY || '').trim();
const PRODUCT_RESULT_LIMIT = 100;
const SERPAPI_PAGE_SIZE = 50;
const SERPAPI_MAX_PAGES = 2;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const OFFICIAL_SITE_MAP = {
  Blinkit: 'https://blinkit.com/',
  Zepto: 'https://www.zepto.com/',
  Instamart: 'https://www.swiggy.com/instamart',
  BigBasket: 'https://www.bigbasket.com/',
  Amazon: 'https://www.amazon.in/',
  Flipkart: 'https://www.flipkart.com/',
  Myntra: 'https://www.myntra.com/',
  Ajio: 'https://www.ajio.com/',
  Croma: 'https://www.croma.com/',
  'Reliance Digital': 'https://www.reliancedigital.in/',
  'Tata CLiQ': 'https://www.tatacliq.com/',
  Nykaa: 'https://www.nykaa.com/'
};

const PLATFORM_DOMAINS = {
  Blinkit: ['blinkit.com'],
  Zepto: ['zepto.com'],
  Instamart: ['swiggy.com'],
  BigBasket: ['bigbasket.com'],
  Amazon: ['amazon.in', 'amazon.com'],
  Flipkart: ['flipkart.com'],
  Myntra: ['myntra.com'],
  Ajio: ['ajio.com'],
  Croma: ['croma.com'],
  'Reliance Digital': ['reliancedigital.in'],
  'Tata CLiQ': ['tatacliq.com'],
  Nykaa: ['nykaa.com']
};

function buildOfficialProductUrl(platform, query, productName) {
  const searchTerm = cleanText(productName || query || '').trim() || cleanText(query || '').trim();
  const encoded = encodeURIComponent(searchTerm || 'grocery');

  switch (platform) {
    case 'Blinkit':
      return `https://blinkit.com/s/?q=${encoded}`;
    case 'Zepto':
      return `https://www.zepto.com/search?query=${encoded}`;
    case 'Instamart':
      return `https://www.swiggy.com/instamart/search?query=${encoded}`;
    case 'BigBasket':
      return `https://www.bigbasket.com/ps/?q=${encoded}`;
    case 'Amazon':
      return `https://www.amazon.in/s?k=${encoded}`;
    case 'Flipkart':
      return `https://www.flipkart.com/search?q=${encoded}`;
    case 'Myntra':
      return `https://www.myntra.com/search?rawQuery=${encoded}`;
    case 'Ajio':
      return `https://www.ajio.com/search/?text=${encoded}`;
    case 'Croma':
      return `https://www.croma.com/searchB?q=${encoded}`;
    case 'Reliance Digital':
      return `https://www.reliancedigital.in/search?q=${encoded}`;
    case 'Tata CLiQ':
      return `https://www.tatacliq.com/search/?searchCategory=all&text=${encoded}`;
    case 'Nykaa':
      return `https://www.nykaa.com/search/result/?q=${encoded}`;
    default:
      return `https://www.google.com/search?q=${encoded}`;
  }
}

const FALLBACK_ITEMS = [
  {
    name: 'Amul Taaza Toned Milk 1 L',
    price: 68,
    originalPrice: 72,
    platform: 'Blinkit',
    image: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=900&q=80',
    quantity: '1 L',
    eta: '10-15 mins',
    inStock: true,
    productUrl: OFFICIAL_SITE_MAP.Blinkit
  },
  {
    name: 'Nandini Good Life Milk 1 L',
    price: 64,
    originalPrice: 70,
    platform: 'Zepto',
    image: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=900&q=80',
    quantity: '1 L',
    eta: '12-18 mins',
    inStock: true,
    productUrl: OFFICIAL_SITE_MAP.Zepto
  },
  {
    name: 'A2 Ghee 500 g',
    price: 450,
    originalPrice: 520,
    platform: 'Instamart',
    image: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=900&q=80',
    quantity: '500 g',
    eta: '15-20 mins',
    inStock: true,
    productUrl: OFFICIAL_SITE_MAP.Instamart
  },
  {
    name: 'Organic Brown Rice 5 kg',
    price: 380,
    originalPrice: 430,
    platform: 'BigBasket',
    image: 'https://images.unsplash.com/photo-1518843875459-f738682238a6?auto=format&fit=crop&w=900&q=80',
    quantity: '5 kg',
    eta: '18-25 mins',
    inStock: true,
    productUrl: OFFICIAL_SITE_MAP.BigBasket
  },
  {
    name: 'Tomato 1 kg',
    price: 42,
    originalPrice: 48,
    platform: 'Blinkit',
    image: 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=900&q=80',
    quantity: '1 kg',
    eta: '8-12 mins',
    inStock: true,
    productUrl: OFFICIAL_SITE_MAP.Blinkit
  },
  {
    name: 'Bananas 1 dozen',
    price: 58,
    originalPrice: 68,
    platform: 'Zepto',
    image: 'https://images.unsplash.com/photo-1570586437263-ab629fccc818?auto=format&fit=crop&w=900&q=80',
    quantity: '1 dozen',
    eta: '10-15 mins',
    inStock: true,
    productUrl: OFFICIAL_SITE_MAP.Zepto
  }
];

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePrice(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const numeric = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolveOfficialUrl(raw, platform, query) {
  const candidate = raw.productUrl || raw.url || raw.product_url || raw.link || raw.source_url || raw.homepage || '';
  const productName = cleanText(raw.name || raw.title || raw.productName || raw.product_name || raw.label || query || '');
  const fallback = buildOfficialProductUrl(platform, query, productName);

  if (typeof candidate !== 'string' || !/^https?:\/\//i.test(candidate)) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    const allowedDomains = PLATFORM_DOMAINS[platform] || [];
    const isOfficialStore = allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    const pathname = parsed.pathname.toLowerCase();
    const hasSearchTerm = Boolean(parsed.searchParams.get('q') || parsed.searchParams.get('query') || parsed.searchParams.get('text'));

    if (!isOfficialStore || parsed.protocol !== 'https:' || pathname === '/' ||
      (platform === 'Instamart' && pathname === '/instamart' && !hasSearchTerm)) {
      return fallback;
    }
  } catch (error) {
    return fallback;
  }

  return candidate;
}

function normalizeItem(raw, index = 0, query = '') {
  const name = cleanText(raw.name || raw.title || raw.productName || raw.product_name || raw.label || '');
  const price = parsePrice(raw.price || raw.salePrice || raw.offerPrice || raw.discountedPrice || raw.currentPrice || raw.extracted_price || raw.value || raw.final_price || raw.offer_price);
  const originalPrice = parsePrice(raw.originalPrice || raw.mrp || raw.listPrice || raw.original_price || raw.list_price || raw.compare_at_price || price);
  const platform = raw.platform || 'Marketplace';
  const quantity = cleanText(raw.quantity || raw.size || raw.unit || raw.packSize || raw.pack_size || '');
  const image = raw.image || raw.image_url || raw.img || raw.thumbnail || raw.productImage || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80';
  const productUrl = resolveOfficialUrl(raw, platform, query);

  if (!name || price <= 0) return null;

  const normalizedOriginal = Math.max(originalPrice, price);
  const discount = normalizedOriginal > price ? Math.round(((normalizedOriginal - price) / normalizedOriginal) * 100) : 0;

  return {
    id: `${platform.toLowerCase()}-${index}-${slugify(name)}`,
    name,
    price,
    originalPrice: normalizedOriginal,
    discount,
    platform,
    image,
    quantity: quantity || '1 unit',
    eta: raw.eta || raw.delivery || raw.deliveryTime || raw.etaText || '10-20 mins',
    inStock: raw.inStock !== false,
    productUrl,
  };
}

function mapPlatform(source = '') {
  const text = String(source).toLowerCase();
  if (text.includes('amazon')) return 'Amazon';
  if (text.includes('flipkart')) return 'Flipkart';
  if (text.includes('myntra')) return 'Myntra';
  if (text.includes('ajio')) return 'Ajio';
  if (text.includes('croma')) return 'Croma';
  if (text.includes('reliance digital') || text.includes('reliancedigital')) return 'Reliance Digital';
  if (text.includes('tata cliq') || text.includes('tatacliq')) return 'Tata CLiQ';
  if (text.includes('nykaa')) return 'Nykaa';
  if (text.includes('blinkit')) return 'Blinkit';
  if (text.includes('zepto')) return 'Zepto';
  if (text.includes('swiggy') || text.includes('instamart')) return 'Instamart';
  if (text.includes('bigbasket')) return 'BigBasket';
  return 'Marketplace';
}

async function fetchSerpApiPage(query, start) {
  if (!SERPAPI_KEY) {
    return [];
  }

  const params = new URLSearchParams({
    engine: 'google_shopping',
    q: query,
    location: 'Bengaluru, Karnataka, India',
    hl: 'en',
    gl: 'in',
    num: String(SERPAPI_PAGE_SIZE),
    start: String(start),
    api_key: SERPAPI_KEY,
  });

  const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`SerpAPI request failed with ${response.status}`);
  }

  const payload = await response.json();
  const shoppingResults = Array.isArray(payload.shopping_results) ? payload.shopping_results : [];
  const organicResults = Array.isArray(payload.organic_results) ? payload.organic_results : [];

  return [...shoppingResults, ...organicResults];
}

async function fetchSerpApiResults(query, limit) {
  if (!SERPAPI_KEY) {
    return [];
  }

  const results = [];
  const seen = new Set();

  for (let page = 0; page < SERPAPI_MAX_PAGES && results.length < limit; page += 1) {
    let candidates;
    try {
      candidates = await fetchSerpApiPage(query, page * SERPAPI_PAGE_SIZE);
    } catch (error) {
      if (results.length === 0) throw error;
      console.warn(`[QuickCompare] SerpAPI page ${page + 1} failed; returning ${results.length} results:`, error.message);
      break;
    }
    if (candidates.length === 0) break;

    candidates.forEach((item) => {
      const platform = mapPlatform([item.source, item.displayed_link, item.link].filter(Boolean).join(' '));
      if (platform === 'Marketplace') return;

      const formatted = normalizeItem({
        name: item.title || item.name,
        price: item.price || item.extracted_price || item.lowest_price,
        originalPrice: item.compare_at_price || item.original_price || item.price,
        platform,
        image: item.thumbnail || item.image || item.thumbnail_url || item.img,
        quantity: item.attributes?.find((attr) => attr.name?.toLowerCase().includes('weight') || attr.name?.toLowerCase().includes('size'))?.value || item.product_type || '',
        eta: item.delivery || item.shipping || '10-20 mins',
        inStock: item.in_stock !== false,
        productUrl: item.link || item.product_url || item.source_url || OFFICIAL_SITE_MAP[platform] || 'https://www.google.com/search?q=' + encodeURIComponent(query),
      }, results.length, query);

      if (!formatted) return;
      const key = `${formatted.platform}|${formatted.name.toLowerCase()}|${formatted.price}|${formatted.productUrl}`;
      if (seen.has(key)) return;

      seen.add(key);
      results.push(formatted);
    });
  }

  return results.slice(0, limit);
}

function getFallbackResults(query, limit = 48) {
  const keyword = String(query || '').toLowerCase();
  let filtered = FALLBACK_ITEMS;

  if (keyword) {
    filtered = FALLBACK_ITEMS.filter((item) => {
      const haystack = `${item.name} ${item.platform}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }

  const source = filtered.length ? filtered : FALLBACK_ITEMS;
  const generated = [];

  for (let i = 0; i < limit; i += 1) {
    const item = source[i % source.length];
    generated.push(normalizeItem({
      ...item,
      name: `${item.name} ${i > 0 ? `(${i + 1})` : ''}`.trim(),
      price: item.price + (i % 4) * 7,
      originalPrice: item.originalPrice + (i % 4) * 9,
      platform: item.platform,
      image: item.image,
      quantity: item.quantity,
      eta: item.eta,
      inStock: item.inStock,
      productUrl: item.productUrl,
    }, i, query));
  }

  return generated.filter(Boolean);
}

async function searchProducts(query, limit = PRODUCT_RESULT_LIMIT) {
  const safeQuery = String(query || '').trim();
  if (!safeQuery) return { items: [], source: 'empty' };

  try {
    const serpResults = await fetchSerpApiResults(safeQuery, limit);
    if (serpResults.length > 0) {
      return { items: serpResults, source: 'live' };
    }
  } catch (error) {
    console.warn('[QuickCompare] SerpAPI lookup failed:', error.message);
  }

  return { items: getFallbackResults(safeQuery, limit), source: 'fallback' };
}

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = PRODUCT_RESULT_LIMIT;

  if (!query) {
    return res.json({ items: [], meta: { query: '', source: 'empty' } });
  }

  try {
    const { items, source } = await searchProducts(query, limit);
    return res.json({
      items,
      meta: {
        query,
        source,
        platformCount: new Set(items.map((item) => item.platform)).size,
      },
    });
  } catch (error) {
    console.error('[QuickCompare] Search failed:', error);
    return res.status(200).json({
      items: getFallbackResults(query),
      meta: { query, source: 'fallback', error: 'search_failed' },
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasSerpKey: Boolean(SERPAPI_KEY),
    env: process.env.NODE_ENV || 'development',
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});