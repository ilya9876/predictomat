const state = {
  view: 'active',
  data: null,
};

const elements = {
  lastUpdated: document.getElementById('last-updated'),
  marketList: document.getElementById('market-list'),
  activeTab: document.getElementById('active-tab'),
  archivedTab: document.getElementById('archived-tab'),
};

init();

async function init() {
  bindEvents();

  try {
    const response = await fetch('data/desired.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    state.data = await response.json();
    renderPage();
  } catch (error) {
    renderLoadError();
    console.error('Unable to load desired.json', error);
  }
}

function bindEvents() {
  elements.activeTab.addEventListener('click', () => {
    if (state.view !== 'active') {
      state.view = 'active';
      renderPage();
    }
  });

  elements.archivedTab.addEventListener('click', () => {
    if (state.view !== 'archived') {
      state.view = 'archived';
      renderPage();
    }
  });
}

function renderPage() {
  if (!state.data) return;

  elements.lastUpdated.textContent = `Last updated: ${formatLastUpdated(state.data.last_updated)}`;

  elements.activeTab.classList.toggle('is-active', state.view === 'active');
  elements.archivedTab.classList.toggle('is-active', state.view === 'archived');

  const filteredMarkets = (state.data.markets || [])
    .filter(isRenderableMarket)
    .filter((market) => market.status === state.view)
    .sort(state.view === 'active' ? sortActiveMarkets : sortArchivedMarkets);

  renderMarkets(filteredMarkets);
}

function renderLoadError() {
  elements.marketList.innerHTML = '';
  const box = document.createElement('section');
  box.className = 'empty-state';
  box.innerHTML = `
    <h3>Unable to load data.</h3>
    <p>Check whether <code>data/desired.json</code> exists and contains valid JSON.</p>
  `;
  elements.marketList.appendChild(box);
}

function isRenderableMarket(market) {
  return Boolean(
    market &&
      typeof market.track_id === 'string' &&
      market.track_id &&
      typeof market.title === 'string' &&
      market.title &&
      typeof market.polymarket_url === 'string' &&
      market.polymarket_url &&
      (market.status === 'active' || market.status === 'archived') &&
      Array.isArray(market.snapshots) &&
      market.snapshots.length > 0
  );
}

function sortActiveMarkets(a, b) {
  return getCurrentGap(b) - getCurrentGap(a);
}

function sortArchivedMarkets(a, b) {
  return getLatestSnapshotTime(b) - getLatestSnapshotTime(a);
}

function getLatestSnapshot(market) {
  return market.snapshots[market.snapshots.length - 1];
}

function getLatestSnapshotTime(market) {
  return new Date(getLatestSnapshot(market).date).getTime();
}

function getGap(snapshot) {
  return Math.abs(Number(snapshot.my_probability_percent) - Number(snapshot.crowd_probability_percent));
}

function getCurrentGap(market) {
  return roundOneDecimal(getGap(getLatestSnapshot(market)));
}

function getPeakInfo(market) {
  let peakSnapshot = market.snapshots[0];
  let peakGap = getGap(peakSnapshot);

  for (const snapshot of market.snapshots) {
    const gap = getGap(snapshot);
    if (gap > peakGap) {
      peakGap = gap;
      peakSnapshot = snapshot;
    }
  }

  return {
    peakGap: roundOneDecimal(peakGap),
    peakDate: peakSnapshot.date,
  };
}

function getRepricingProcess(market) {
  const currentGap = getCurrentGap(market);
  const { peakGap } = getPeakInfo(market);

  if (peakGap === 0) return 'flat';

  const ratio = currentGap / peakGap;

  if (ratio <= 0.7) return 'narrowing';
  if (ratio < 0.9) return 'flat';
  return 'widening';
}

function renderMarkets(markets) {
  elements.marketList.innerHTML = '';

  if (markets.length === 0) {
    const empty = document.createElement('section');
    empty.className = 'empty-state';
    empty.innerHTML = state.view === 'active'
      ? '<h3>No active markets right now.</h3><p>Upload a desired.json with markets marked as <code>active</code>.</p>'
      : '<h3>No archived markets yet.</h3><p>Archived markets will appear here once their status changes.</p>';
    elements.marketList.appendChild(empty);
    return;
  }

  for (const market of markets) {
    const card = createMarketCard(market);
    elements.marketList.appendChild(card);
    const canvas = card.querySelector('canvas');
    renderMarketChart(canvas, market.snapshots);
  }
}

function createMarketCard(market) {
  const latest = getLatestSnapshot(market);
  const currentGap = getCurrentGap(market);
  const { peakGap, peakDate } = getPeakInfo(market);
  const repricing = getRepricingProcess(market);
  const snapshotCount = market.snapshots.length;

  const article = document.createElement('article');
  article.className = 'market-card';
  article.dataset.trackId = market.track_id;

  article.innerHTML = `
    <div class="market-card-header">
      <h3>${escapeHtml(market.title)}</h3>
      <a class="market-link" href="${escapeAttribute(market.polymarket_url)}" target="_blank" rel="noopener noreferrer">Open on Polymarket</a>
      <div class="market-meta">Showing last ${snapshotCount} snapshot${snapshotCount === 1 ? '' : 's'}</div>
    </div>

    <div class="market-stats">
      ${createStat('Crowd', `${formatPercent(latest.crowd_probability_percent)}%`)}
      ${createStat('Mine', `${formatPercent(latest.my_probability_percent)}%`)}
      ${createStat('Current gap', `${formatPercent(currentGap)} pp`)}
      ${createStat('Peak divergence', `${formatPercent(peakGap)} pp`)}
      ${createStat('Peak date', escapeHtml(peakDate))}
      ${createStat('Repricing', escapeHtml(repricing))}
    </div>

    <div class="chart-shell">
      <div class="chart-legend" aria-hidden="true">
        <span class="legend-item"><span class="legend-swatch crowd"></span> Crowd</span>
        <span class="legend-item"><span class="legend-swatch mine"></span> Mine</span>
      </div>
      <canvas aria-label="Probability chart for ${escapeAttribute(market.title)}"></canvas>
    </div>
  `;

  return article;
}

function createStat(label, value) {
  return `
    <div class="stat">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
    </div>
  `;
}

function renderMarketChart(canvas, snapshots) {
  const context = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(canvas.clientWidth, 280);
  const cssHeight = 250;

  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);

  const width = cssWidth;
  const height = cssHeight;
  const padding = { top: 18, right: 12, bottom: 30, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  context.clearRect(0, 0, width, height);

  drawGrid(context, padding, plotWidth, plotHeight);
  drawSeries(context, snapshots, 'crowd_probability_percent', '#2c6fd6', padding, plotWidth, plotHeight);
  drawSeries(context, snapshots, 'my_probability_percent', '#c14b4b', padding, plotWidth, plotHeight);
  drawAxisLabels(context, snapshots, width, height, padding, plotWidth, plotHeight);
}

function drawGrid(ctx, padding, plotWidth, plotHeight) {
  ctx.strokeStyle = '#d9d0c2';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#6a6156';
  ctx.font = '12px Trebuchet MS, Arial, sans-serif';

  [0, 25, 50, 75, 100].forEach((value) => {
    const y = padding.top + plotHeight - (value / 100) * plotHeight;

    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotWidth, y);
    ctx.stroke();

    ctx.fillText(String(value), 3, y + 4);
  });
}

