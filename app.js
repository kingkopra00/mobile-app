const config = window.PHARMA_STOCK_VIEWER_CONFIG || {};
const apiBaseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');

const state = {
    groupedProducts: [],
    generatedAt: null,
    query: '',
    stockOnly: true,
    loading: false
};

const elements = {
    refreshButton: document.getElementById('refreshButton'),
    searchInput: document.getElementById('searchInput'),
    stockOnlyToggle: document.getElementById('stockOnlyToggle'),
    productsCount: document.getElementById('productsCount'),
    unitsCount: document.getElementById('unitsCount'),
    lowStockCount: document.getElementById('lowStockCount'),
    statusText: document.getElementById('statusText'),
    updatedText: document.getElementById('updatedText'),
    errorBanner: document.getElementById('errorBanner'),
    inventoryGrid: document.getElementById('inventoryGrid')
};

elements.searchInput.addEventListener('input', (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
});

elements.stockOnlyToggle.addEventListener('change', (event) => {
    state.stockOnly = event.target.checked;
    render();
});

elements.refreshButton.addEventListener('click', () => {
    loadInventory(true);
});

loadInventory(false);

async function loadInventory(forceRefresh) {
    if (!apiBaseUrl) {
        showError('Set `apiBaseUrl` in `docs/config.js` before using the stock viewer.');
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
        const key = `${barcode}|${productCode}`;

        if (!grouped.has(key)) {
            grouped.set(key, {
                key,
                barcode,
                productCode,
                brandName: String(item.brandName || 'Unknown Product').trim(),
                genericName: String(item.genericName || '').trim(),
                storageRoom: String(item.storageRoom || '').trim(),
                category: String(item.category || '').trim(),
                totalStock: 0,
                batches: []
            });
        }

        const entry = grouped.get(key);
        const stock = Number(item.stock || 0);
        entry.totalStock += stock;
        entry.batches.push({
            batchNumber: String(item.batchNumber || 'No Batch').trim(),
            expiryDate: formatExpiry(String(item.expiryDate || '').trim()),
            stock
        });
    }

    return Array.from(grouped.values())
        .map((product) => ({
            ...product,
            batches: product.batches.sort((left, right) => right.stock - left.stock)
        }))
        .sort((left, right) => left.brandName.localeCompare(right.brandName));
}

function render() {
    const visibleProducts = state.groupedProducts.filter((product) => {
        const matchesStock = state.stockOnly ? product.totalStock > 0 : true;
        const haystack = [
            product.brandName,
            product.genericName,
            product.barcode,
            product.productCode,
            product.storageRoom,
            product.category
        ].join(' ').toLowerCase();

        const matchesQuery = state.query ? haystack.includes(state.query) : true;
        return matchesStock && matchesQuery;
    });

    const totalUnits = visibleProducts.reduce((sum, item) => sum + item.totalStock, 0);
    const lowStockCount = visibleProducts.filter((item) => item.totalStock > 0 && item.totalStock <= 10).length;

    elements.productsCount.textContent = formatNumber(visibleProducts.length);
    elements.unitsCount.textContent = formatNumber(totalUnits);
    elements.lowStockCount.textContent = formatNumber(lowStockCount);
    elements.statusText.textContent = state.loading
        ? 'Loading stock data...'
        : `${formatNumber(visibleProducts.length)} product${visibleProducts.length === 1 ? '' : 's'} shown`;
    elements.updatedText.textContent = state.generatedAt
        ? `Last updated ${new Date(state.generatedAt).toLocaleString()}`
        : '';

    if (visibleProducts.length === 0) {
        elements.inventoryGrid.innerHTML = '<article class="empty-state">No products match your current search.</article>';
        return;
    }

    elements.inventoryGrid.innerHTML = visibleProducts.map(renderProductCard).join('');
}

function renderProductCard(product) {
    const stockTone = product.totalStock <= 10 ? 'stock-badge low' : 'stock-badge';
    const batches = product.batches.map((batch) => `
        <li class="batch-row">
            <div>
                <strong>${escapeHtml(batch.batchNumber)}</strong>
                <span>${escapeHtml(batch.expiryDate || 'No expiry')}</span>
            </div>
            <span>${formatNumber(batch.stock)}</span>
        </li>
    `).join('');

    return `
        <article class="product-card">
            <div class="card-header">
                <div>
                    <p class="product-name">${escapeHtml(product.brandName)}</p>
                    <p class="product-subtitle">${escapeHtml(product.genericName || 'Generic name not provided')}</p>
                </div>
                <span class="${stockTone}">${formatNumber(product.totalStock)} in stock</span>
            </div>
            <dl class="product-meta">
                <div>
                    <dt>Product Code</dt>
                    <dd>${escapeHtml(product.productCode || 'N/A')}</dd>
                </div>
                <div>
                    <dt>Barcode</dt>
                    <dd>${escapeHtml(product.barcode || 'N/A')}</dd>
                </div>
                <div>
                    <dt>Storage</dt>
                    <dd>${escapeHtml(product.storageRoom || 'N/A')}</dd>
                </div>
                <div>
                    <dt>Category</dt>
                    <dd>${escapeHtml(product.category || 'N/A')}</dd>
                </div>
            </dl>
            <div class="batch-section">
                <div class="batch-heading">
                    <span>Batches</span>
                    <span>${formatNumber(product.batches.length)}</span>
                </div>
                <ul class="batch-list">${batches}</ul>
            </div>
        </article>
    `;
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
