
const storesByMode = {
  ecommerce: [
    { name: 'Amazon', icon: 'fa-brands fa-amazon' },
    { name: 'Flipkart', icon: 'fa-solid fa-bag-shopping' },
    { name: 'Myntra', icon: 'fa-solid fa-shirt' },
    { name: 'Ajio', icon: 'fa-solid fa-tag' },
    { name: 'Croma', icon: 'fa-solid fa-laptop' },
    { name: 'Reliance Digital', icon: 'fa-solid fa-plug' },
    { name: 'Tata CLiQ', icon: 'fa-solid fa-store' },
    { name: 'Nykaa', icon: 'fa-solid fa-spa' }
  ],
  quick: [
    { name: 'Blinkit', icon: 'fa-solid fa-bolt' },
    { name: 'Zepto', icon: 'fa-solid fa-basket-shopping' },
    { name: 'Instamart', icon: 'fa-solid fa-bag-shopping' },
    { name: 'BigBasket', icon: 'fa-solid fa-leaf' }
  ]
};

const state = {
  mode: 'ecommerce',
  rawItems: [],
  filteredItems: [],
  filters: {
    platforms: new Set(storesByMode.ecommerce.map((store) => store.name)),
    maxPrice: null,
    inStockOnly: false
  },
  sort: 'relevance'
};

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const productGrid = document.getElementById('productGrid');
const statusContainer = document.getElementById('statusContainer');
const resultsCount = document.getElementById('resultsCount');
const sortSelect = document.getElementById('sortSelect');
const maxPriceInput = document.getElementById('maxPriceInput');
const inStockOnly = document.getElementById('inStockOnly');
const platformFilters = document.getElementById('platformFilters');
const sourceText = document.getElementById('sourceText');
const comparisonTitle = document.getElementById('comparisonTitle');
const comparisonDescription = document.getElementById('comparisonDescription');
const searchPrompt = document.getElementById('searchPrompt');
const modeButtons = document.querySelectorAll('.mode-card');
const accountDialog = document.getElementById('accountDialog');
const accountButton = document.getElementById('accountButton');
const closeAccountDialog = document.getElementById('closeAccountDialog');
const authView = document.getElementById('authView');
const otpVerificationView = document.getElementById('otpVerificationView');
const dashboardView = document.getElementById('dashboardView');
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const confirmPassword = document.getElementById('confirmPassword');
const confirmPasswordField = document.getElementById('confirmPasswordField');
const authSubmit = document.getElementById('authSubmit');
const authSwitch = document.getElementById('authSwitch');
const authSwitchPrompt = document.getElementById('authSwitchPrompt');
const authDescription = document.getElementById('authDescription');
const accountTitle = document.getElementById('accountTitle');
const otpTitle = document.getElementById('otpTitle');
const accountStatus = document.getElementById('accountStatus');
const dashboardStatus = document.getElementById('dashboardStatus');
const accountEmail = document.getElementById('accountEmail');
const alertList = document.getElementById('alertList');
const verificationNotice = document.getElementById('verificationNotice');
const mailSetupNotice = document.getElementById('mailSetupNotice');
const resendVerification = document.getElementById('resendVerification');
const otpForm = document.getElementById('otpForm');
const otpInput = document.getElementById('otpInput');
const verifyOtpButton = document.getElementById('verifyOtpButton');
const resendOtpButton = document.getElementById('resendOtpButton');
const otpStatus = document.getElementById('otpStatus');
const logoutButton = document.getElementById('logoutButton');
const authState = { user: null, alerts: [], emailConfigured: false, formMode: 'login' };
let pendingVerificationEmail = '';

function renderStoreFilters() {
  const stores = storesByMode[state.mode];
  state.filters.platforms = new Set(stores.map((store) => store.name));
  platformFilters.innerHTML = stores.map((store) => `
    <label class="filter-item">
      <span class="filter-label"><span class="store-icon store-${store.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}" aria-hidden="true"><i class="${store.icon}"></i></span>${escapeHtml(store.name)}</span>
      <input type="checkbox" value="${escapeHtml(store.name)}" class="filter-platform" checked>
    </label>
  `).join('');

  platformFilters.querySelectorAll('.filter-platform').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.filters.platforms.add(checkbox.value);
      } else {
        state.filters.platforms.delete(checkbox.value);
      }
      applyFiltersAndRender();
    });
  });
}