function drawSeries(ctx, snapshots, key, color, padding, plotWidth, plotHeight) {
  if (!snapshots.length) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();

  snapshots.forEach((snapshot, index) => {
    const x = getX(index, snapshots.length, padding.left, plotWidth);
    const y = padding.top + plotHeight - (Number(snapshot[key]) / 100) * plotHeight;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  snapshots.forEach((snapshot, index) => {
    const x = getX(index, snapshots.length, padding.left, plotWidth);
    const y = padding.top + plotHeight - (Number(snapshot[key]) / 100) * plotHeight;

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function drawAxisLabels(ctx, snapshots, width, height, padding, plotWidth) {
  if (!snapshots.length) return;

  const labelIndexes = [0, Math.floor((snapshots.length - 1) / 2), snapshots.length - 1]
    .filter((value, index, array) => array.indexOf(value) === index);

  ctx.fillStyle = '#6a6156';
  ctx.font = '12px Trebuchet MS, Arial, sans-serif';

  labelIndexes.forEach((index) => {
    const label = formatDateLabel(snapshots[index].date);
    const x = getX(index, snapshots.length, padding.left, plotWidth);
    const metrics = ctx.measureText(label);
    const clampedX = clamp(x - metrics.width / 2, 0, width - metrics.width);
    ctx.fillText(label, clampedX, height - 8);
  });
}

function getX(index, totalPoints, left, plotWidth) {
  if (totalPoints <= 1) {
    return left + plotWidth / 2;
  }
  return left + (index / (totalPoints - 1)) * plotWidth;
}

function formatLastUpdated(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function formatDateLabel(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
  }).format(date);
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function roundOneDecimal(value) {
  return Math.round(Number(value) * 10) / 10;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

window.addEventListener('resize', debounce(() => {
  if (!state.data) return;
  renderPage();
}, 120));

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
