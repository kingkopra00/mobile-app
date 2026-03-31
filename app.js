const config = window.PHARMA_STOCK_VIEWER_CONFIG || {};
const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');

const state = {
    groupedProducts: [],
    generatedAt: null,
    query: '',
    availability: 'in-stock',
    storageRoom: 'all',
    glAccount: 'all',
    selectedKey: null,
    loading: false
};

const elements = {
    refreshButton: document.getElementById('refreshButton'),
    searchInput: document.getElementById('searchInput'),
    availabilityFilter: document.getElementById('availabilityFilter'),
    storageFilter: document.getElementById('storageFilter'),
    glAccountFilter: document.getElementById('glAccountFilter'),
    productsCount: document.getElementById('productsCount'),
    unitsCount: document.getElementById('unitsCount'),
    lowStockCount: document.getElementById('lowStockCount'),
    statusText: document.getElementById('statusText'),
    updatedText: document.getElementById('updatedText'),
    errorBanner: document.getElementById('errorBanner'),
    detailPanel: document.getElementById('detailPanel'),
    inventoryGrid: document.getElementById('inventoryGrid')
};

elements.searchInput.addEventListener('input', (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
});

elements.availabilityFilter.addEventListener('change', (event) => {
    state.availability = event.target.value;
    syncSelectedProduct();
    render();
});

elements.storageFilter.addEventListener('change', (event) => {
    state.storageRoom = event.target.value;
    syncSelectedProduct();
    render();
});

elements.glAccountFilter.addEventListener('change', (event) => {
    state.glAccount = event.target.value;
    syncSelectedProduct();
    render();
});

elements.refreshButton.addEventListener('click', () => {
    loadInventory(true);
});

elements.inventoryGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-product-key]');
    if (!card) return;

    const nextKey = card.dataset.productKey;
    state.selectedKey = state.selectedKey === nextKey ? null : nextKey;
    render();
});

loadInventory(false);

async function loadInventory(forceRefresh) {
    if (!apiBaseUrl) {
        showError('Set `apiBaseUrl` in `config.js` before using the stock viewer.');
        return;
    }

    setLoading(true);
    hideError();

    try {
        const refreshSuffix = forceRefresh ? '?refresh=true' : '';
        const response = await fetch(`${apiBaseUrl}/public-inventory${refreshSuffix}`);
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Unable to load inventory.');
        }

        const items = Array.isArray(payload) ? payload : (payload.items || []);
        state.generatedAt = payload.generatedAt || new Date().toISOString();
        state.groupedProducts = groupInventory(items);
        populateFilterOptions();
        syncSelectedProduct();
        render();
    } catch (error) {
        state.groupedProducts = [];
        render();
        showError(`${error.message} Check the worker deployment, ` +
            '`PUBLIC_APP_ORIGIN`, and that the worker service account can read the sheet.');
    } finally {
        setLoading(false);
    }
}

function groupInventory(items) {
    const grouped = new Map();

    for (const item of items) {
        const barcode = String(item.barcode || '').trim();
        const productCode = String(item.productId || item.kimadiaCode || '').trim();
        const storageRoom = String(item.storageRoom || '').trim();
        const glAccount = String(item.glAccount || '').trim();
        const key = `${barcode}|${productCode}`;

        if (!grouped.has(key)) {
            grouped.set(key, {
                key,
                barcode,
                productCode,
                brandName: String(item.brandName || 'Unknown Product').trim(),
                genericName: String(item.genericName || '').trim(),
                storageRoom,
                glAccount,
                category: String(item.category || '').trim(),
                totalStock: 0,
                batches: []
            });
        }

        const entry = grouped.get(key);
        const stock = Number(item.stock || 0);
        entry.totalStock += stock;
        if (!entry.glAccount && glAccount) entry.glAccount = glAccount;
        if (!entry.storageRoom && storageRoom) entry.storageRoom = storageRoom;
        entry.batches.push({
            batchNumber: String(item.batchNumber || 'No Batch').trim(),
            expiryDate: formatExpiry(String(item.expiryDate || '').trim()),
            stock
        });
    }

    return Array.from(grouped.values())
        .map((product) => ({
            ...product,
            batches: product.batches.sort(compareBatches)
        }))
        .sort(compareProducts);
}