function selectMode(mode) {
  if (!storesByMode[mode] || state.mode === mode) return;
  state.mode = mode;
  modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  const quickMode = mode === 'quick';
  comparisonTitle.textContent = quickMode ? 'The quick-shop price check' : 'Let’s find your best match';
  comparisonDescription.textContent = quickMode
    ? 'Compare everyday essentials on Blinkit, Zepto, Instamart and BigBasket.'
    : 'Compare products from Amazon, Flipkart, Myntra and more.';
  searchPrompt.textContent = quickMode ? 'Find everyday essentials for quick delivery' : 'Search across your favourite stores';
  searchInput.placeholder = quickMode ? 'Try “milk” or “fresh fruit”' : 'Try “wireless headphones”';
  renderStoreFilters();
  applyFiltersAndRender();
}

modeButtons.forEach((button) => {
  button.addEventListener('click', () => selectMode(button.dataset.mode));
});

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    executeApiSearch();
  }
});

searchBtn.addEventListener('click', executeApiSearch);

document.querySelectorAll('.suggestion').forEach((button) => {
  button.addEventListener('click', () => {
    searchInput.value = button.dataset.query;
    executeApiSearch();
  });
});

async function executeApiSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    showStatus('info', 'Type a product name to compare prices.');
    searchInput.focus();
    return;
  }

  showStatus('loading', `Finding ${state.mode === 'quick' ? 'quick delivery' : 'online store'} prices for “${query}”…`);
  state.rawItems = [];
  state.filteredItems = [];
  productGrid.innerHTML = '';
  resultsCount.textContent = 'Searching live stores…';
  searchBtn.disabled = true;

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Search request failed with status ${response.status}`);
    }
    if (data.error) {
      showStatus('error', `Error fetching data: ${data.error}`);
      return;
    }

    sourceText.textContent = 'Live store prices';
    state.rawItems = Array.isArray(data.items) ? data.items : [];
    applyFiltersAndRender(query);
  } catch (error) {
    console.error(error);
    state.rawItems = [];
    state.filteredItems = [];
    productGrid.innerHTML = '';
    resultsCount.textContent = 'No live offers available';
    sourceText.textContent = 'Live search unavailable';
    showStatus('error', error.message || 'We could not reach the search service. Please try again.');
  } finally {
    searchBtn.disabled = false;
  }
}

function applyFiltersAndRender(query = searchInput.value.trim()) {
  const availableStores = new Set(storesByMode[state.mode].map((store) => store.name));
  let result = state.rawItems.filter((item) =>
    availableStores.has(item.platform) && state.filters.platforms.has(item.platform)
  );

  if (state.filters.maxPrice !== null && Number.isFinite(state.filters.maxPrice)) {
    result = result.filter((item) => item.price <= state.filters.maxPrice);
  }
  if (state.filters.inStockOnly) {
    result = result.filter((item) => item.inStock);
  }

  if (state.sort === 'price_asc') {
    result.sort((a, b) => a.price - b.price);
  } else if (state.sort === 'price_desc') {
    result.sort((a, b) => b.price - a.price);
  } else if (state.sort === 'discount_desc') {
    result.sort((a, b) => (b.discount || 0) - (a.discount || 0));
  }

  state.filteredItems = result;
  const storeCount = new Set(result.map((item) => item.platform)).size;
  resultsCount.innerHTML = result.length
    ? `Showing <em>${result.length}</em> ${result.length === 1 ? 'offer' : 'offers'} across <em>${storeCount}</em> ${storeCount === 1 ? 'store' : 'stores'}`
    : 'Your comparison will appear here';

  if (state.rawItems.length === 0) {
    productGrid.innerHTML = '';
    return;
  }
  if (result.length === 0) {
    productGrid.innerHTML = '';
    showStatus('info', query
      ? `No ${state.mode === 'quick' ? 'quick delivery' : 'online store'} offers found for “${query}”. Try another product or switch shopping type.`
      : 'No offers match these filters. Try selecting more stores.');
    return;
  }

  clearStatus();
  renderGrid(result);
}

function renderGrid(items) {
  productGrid.innerHTML = items.map((item, index) => `
    <article class="card">
      ${index === 0 ? '<span class="best-deal"><i class="fa-solid fa-sparkles" aria-hidden="true"></i> Best match</span>' : ''}
      <div class="card-image-wrap">
        <span class="platform-tag platform-${escapeHtml(item.platform.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}">${escapeHtml(item.platform)}</span>
        <img class="card-img" src="${safeImageUrl(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">
      </div>
      <div class="card-content">
        <div class="card-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
        <div class="card-meta"><span>${escapeHtml(item.quantity || '1 unit')}</span><span class="meta-divider"></span><span>${escapeHtml(item.eta || '10-15 mins')}</span></div>
        <div class="card-price-row">
          <span class="price-current">₹${formatPrice(item.price)}</span>
          ${item.originalPrice > item.price ? `<span class="price-original">₹${formatPrice(item.originalPrice)}</span>` : ''}
          ${item.discount > 0 ? `<span class="price-discount">${formatPrice(item.discount)}% off</span>` : ''}
        </div>
        <a href="${safeProductUrl(item.productUrl)}" target="_blank" rel="noopener noreferrer" class="card-btn">View deal <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a>
        <button class="watch-button" type="button" data-product-index="${index}">
          <i class="fa-regular fa-bell" aria-hidden="true"></i> Watch for a price drop
        </button>
      </div>
    </article>
  `).join('');
  productGrid.querySelectorAll('.watch-button').forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.filteredItems[Number(button.dataset.productIndex)];
      if (item) watchProduct(item, button);
    });
  });
}

function setAccountStatus(message, success = false) {
  accountStatus.textContent = message;
  accountStatus.classList.toggle('is-success', success);
}

function setDashboardStatus(message, success = false) {
  dashboardStatus.textContent = message;
  dashboardStatus.classList.toggle('is-success', success);
}

function updateAccountButton() {
  accountButton.innerHTML = authState.user
    ? '<i class="fa-regular fa-bell" aria-hidden="true"></i><span>My alerts</span>'
    : '<i class="fa-regular fa-user" aria-hidden="true"></i><span>Sign in</span>';
  accountButton.setAttribute('aria-label', authState.user ? `Price alerts for ${authState.user.email}` : 'Sign in or create an account');
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
}

function setAuthFormMode(mode) {
  authState.formMode = mode;
  const isRegister = mode === 'register';
  accountDialog.setAttribute('aria-labelledby', 'accountTitle');
  accountTitle.textContent = isRegister ? 'Create your account' : 'Welcome back';
  authDescription.textContent = isRegister
    ? 'Save your favourite finds and get notified when their prices drop.'
    : 'Sign in to save products and get email alerts when prices drop.';
  authSubmit.innerHTML = isRegister
    ? 'Create account <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>'
    : 'Sign in <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
  authSwitchPrompt.textContent = isRegister ? 'Already have an account?' : 'New to PriceMatch?';
  authSwitch.textContent = isRegister ? 'Sign in' : 'Create an account';
  confirmPasswordField.hidden = !isRegister;
  confirmPassword.required = isRegister;
  authPassword.autocomplete = isRegister ? 'new-password' : 'current-password';
  authPassword.minLength = isRegister ? 10 : 1;
  authPassword.placeholder = isRegister ? 'At least 10 characters' : 'Your password';
  setAccountStatus('');
}

function openAccountDialog(message = '') {
  if (pendingVerificationEmail) {
    authView.hidden = true;
    otpVerificationView.hidden = false;
    dashboardView.hidden = true;
  } else if (authState.user) {
    showDashboard();
    refreshAlerts();
  } else {
    authView.hidden = false;
    otpVerificationView.hidden = true;
    dashboardView.hidden = true;
    setAuthFormMode('login');
    setAccountStatus(message);
  }
  if (!accountDialog.open) accountDialog.showModal();
}

function showDashboard(message = '', success = false) {
  authView.hidden = true;
  otpVerificationView.hidden = true;
  dashboardView.hidden = false;
  accountDialog.setAttribute('aria-labelledby', 'dashboardTitle');
  accountEmail.textContent = authState.user?.email || '';
  verificationNotice.hidden = Boolean(authState.user?.emailVerified);
  mailSetupNotice.hidden = authState.emailConfigured;
  updateAccountButton();
  setDashboardStatus(message, success);
  renderAlerts();
}

function showOtpVerification(email, message) {
  pendingVerificationEmail = email;
  authView.hidden = true;
  otpVerificationView.hidden = false;
  dashboardView.hidden = true;
  otpTitle.textContent = 'Check your inbox';
  otpInput.value = '';
  otpStatus.textContent = message;
  otpStatus.classList.remove('is-success');
  accountDialog.setAttribute('aria-labelledby', 'otpTitle');
  otpInput.focus();
}

async function refreshAlerts() {
  if (!authState.user) return;
  try {
    const data = await apiRequest('/api/alerts');
    authState.alerts = data.alerts || [];
    authState.emailConfigured = data.emailConfigured;
    mailSetupNotice.hidden = authState.emailConfigured;
    renderAlerts();
  } catch (error) {
    setDashboardStatus(error.message);
  }
}

function renderAlerts() {
  if (!authState.user) {
    alertList.innerHTML = '';
    return;
  }
  if (authState.alerts.length === 0) {
    alertList.innerHTML = '<p class="empty-alerts">No price alerts yet. Search for a product and choose “Watch for a price drop” to start tracking it.</p>';
    return;
  }
  alertList.innerHTML = authState.alerts.map((alert) => `
    <article class="alert-item">
      <img src="${safeImageUrl(alert.image)}" alt="" loading="lazy">
      <div class="alert-item-copy">
        <strong>${escapeHtml(alert.productName)}</strong>
        <span>${escapeHtml(alert.platform)} · ₹${formatPrice(alert.currentPrice)} · checks every 6 hours</span>
      </div>
      <button class="alert-remove" type="button" data-alert-id="${Number(alert.id)}" aria-label="Remove price alert for ${escapeHtml(alert.productName)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
    </article>
  `).join('');
  alertList.querySelectorAll('.alert-remove').forEach((button) => {
    button.addEventListener('click', () => removeAlert(Number(button.dataset.alertId), button));
  });
}

async function watchProduct(item, button) {
  if (!authState.user) {
    openAccountDialog('Sign in or create an account to save this product and get a price-drop email.');
    return;
  }
  if (!authState.user.emailVerified) {
    openAccountDialog();
    showDashboard('Verify your email before creating price alerts.');
    return;
  }
  if (!authState.emailConfigured) {
    openAccountDialog();
    showDashboard('Email delivery is not configured yet. Ask the site administrator to set up SMTP.');
    return;
  }

  const oldLabel = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Checking live price…';
  try {
    const result = await apiRequest('/api/alerts', {
      method: 'POST',
      body: JSON.stringify({ productName: item.name, platform: item.platform })
    });
    await refreshAlerts();
    showStatus('info', result.alreadyWatching
      ? `${item.name} is already on your price watchlist.`
      : `${item.name} is on your price watchlist. We’ll email you when its price drops.`);
    button.innerHTML = '<i class="fa-solid fa-bell" aria-hidden="true"></i> Price alert added';
    window.setTimeout(() => {
      if (button.isConnected) button.innerHTML = oldLabel;
    }, 2400);
  } catch (error) {
    openAccountDialog();
    showDashboard(error.message);
    button.innerHTML = oldLabel;
  } finally {
    button.disabled = false;
  }
}

async function removeAlert(id, button) {
  button.disabled = true;
  try {
    await apiRequest(`/api/alerts/${id}`, { method: 'DELETE' });
    authState.alerts = authState.alerts.filter((alert) => alert.id !== id);
    renderAlerts();
    setDashboardStatus('Price alert removed.', true);
  } catch (error) {
    button.disabled = false;
    setDashboardStatus(error.message);
  }
}

async function loadAccount() {
  try {
    const data = await apiRequest('/api/auth/me');
    authState.user = data.user;
    authState.emailConfigured = data.emailConfigured;
    updateAccountButton();
    if (authState.user) {
      const alerts = await apiRequest('/api/alerts');
      authState.alerts = alerts.alerts || [];
      authState.emailConfigured = alerts.emailConfigured;
    }
  } catch (error) {
    console.error('Could not load the account session:', error);
  }
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const isRegister = authState.formMode === 'register';
  if (isRegister && authPassword.value !== confirmPassword.value) {
    setAccountStatus('Your passwords do not match.');
    confirmPassword.focus();
    return;
  }

  authSubmit.disabled = true;
  setAccountStatus('');
  try {
    const data = await apiRequest(isRegister ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: authEmail.value, password: authPassword.value })
    });
    authState.user = data.user;
    authState.alerts = [];
    authState.emailConfigured = data.emailConfigured;
    authForm.reset();
    updateAccountButton();

    if (isRegister) {
      if (data.verificationEmail === 'sent') {
        showOtpVerification(
          data.user.email,
          `Enter the 6-digit code sent to ${data.user.email}.`
        );
      } else {
        showDashboard(
          data.verificationEmail === 'failed'
            ? 'Your account was created, but the email could not be sent. Check SMTP settings and resend the code.'
            : 'Your account was created, but email delivery is not configured. Configure SMTP before verifying your email.',
          false
        );
      }
    } else {
      pendingVerificationEmail = '';
      showDashboard('Signed in successfully.', true);
      await refreshAlerts();
    }
  } catch (error) {
    setAccountStatus(error.message);
  } finally {
    authSubmit.disabled = false;
  }
});

accountButton.addEventListener('click', () => openAccountDialog());
closeAccountDialog.addEventListener('click', () => accountDialog.close());
accountDialog.addEventListener('click', (event) => {
  if (event.target === accountDialog) accountDialog.close();
});
authSwitch.addEventListener('click', () => {
  setAuthFormMode(authState.formMode === 'login' ? 'register' : 'login');
});

resendVerification.addEventListener('click', async () => {
  resendVerification.disabled = true;
  try {
    await apiRequest('/api/auth/verification/resend', { method: 'POST', body: '{}' });
    showOtpVerification(
      authState.user.email,
      `A new 6-digit code was sent to ${authState.user.email}.`
    );
  } catch (error) {
    setDashboardStatus(error.message);
  } finally {
    resendVerification.disabled = false;
  }
});

otpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = pendingVerificationEmail || authState.user?.email || '';
  const otp = otpInput.value.trim();

  if (!email) {
    otpStatus.textContent = 'Your verification session has expired. Create an account or sign in again.';
    return;
  }

  if (!/^\d{6}$/.test(otp)) {
    otpStatus.textContent = 'Enter a valid 6-digit code.';
    return;
  }

  verifyOtpButton.disabled = true;
  otpStatus.textContent = 'Verifying your email...';
  otpStatus.classList.remove('is-success');

  try {
    await apiRequest('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, otp })
    });

    pendingVerificationEmail = '';
    if (authState.user?.email === email) {
      authState.user.emailVerified = true;
      showDashboard('Your email is verified. You can now create price alerts.', true);
      await refreshAlerts();
    } else {
      otpStatus.textContent = 'Email verified successfully. Please sign in.';
      otpStatus.classList.add('is-success');
      otpVerificationView.hidden = true;
      authView.hidden = false;
      dashboardView.hidden = true;
      authEmail.value = email;
      authPassword.value = '';
      setAuthFormMode('login');
      setAccountStatus('Your email is verified. Please sign in.', true);
    }
  } catch (error) {
    otpStatus.textContent = error.message;
    otpStatus.classList.remove('is-success');
  } finally {
    verifyOtpButton.disabled = false;
  }
});

resendOtpButton.addEventListener('click', async () => {
  const email = pendingVerificationEmail || authState.user?.email || '';
  if (!email) {
    otpStatus.textContent = 'Your verification session has expired. Create an account or sign in again.';
    return;
  }

  resendOtpButton.disabled = true;
  otpStatus.textContent = 'Requesting a new code...';
  otpStatus.classList.remove('is-success');

  try {
    await apiRequest('/api/auth/verification/resend', {
      method: 'POST',
      body: JSON.stringify({})
    });
    otpStatus.textContent = 'A new code has been sent. Check your inbox and spam folder.';
  } catch (error) {
    otpStatus.textContent = error.message;
  } finally {
    resendOtpButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' });
    authState.user = null;
    authState.alerts = [];
    pendingVerificationEmail = '';
    authView.hidden = false;
    otpVerificationView.hidden = true;
    dashboardView.hidden = true;
    updateAccountButton();
    setAuthFormMode('login');
    setAccountStatus('You have signed out.', true);
  } catch (error) {
    setDashboardStatus(error.message);
  } finally {
    logoutButton.disabled = false;
  }
});

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
  const fallback = 'https://via.placeholder.com/400';
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

function showStatus(type, message) {
  const icon = type === 'loading'
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>'
    : type === 'error'
      ? '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
  statusContainer.innerHTML = `<div class="status-box status-${type}">${icon}<p>${escapeHtml(message)}</p></div>`;
}

function clearStatus() {
  statusContainer.innerHTML = '';
}

maxPriceInput.addEventListener('input', (event) => {
  const value = parseFloat(event.target.value);
  state.filters.maxPrice = Number.isNaN(value) ? null : value;
  applyFiltersAndRender();
});

inStockOnly.addEventListener('change', (event) => {
  state.filters.inStockOnly = event.target.checked;
  applyFiltersAndRender();
});

sortSelect.addEventListener('change', (event) => {
  state.sort = event.target.value;
  applyFiltersAndRender();
});

renderStoreFilters();
loadAccount();
