// State management
const state = {
  rawItems: [],
  filteredItems: [],
  filters: {
    platforms: new Set(['Zepto', 'Blinkit', 'Instamart', 'BigBasket']),
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

  showStatus('loading', `Fetching real-time results for "${query}"...`);
  productGrid.innerHTML = '';

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();

    if (data.error) {
      showStatus('error', `Error fetching data: ${data.error}`);
      return;
    }

    state.rawItems = data.items || [];
    if (state.rawItems.length === 0) {
      showStatus('info', `No quick-commerce items found for "${query}".`);
      resultsCount.innerHTML = 'Showing <em>0</em> results';
      return;
    }

    clearStatus();
    applyFiltersAndRender();
  } catch (err) {
    console.error(err);
    showStatus('error', 'Server error while fetching quick-delivery items.');
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
  resultsCount.innerHTML = `Showing <em>${result.length}</em> of ${state.rawItems.length} items`;
  renderGrid(result);
}

function renderGrid(items) {
  if (items.length === 0) {
    showStatus('info', 'No products match your active sidebar filters.');
    productGrid.innerHTML = '';
    return;
  }
  clearStatus();

  productGrid.innerHTML = items.map(item => `
    <div class="card">
      <span class="platform-tag platform-${item.platform.toLowerCase()}">${item.platform}</span>
      <img class="card-img" src="${item.image || 'https://via.placeholder.com/140'}" alt="${item.name}" loading="lazy">
      <div class="card-title" title="${item.name}">${item.name}</div>
      <div class="card-meta">${item.quantity || '1 unit'} • ⏱️ ${item.eta || '10-15 mins'}</div>
      <div class="card-price-row">
        <span class="price-current">₹${item.price}</span>
        ${item.originalPrice > item.price ? `<span class="price-original">₹${item.originalPrice}</span>` : ''}
        ${item.discount > 0 ? `<span class="price-discount">${item.discount}% OFF</span>` : ''}
      </div>
      <a href="${item.productUrl}" target="_blank" rel="noopener noreferrer" class="card-btn">Buy Now</a>
    </div>
  `).join('');
}

// Helper functions for Status Display
function showStatus(type, message) {
  if (type === 'loading') {
    statusContainer.innerHTML = `<div class="status-box"><i class="fa-solid fa-spinner fa-spin"></i><p>${message}</p></div>`;
  } else if (type === 'error') {
    statusContainer.innerHTML = `<div class="status-box"><i class="fa-solid fa-circle-exclamation" style="color:#ef4444"></i><p>${message}</p></div>`;
  } else {
    statusContainer.innerHTML = `<div class="status-box"><i class="fa-solid fa-magnifying-glass"></i><p>${message}</p></div>`;
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