function compareProducts(left, right) {
    return compareText(left.storageRoom, right.storageRoom)
        || compareText(left.glAccount, right.glAccount)
        || compareText(left.brandName, right.brandName);
}

function compareBatches(left, right) {
    return compareExpiry(left.expiryDate, right.expiryDate)
        || compareText(left.batchNumber, right.batchNumber);
}

function compareExpiry(left, right) {
    const leftValue = toExpirySortKey(left);
    const rightValue = toExpirySortKey(right);
    return leftValue - rightValue;
}

function toExpirySortKey(value) {
    if (!value) return Number.MAX_SAFE_INTEGER;
    const mmYyyy = /^(\d{2})\/(\d{4})$/.exec(value);
    if (mmYyyy) return Number(`${mmYyyy[2]}${mmYyyy[1]}`);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime();
}

function compareText(left, right) {
    return String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' });
}

function populateFilterOptions() {
    populateSelect(elements.storageFilter, uniqueValues(state.groupedProducts.map((item) => item.storageRoom)), 'All storage rooms');
    populateSelect(elements.glAccountFilter, uniqueValues(state.groupedProducts.map((item) => item.glAccount)), 'All GL accounts');
}

function populateSelect(select, values, allLabel) {
    const currentValue = select.value || 'all';
    const options = ['<option value="all">' + escapeHtml(allLabel) + '</option>'];

    for (const value of values) {
        options.push(`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
    }

    select.innerHTML = options.join('');
    select.value = values.includes(currentValue) ? currentValue : 'all';

    if (select === elements.storageFilter) {
        state.storageRoom = select.value;
    }
    if (select === elements.glAccountFilter) {
        state.glAccount = select.value;
    }
}

function uniqueValues(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(compareText);
}

function getVisibleProducts() {
    return state.groupedProducts.filter((product) => {
        const availabilityMatch = matchesAvailability(product.totalStock, state.availability);
        const storageMatch = state.storageRoom === 'all' || product.storageRoom === state.storageRoom;
        const glMatch = state.glAccount === 'all' || product.glAccount === state.glAccount;
        const haystack = [
            product.brandName,
            product.genericName,
            product.barcode,
            product.productCode,
            product.storageRoom,
            product.glAccount,
            product.category
        ].join(' ').toLowerCase();
        const queryMatch = state.query ? haystack.includes(state.query) : true;
        return availabilityMatch && storageMatch && glMatch && queryMatch;
    });
}

function matchesAvailability(totalStock, availability) {
    if (availability === 'all') return true;
    if (availability === 'out-of-stock') return totalStock <= 0;
    return totalStock > 0;
}

function syncSelectedProduct() {
    if (!state.selectedKey) return;
    const visibleKeys = new Set(getVisibleProducts().map((product) => product.key));
    if (!visibleKeys.has(state.selectedKey)) {
        state.selectedKey = null;
    }
}

function render() {
    const visibleProducts = getVisibleProducts();
    const inStockItemsCount = visibleProducts.filter((item) => item.totalStock > 0).length;
    const lowStockCount = visibleProducts.filter((item) => item.totalStock > 0 && item.totalStock <= 10).length;

    elements.productsCount.textContent = formatNumber(visibleProducts.length);
    elements.unitsCount.textContent = formatNumber(inStockItemsCount);
    elements.lowStockCount.textContent = formatNumber(lowStockCount);
    elements.statusText.textContent = state.loading
        ? 'Loading stock data...'
        : `${formatNumber(visibleProducts.length)} products sorted by storage room, GL account, and name`;
    elements.updatedText.textContent = state.generatedAt
        ? `Last updated ${new Date(state.generatedAt).toLocaleString()}`
        : '';

    renderDetailPanel(visibleProducts);

    if (visibleProducts.length === 0) {
        elements.inventoryGrid.innerHTML = '<article class="empty-state">No products match your current filters.</article>';
        return;
    }

    elements.inventoryGrid.innerHTML = visibleProducts.map(renderProductCard).join('');
}

function renderDetailPanel(visibleProducts) {
    const selectedProduct = visibleProducts.find((product) => product.key === state.selectedKey);
    if (!selectedProduct) {
        elements.detailPanel.innerHTML = '';
        elements.detailPanel.classList.add('hidden');
        return;
    }

    const batches = selectedProduct.batches.map((batch) => `
        <li class="detail-batch-row">
            <div>
                <strong>${escapeHtml(batch.batchNumber)}</strong>
                <span>Expiry ${escapeHtml(batch.expiryDate || 'Not provided')}</span>
            </div>
            <span class="detail-batch-stock">${formatNumber(batch.stock)}</span>
        </li>
    `).join('');

    elements.detailPanel.innerHTML = `
        <div class="detail-header">
            <div>
                <p class="detail-kicker">Selected Product</p>
                <h2>${escapeHtml(selectedProduct.brandName)}</h2>
                <p class="detail-copy">${escapeHtml(selectedProduct.genericName || 'Generic name not provided')}</p>
            </div>
            <button class="detail-close" type="button" data-close-detail>Close</button>
        </div>
        <dl class="detail-meta">
            <div><dt>Product Code</dt><dd>${escapeHtml(selectedProduct.productCode || 'N/A')}</dd></div>
            <div><dt>Barcode</dt><dd>${escapeHtml(selectedProduct.barcode || 'N/A')}</dd></div>
            <div><dt>Storage Room</dt><dd>${escapeHtml(selectedProduct.storageRoom || 'N/A')}</dd></div>
            <div><dt>GL Account</dt><dd>${escapeHtml(selectedProduct.glAccount || 'N/A')}</dd></div>
            <div><dt>Category</dt><dd>${escapeHtml(selectedProduct.category || 'N/A')}</dd></div>
            <div><dt>Current Stock</dt><dd>${formatNumber(selectedProduct.totalStock)}</dd></div>
        </dl>
        <div class="detail-section">
            <div class="detail-section-header">
                <span>Batch Stock Details</span>
                <span>${formatNumber(selectedProduct.batches.length)} batches</span>
            </div>
            <ul class="detail-batch-list">${batches}</ul>
        </div>
    `;
    elements.detailPanel.classList.remove('hidden');

    const closeButton = elements.detailPanel.querySelector('[data-close-detail]');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            state.selectedKey = null;
            render();
        }, { once: true });
    }
}

function renderProductCard(product) {
    const stockTone = product.totalStock <= 0
        ? 'stock-badge out'
        : (product.totalStock <= 10 ? 'stock-badge low' : 'stock-badge');
    const selectedClass = state.selectedKey === product.key ? ' product-card-selected' : '';

    return `
        <article class="product-card${selectedClass}" data-product-key="${escapeHtml(product.key)}" tabindex="0" role="button" aria-label="Show details for ${escapeHtml(product.brandName)}">
            <div class="card-header">
                <div>
                    <p class="product-name">${escapeHtml(product.brandName)}</p>
                    <p class="product-subtitle">${escapeHtml(product.genericName || 'Generic name not provided')}</p>
                </div>
                <span class="${stockTone}">${renderAvailabilityText(product.totalStock)}</span>
            </div>
            <dl class="product-meta">
                <div>
                    <dt>Storage Room</dt>
                    <dd>${escapeHtml(product.storageRoom || 'N/A')}</dd>
                </div>
                <div>
                    <dt>GL Account</dt>
                    <dd>${escapeHtml(product.glAccount || 'N/A')}</dd>
                </div>
                <div>
                    <dt>Product Code</dt>
                    <dd>${escapeHtml(product.productCode || 'N/A')}</dd>
                </div>
                <div>
                    <dt>Barcode</dt>
                    <dd>${escapeHtml(product.barcode || 'N/A')}</dd>
                </div>
            </dl>
            <div class="card-footer">
                <span>${formatNumber(product.batches.length)} batches</span>
                <span>Tap for batch stock details</span>
            </div>
        </article>
    `;
}

function renderAvailabilityText(stock) {
    if (stock <= 0) return 'Out of stock';
    return `${formatNumber(stock)} available`;
}

function setLoading(loading) {
    state.loading = loading;
    elements.refreshButton.disabled = loading;
}

function showError(message) {
    elements.errorBanner.textContent = message;
    elements.errorBanner.classList.remove('hidden');
}

function hideError() {
    elements.errorBanner.textContent = '';
    elements.errorBanner.classList.add('hidden');
}

function formatExpiry(value) {
    if (!value) return '';
    if (/^\d{2}\/\d{4}$/.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return `${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`;
}

function formatNumber(value) {
    return new Intl.NumberFormat().format(value);
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
