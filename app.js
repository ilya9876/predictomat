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

const prefersHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

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
    const inspector = card.querySelector('.chart-inspector');
    renderMarketChart(canvas, market.snapshots, inspector);
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
      <div class="chart-inspector is-idle" role="status" aria-live="polite">
        <span class="inspector-item inspector-date">${prefersHover ? 'Hover a point to inspect exact values.' : 'Tap a point to inspect exact values.'}</span>
        <span class="inspector-item inspector-crowd">Crowd: —</span>
        <span class="inspector-item inspector-mine">Mine: —</span>
        <span class="inspector-item inspector-gap">Gap: —</span>
      </div>
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

function renderMarketChart(canvas, snapshots, inspector) {
  const context = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(canvas.clientWidth, 280);
  const cssHeight = 250;

  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);
  canvas.style.touchAction = 'manipulation';

  const width = cssWidth;
  const height = cssHeight;
  const padding = { top: 18, right: 12, bottom: 30, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const chartModel = createChartModel(snapshots, padding, plotWidth, plotHeight);
  let activeIndex = null;

  const redraw = () => {
    context.clearRect(0, 0, width, height);
    drawGrid(context, padding, plotWidth, plotHeight);
    if (activeIndex !== null) {
      drawActiveGuide(context, chartModel.points[activeIndex], padding, plotHeight);
    }
    drawSeries(context, chartModel.points, 'crowdY', '#2c6fd6');
    drawSeries(context, chartModel.points, 'mineY', '#c14b4b');
    if (activeIndex !== null) {
      drawActivePoints(context, chartModel.points[activeIndex]);
    }
    drawAxisLabels(context, chartModel.points, width, height, padding, plotWidth);
  };

  const setActiveIndex = (nextIndex) => {
    if (activeIndex === nextIndex) return;
    activeIndex = nextIndex;
    redraw();
    updateInspector(inspector, chartModel.points, activeIndex);
  };

  const handlePointerMove = (event) => {
    if (event.pointerType === 'touch' || !prefersHover) return;
    const nextIndex = getNearestPointIndex(canvas, chartModel.points, event, 18);
    setActiveIndex(nextIndex);
  };

  const handlePointerLeave = () => {
    if (!prefersHover) return;
    setActiveIndex(null);
  };

  const handlePointerDown = (event) => {
    const threshold = event.pointerType === 'touch' ? 28 : 18;
    const nextIndex = getNearestPointIndex(canvas, chartModel.points, event, threshold);

    if (nextIndex === null) {
      if (event.pointerType === 'touch' || !prefersHover) {
        setActiveIndex(null);
      }
      return;
    }

    if (event.pointerType === 'touch' && activeIndex === nextIndex) {
      setActiveIndex(null);
      return;
    }

    setActiveIndex(nextIndex);
  };

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerleave', handlePointerLeave);
  canvas.addEventListener('pointerdown', handlePointerDown);

  redraw();
  updateInspector(inspector, chartModel.points, null);
}

function createChartModel(snapshots, padding, plotWidth, plotHeight) {
  const points = snapshots.map((snapshot, index) => {
    const x = getX(index, snapshots.length, padding.left, plotWidth);
    const crowd = Number(snapshot.crowd_probability_percent);
    const mine = Number(snapshot.my_probability_percent);

    return {
      index,
      date: snapshot.date,
      crowd,
      mine,
      gap: roundOneDecimal(Math.abs(mine - crowd)),
      x,
      crowdY: padding.top + plotHeight - (crowd / 100) * plotHeight,
      mineY: padding.top + plotHeight - (mine / 100) * plotHeight,
    };
  });

  return { points };
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

function drawSeries(ctx, points, yKey, color) {
  if (!points.length) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.beginPath();

  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point[yKey]);
    } else {
      ctx.lineTo(point.x, point[yKey]);
    }
  });

  ctx.stroke();

  points.forEach((point) => {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point[yKey], 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function drawActiveGuide(ctx, point, padding, plotHeight) {
  ctx.save();
  ctx.strokeStyle = 'rgba(40, 35, 29, 0.32)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(point.x, padding.top);
  ctx.lineTo(point.x, padding.top + plotHeight);
  ctx.stroke();
  ctx.restore();
}

function drawActivePoints(ctx, point) {
  const configs = [
    { y: point.crowdY, color: '#2c6fd6' },
    { y: point.mineY, color: '#c14b4b' },
  ];

  configs.forEach(({ y, color }) => {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(point.x, y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function drawAxisLabels(ctx, points, width, height, padding, plotWidth) {
  if (!points.length) return;

  const labelIndexes = [0, Math.floor((points.length - 1) / 2), points.length - 1]
    .filter((value, index, array) => array.indexOf(value) === index);

  ctx.fillStyle = '#6a6156';
  ctx.font = '12px Trebuchet MS, Arial, sans-serif';

  labelIndexes.forEach((index) => {
    const label = formatDateLabel(points[index].date);
    const x = getX(index, points.length, padding.left, plotWidth);
    const metrics = ctx.measureText(label);
    const clampedX = clamp(x - metrics.width / 2, 0, width - metrics.width);
    ctx.fillText(label, clampedX, height - 8);
  });
}

function getNearestPointIndex(canvas, points, event, threshold) {
  if (!points.length) return null;

  const rect = canvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const plotLeft = points[0].x;
  const plotRight = points[points.length - 1].x;

  if (pointerX < plotLeft - threshold || pointerX > plotRight + threshold) {
    return null;
  }

  let nearestIndex = 0;
  let nearestDistance = Math.abs(points[0].x - pointerX);

  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.abs(points[index].x - pointerX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestDistance <= threshold ? nearestIndex : null;
}

function updateInspector(inspector, points, activeIndex) {
  if (!inspector) return;

  const dateEl = inspector.querySelector('.inspector-date');
  const crowdEl = inspector.querySelector('.inspector-crowd');
  const mineEl = inspector.querySelector('.inspector-mine');
  const gapEl = inspector.querySelector('.inspector-gap');

  if (activeIndex === null || !points[activeIndex]) {
    inspector.classList.add('is-idle');
    dateEl.textContent = prefersHover ? 'Hover a point to inspect exact values.' : 'Tap a point to inspect exact values.';
    crowdEl.textContent = 'Crowd: —';
    mineEl.textContent = 'Mine: —';
    gapEl.textContent = 'Gap: —';
    return;
  }

  const point = points[activeIndex];
  inspector.classList.remove('is-idle');
  dateEl.textContent = formatFullDate(point.date);
  crowdEl.textContent = `Crowd: ${formatPercent(point.crowd)}%`;
  mineEl.textContent = `Mine: ${formatPercent(point.mine)}%`;
  gapEl.textContent = `Gap: ${formatPercent(point.gap)} pp`;
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

function formatFullDate(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
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
