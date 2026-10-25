// State management
const state = {
  rawItems: [],
  filteredItems: [],
  filters: {
    platforms: new Set([
      'Zepto', 'Blinkit', 'Instamart', 'BigBasket', 'Amazon', 'Flipkart',
      'Myntra', 'Ajio', 'Croma', 'Reliance Digital', 'Tata CLiQ', 'Nykaa'
    ]),
    maxPrice: null,
    inStockOnly: false
  },
  sort: 'relevance'
};

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const productGrid = document.getElementById('productGrid');
const statusContainer = document.getElementById('statusContainer');
const resultsCount = document.getElementById('resultsCount');
const sortSelect = document.getElementById('sortSelect');
const maxPriceInput = document.getElementById('maxPriceInput');
const inStockOnly = document.getElementById('inStockOnly');
const platformCheckboxes = document.querySelectorAll('.filter-platform');
const sourceText = document.getElementById('sourceText');
const sourceBadge = document.getElementById('sourceBadge');

// Key Event Listener: Trigger API call on Enter key press
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeApiSearch();
  }
});

searchBtn.addEventListener('click', () => {
  executeApiSearch();
});

// API Search Execution Function
async function executeApiSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    showStatus('info', 'Please enter a product name to search.');
    return;
  }

  showStatus('loading', `Searching stores for "${query}"...`);
  productGrid.innerHTML = '';

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }
    const data = await response.json();

    if (data.error) {
      showStatus('error', `Error fetching data: ${data.error}`);
      return;
    }

    const isLive = data.meta?.source === 'live';
    sourceText.textContent = isLive ? 'Live store prices' : 'Sample prices';
    sourceBadge.classList.toggle('is-mock', !isLive);
    state.rawItems = data.items || [];
    if (state.rawItems.length === 0) {
      showStatus('info', `No store listings found for "${query}".`);
      resultsCount.innerHTML = 'Showing <em>0</em> results';
      return;
    }

    clearStatus();
    applyFiltersAndRender();
  } catch (err) {
    console.error(err);
    showStatus('error', 'Server error while searching online stores.');
  }
}

// Client-side Filtering & Sorting Logic
function applyFiltersAndRender() {
  let result = [...state.rawItems];

  // Filter by Platform
  result = result.filter(item => state.filters.platforms.has(item.platform));

  // Filter by Max Price
  if (state.filters.maxPrice !== null && !isNaN(state.filters.maxPrice)) {
    result = result.filter(item => item.price <= state.filters.maxPrice);
  }

  // Filter by Stock
  if (state.filters.inStockOnly) {
    result = result.filter(item => item.inStock);
  }

  // Sort Results
  if (state.sort === 'price_asc') {
    result.sort((a, b) => a.price - b.price);
  } else if (state.sort === 'price_desc') {
    result.sort((a, b) => b.price - a.price);
  } else if (state.sort === 'discount_desc') {
    result.sort((a, b) => (b.discount || 0) - (a.discount || 0));
  }

  state.filteredItems = result;
  const storeCount = new Set(result.map((item) => item.platform)).size;
  resultsCount.innerHTML = `Showing <em>${result.length}</em> of ${state.rawItems.length} offers across <em>${storeCount}</em> stores`;
  renderGrid(result);
}

function renderGrid(items) {
  if (items.length === 0) {
    showStatus('info', 'No offers match your active filters. Try selecting more stores.');
    productGrid.innerHTML = '';
    return;
  }
  clearStatus();

  productGrid.innerHTML = items.map(item => `
    <div class="card">
      <span class="platform-tag platform-${escapeHtml(item.platform.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}">${escapeHtml(item.platform)}</span>
      <img class="card-img" src="${safeImageUrl(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">
      <div class="card-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
      <div class="card-meta">${escapeHtml(item.quantity || '1 unit')} • ${escapeHtml(item.eta || '10-15 mins')}</div>
      <div class="card-price-row">
        <span class="price-current">₹${formatPrice(item.price)}</span>
        ${item.originalPrice > item.price ? `<span class="price-original">₹${formatPrice(item.originalPrice)}</span>` : ''}
        ${item.discount > 0 ? `<span class="price-discount">${formatPrice(item.discount)}% OFF</span>` : ''}
      </div>
      <a href="${safeProductUrl(item.productUrl)}" target="_blank" rel="noopener noreferrer" class="card-btn">View at ${escapeHtml(item.platform)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
    </div>
  `).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function safeProductUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? escapeHtml(url.href) : '#';
  } catch {
    return '#';
  }
}

function safeImageUrl(value) {
  const fallback = 'https://via.placeholder.com/140';
  try {
    const url = new URL(value || fallback, window.location.origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? escapeHtml(url.href) : fallback;
  } catch {
    return fallback;
  }
}

function formatPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) ? price.toLocaleString('en-IN') : '—';
}

// Helper functions for Status Display
function showStatus(type, message) {
  if (type === 'loading') {
    statusContainer.innerHTML = `<div class="status-box"><i class="fa-solid fa-spinner fa-spin"></i><p>${escapeHtml(message)}</p></div>`;
  } else if (type === 'error') {
    statusContainer.innerHTML = `<div class="status-box"><i class="fa-solid fa-circle-exclamation" style="color:#ef4444"></i><p>${escapeHtml(message)}</p></div>`;
  } else {
    statusContainer.innerHTML = `<div class="status-box"><i class="fa-solid fa-magnifying-glass"></i><p>${escapeHtml(message)}</p></div>`;
  }
}

function clearStatus() {
  statusContainer.innerHTML = '';
}

// Filter Event Listeners
platformCheckboxes.forEach(cb => {
  cb.addEventListener('change', () => {
    if (cb.checked) {
      state.filters.platforms.add(cb.value);
    } else {
      state.filters.platforms.delete(cb.value);
    }
    applyFiltersAndRender();
  });
});

maxPriceInput.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  state.filters.maxPrice = isNaN(val) ? null : val;
  applyFiltersAndRender();
});

inStockOnly.addEventListener('change', (e) => {
  state.filters.inStockOnly = e.target.checked;
  applyFiltersAndRender();
});

sortSelect.addEventListener('change', (e) => {
  state.sort = e.target.value;
  applyFiltersAndRender();
});