const state = {
  section: 'markets',
  view: 'active',
  data: null,
  quarterlyData: null,
  lastUpdatedDisplay: null,
};

const elements = {
  lastUpdated: document.getElementById('last-updated'),
  marketList: document.getElementById('market-list'),
  marketCount: document.getElementById('market-count'),
  activeTab: document.getElementById('active-tab'),
  archivedTab: document.getElementById('archived-tab'),
  sectionMarkets: document.getElementById('section-markets'),
  sectionQuarterly: document.getElementById('section-quarterly'),
  panelMarkets: document.getElementById('panel-markets'),
  panelQuarterly: document.getElementById('panel-quarterly'),
  quarterlyList: document.getElementById('quarterly-list'),
};

const prefersHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const EARLY_LEAD_MIN_GAP_PP = 10;
const EARLY_LEAD_CONVERGENCE_TOLERANCE_PP = 3;

init();

async function init() {
  bindEvents();

  try {
    const response = await fetch(`data/desired.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const responseLastModified = response.headers.get('last-modified');
    state.data = await response.json();
    state.lastUpdatedDisplay = resolveLastUpdated(state.data?.last_updated, responseLastModified);
    renderPage();
  } catch (error) {
    renderLoadError();
    console.error('Unable to load desired.json', error);
  }

  try {
    const qResponse = await fetch(`data/quarterly.json?v=${Date.now()}`, { cache: 'no-store' });
    if (qResponse.ok) {
      state.quarterlyData = await qResponse.json();
      if (state.section === 'quarterly') {
        renderQuarterly();
      }
    }
  } catch (error) {
    console.error('Unable to load quarterly.json', error);
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

  elements.sectionMarkets.addEventListener('click', () => {
    if (state.section !== 'markets') {
      state.section = 'markets';
      updateSectionNav();
      renderPage();
    }
  });

  elements.sectionQuarterly.addEventListener('click', () => {
    if (state.section !== 'quarterly') {
      state.section = 'quarterly';
      updateSectionNav();
      renderQuarterly();
    }
  });
}

function updateSectionNav() {
  elements.sectionMarkets.classList.toggle('is-active', state.section === 'markets');
  elements.sectionQuarterly.classList.toggle('is-active', state.section === 'quarterly');
  elements.panelMarkets.classList.toggle('panel-hidden', state.section !== 'markets');
  elements.panelQuarterly.classList.toggle('panel-hidden', state.section !== 'quarterly');
}

function renderPage() {
  if (!state.data) return;

  elements.lastUpdated.textContent = `Last updated: ${formatLastUpdated(state.lastUpdatedDisplay)}`;

  const renderableMarkets = (state.data.markets || []).filter(isRenderableMarket);
  const totalCount = renderableMarkets.length;
  elements.marketCount.textContent = `${totalCount} tracked market${totalCount === 1 ? '' : 's'}`;

  elements.activeTab.classList.toggle('is-active', state.view === 'active');
  elements.archivedTab.classList.toggle('is-active', state.view === 'archived');

  const filteredMarkets = renderableMarkets
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

function getEarlyLeadStatus(market) {
  const snapshots = market.snapshots || [];

  for (let index = 0; index < snapshots.length - 1; index += 1) {
    const snapshot = snapshots[index];
    const crowd = Number(snapshot.crowd_probability_percent);
    const mine = Number(snapshot.my_probability_percent);
    const gap = Math.abs(mine - crowd);

    if (gap < EARLY_LEAD_MIN_GAP_PP) continue;

    let bestFutureDistance = Number.POSITIVE_INFINITY;

    for (let futureIndex = index + 1; futureIndex < snapshots.length; futureIndex += 1) {
      const futureCrowd = Number(snapshots[futureIndex].crowd_probability_percent);
      const distanceToMyEarlierView = Math.abs(futureCrowd - mine);
      bestFutureDistance = Math.min(bestFutureDistance, distanceToMyEarlierView);
    }

    if (bestFutureDistance <= EARLY_LEAD_CONVERGENCE_TOLERANCE_PP) {
      return 'confirmed';
    }
  }

  return 'not yet';
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
  const earlyLead = getEarlyLeadStatus(market);
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
      ${createStat('Early lead', escapeHtml(earlyLead), earlyLead === 'confirmed' ? 'stat-early-lead-confirmed' : '')}
    </div>

    <div class="chart-shell">
      <div class="chart-legend" aria-hidden="true">
        <span class="legend-item"><span class="legend-swatch crowd"></span> Crowd</span>
        <span class="legend-item"><span class="legend-swatch mine"></span> Mine</span>
      </div>
      <canvas aria-label="Probability chart for ${escapeAttribute(market.title)}"></canvas>
      <div class="chart-inspector is-idle" role="status" aria-live="polite">
        <span class="inspector-item inspector-date">${prefersHover ? 'Hover a point to inspect' : 'Tap a point to inspect exact values.'}</span>
        <span class="inspector-item inspector-crowd">Crowd: —</span>
        <span class="inspector-item inspector-mine">Mine: —</span>
        <span class="inspector-item inspector-gap">Gap: —</span>
      </div>
    </div>
  `;

  return article;
}

function createStat(label, value, modifierClass = '') {
  const className = ['stat', modifierClass].filter(Boolean).join(' ');
  return `
    <div class="${className}">
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
    dateEl.textContent = prefersHover ? 'Hover a point to inspect' : 'Tap a point to inspect exact values.';
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

function resolveLastUpdated(jsonValue, headerValue) {
  const headerDate = headerValue ? new Date(headerValue) : null;
  if (headerDate && !Number.isNaN(headerDate.getTime())) {
    return headerDate.toISOString();
  }

  return jsonValue || null;
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

function renderQuarterly() {
  elements.quarterlyList.innerHTML = '';

  if (!state.quarterlyData || !Array.isArray(state.quarterlyData.entries) || state.quarterlyData.entries.length === 0) {
    const empty = document.createElement('section');
    empty.className = 'empty-state';
    empty.innerHTML = '<h3>No quarterly notes yet.</h3><p>Entries will appear here once published.</p>';
    elements.quarterlyList.appendChild(empty);
    return;
  }

  const sorted = [...state.quarterlyData.entries]
    .filter(isRenderableQuarterlyEntry)
    .sort((a, b) => b.published.localeCompare(a.published));

  if (sorted.length === 0) {
    const empty = document.createElement('section');
    empty.className = 'empty-state';
    empty.innerHTML = '<h3>No quarterly notes yet.</h3><p>Entries will appear here once published.</p>';
    elements.quarterlyList.appendChild(empty);
    return;
  }

  for (const entry of sorted) {
    elements.quarterlyList.appendChild(createQuarterlyCard(entry));
  }
}

function isRenderableQuarterlyEntry(entry) {
  if (!entry || typeof entry.entry_id !== 'string' || !entry.entry_id) return false;
  if (typeof entry.published !== 'string' || !entry.published) return false;
  if (typeof entry.subject !== 'string' || !entry.subject) return false;
  if (entry.stage2 && Array.isArray(entry.assumptions)) return true;
  if (typeof entry.summary === 'string' && entry.summary) return true;
  return false;
}

function isIRCheckEntry(entry) {
  return Boolean(entry.stage2 && Array.isArray(entry.assumptions));
}

function createQuarterlyCard(entry) {
  if (isIRCheckEntry(entry)) {
    return createIRCheckCard(entry);
  }
  return createLegacyQuarterlyCard(entry);
}

function createLegacyQuarterlyCard(entry) {
  const article = document.createElement('article');
  article.className = 'quarterly-card';
  article.dataset.entryId = entry.entry_id;

  const watchpointsHtml = Array.isArray(entry.watchpoints) && entry.watchpoints.length > 0
    ? `<span class="quarterly-watchpoints-label">Watchpoints</span>
       <ul class="quarterly-watchpoints">
         ${entry.watchpoints.map((wp) => `<li>${escapeHtml(wp)}</li>`).join('')}
       </ul>`
    : '';

  article.innerHTML = `
    <div class="quarterly-card-header">
      <h3>${escapeHtml(entry.subject)}</h3>
      <div class="quarterly-card-meta">${escapeHtml(entry.quarter || '')} · Published ${escapeHtml(formatFullDate(entry.published))}</div>
    </div>
    <p class="quarterly-summary">${escapeHtml(entry.summary)}</p>
    ${watchpointsHtml}
  `;

  return article;
}

function getIRVerdict(entry) {
  const s2 = entry.stage2;
  const threshold = 55;
  const isNoise = s2.confidence_label === 'noise' || s2.confidence_label === 'fragile' || s2.surprise_probability_percent < threshold;

  if (entry.status !== 'resolved') {
    if (isNoise) return { type: 'pending-noise', icon: '—', label: 'No actionable signal', cssClass: 'verdict-noise' };
    return { type: 'pending-signal', icon: '!', label: 'Signal detected — awaiting resolution', cssClass: 'verdict-pending' };
  }

  if (isNoise) return { type: 'noise', icon: '—', label: 'No actionable signal', cssClass: 'verdict-noise' };
  if (s2.direction_correct) return { type: 'hit', icon: '\u2713', label: 'Signal confirmed', cssClass: 'verdict-hit' };
  return { type: 'miss', icon: '\u2717', label: 'Signal missed', cssClass: 'verdict-miss' };
}

function buildVerdictExplanation(entry, verdict) {
  const s2 = entry.stage2;
  const prob = s2.surprise_probability_percent;
  const dir = s2.predicted_direction === 'miss' ? 'below consensus' : 'above consensus';
  const currency = s2.consensus_currency === 'EUR' ? '\u20ac' : '$';

  if (entry.status !== 'resolved') {
    if (verdict.type === 'pending-noise') {
      return `System estimates ${prob}% surprise probability (${s2.confidence_label}). Resolution expected ${escapeHtml(formatFullDate(entry.resolution_date))}.`;
    }
    return `System estimates ${prob}% surprise probability, direction: ${dir}. Resolution expected ${escapeHtml(formatFullDate(entry.resolution_date))}.`;
  }

  const actDir = s2.actual_direction === 'above_consensus' ? 'above' : 'below';
  const devPct = s2.actual_deviation_percent;

  if (verdict.type === 'noise') {
    return `System estimated ${prob}% surprise probability (${s2.confidence_label}). Actual EPS came in ${devPct}% ${actDir} consensus \u2014 deviation was real, but signal too weak to call direction.`;
  }
  if (verdict.type === 'hit') {
    return `System estimated ${prob}% surprise probability, direction: ${dir}. Actual EPS came in ${devPct}% ${actDir} consensus \u2014 the predicted deviation materialized.`;
  }
  return `System estimated ${prob}% surprise probability, direction: ${dir}. Actual EPS came in ${devPct}% ${actDir} consensus \u2014 the system called a deviation but got the direction wrong.`;
}

function createIRCheckCard(entry) {
  const article = document.createElement('article');
  article.className = 'quarterly-card ir-check-card';
  article.dataset.entryId = entry.entry_id;

  const s2 = entry.stage2;
  const verdict = getIRVerdict(entry);
  const explanation = buildVerdictExplanation(entry, verdict);
  const currency = s2.consensus_currency === 'EUR' ? '\u20ac' : '$';
  const isResolved = entry.status === 'resolved';
  const detailsId = `ir-details-${entry.entry_id.replace(/[^a-zA-Z0-9-]/g, '')}`;
  const chevronId = `ir-chev-${entry.entry_id.replace(/[^a-zA-Z0-9-]/g, '')}`;

  const metaParts = [];
  if (entry.analysis_date) metaParts.push(`Analysis: ${escapeHtml(formatFullDate(entry.analysis_date))}`);
  if (entry.consensus_date) metaParts.push(`Consensus as of: ${escapeHtml(formatFullDate(entry.consensus_date))}`);
  if (entry.resolution_date) {
    const resLabel = isResolved ? 'Resolved' : 'Resolution';
    metaParts.push(`${resLabel}: ${escapeHtml(formatFullDate(entry.resolution_date))}`);
  }

  const correctCount = entry.assumptions.filter((a) => a.call_correct === true).length;
  const incorrectCount = entry.assumptions.filter((a) => a.call_correct === false).length;
  const mismatchCount = entry.assumptions.filter((a) => a.stage1_verdict === 'material_mismatch').length;

  let detailsLabel = '';
  if (isResolved) {
    detailsLabel = `Underlying assumptions (${correctCount} correct, ${incorrectCount} incorrect)`;
  } else {
    detailsLabel = `Underlying assumptions (${mismatchCount} mismatch, ${entry.assumptions.length - mismatchCount} aligned)`;
  }

  const assumptionsHtml = entry.assumptions.map((a) => {
    let resultHtml = '';
    if (isResolved && typeof a.call_correct === 'boolean') {
      if (a.call_correct) {
        resultHtml = `<div class="ir-a-result ir-a-correct"><span class="ir-a-dot ir-a-dot-ok"></span> Correct</div>`;
      } else {
        resultHtml = `<div class="ir-a-result ir-a-incorrect"><span class="ir-a-dot ir-a-dot-bad"></span> Incorrect</div>`;
      }
      if (a.actual_value) {
        resultHtml += `<div class="ir-a-actual">Actual: ${escapeHtml(a.actual_value)}</div>`;
      }
    } else {
      const verdictLabel = a.stage1_verdict === 'material_mismatch' ? 'Mismatch' : 'Aligned';
      const verdictClass = a.stage1_verdict === 'material_mismatch' ? 'ir-a-mismatch' : 'ir-a-aligned';
      resultHtml = `<div class="ir-a-result ${verdictClass}">${escapeHtml(verdictLabel)}</div>`;
      if (a.mismatch_drivers) {
        resultHtml += `<div class="ir-a-actual">${escapeHtml(a.mismatch_drivers)}</div>`;
      }
    }

    return `
      <div class="ir-a-card">
        <div class="ir-a-id">${escapeHtml(a.assumption_id)}</div>
        <div class="ir-a-name">${escapeHtml(a.name)}</div>
        <div class="ir-a-test">${escapeHtml(a.testable_question)}</div>
        ${resultHtml}
      </div>
    `;
  }).join('');

  let metricsHtml = '';
  if (isResolved) {
    const actDir = s2.actual_direction === 'above_consensus' ? 'Above' : 'Below';
    metricsHtml = `
      <div class="ir-metrics">
        <div class="ir-metric">
          <div class="ir-metric-label">Consensus EPS</div>
          <div class="ir-metric-value">${currency}${s2.consensus_eps}</div>
          <div class="ir-metric-sub">Analyst benchmark</div>
        </div>
        <div class="ir-metric">
          <div class="ir-metric-label">Actual EPS</div>
          <div class="ir-metric-value">${currency}${s2.actual_eps}</div>
          <div class="ir-metric-sub">${actDir} consensus ${s2.actual_deviation_percent > 0 ? '+' : ''}${s2.actual_deviation_percent}%</div>
        </div>
        <div class="ir-metric">
          <div class="ir-metric-label">Surprise probability</div>
          <div class="ir-metric-value">${s2.surprise_probability_percent}%</div>
          <div class="ir-metric-sub">${escapeHtml(s2.confidence_label || '')}</div>
        </div>
      </div>
    `;
  } else {
    metricsHtml = `
      <div class="ir-metrics">
        <div class="ir-metric">
          <div class="ir-metric-label">Consensus EPS</div>
          <div class="ir-metric-value">${currency}${s2.consensus_eps}</div>
          <div class="ir-metric-sub">Analyst benchmark</div>
        </div>
        <div class="ir-metric">
          <div class="ir-metric-label">Surprise probability</div>
          <div class="ir-metric-value">${s2.surprise_probability_percent}%</div>
          <div class="ir-metric-sub">${escapeHtml(s2.confidence_label || '')}</div>
        </div>
        <div class="ir-metric">
          <div class="ir-metric-label">Predicted direction</div>
          <div class="ir-metric-value">${s2.predicted_direction === 'miss' ? 'Below' : 'Above'}</div>
          <div class="ir-metric-sub">consensus</div>
        </div>
      </div>
    `;
  }

  let scoreHtml = '';
  if (isResolved) {
    const dirLabel = s2.direction_correct ? 'correct' : `${s2.predicted_direction} predicted, actual ${s2.actual_direction === 'above_consensus' ? 'above' : 'below'} consensus`;
    scoreHtml = `
      <div class="ir-score-row">
        <span class="ir-score-item"><span class="ir-a-dot ir-a-dot-ok"></span> ${correctCount} correct</span>
        <span class="ir-score-item"><span class="ir-a-dot ir-a-dot-bad"></span> ${incorrectCount} incorrect</span>
        <span class="ir-score-item ir-score-dim">Stage 2 direction: ${escapeHtml(dirLabel)}</span>
      </div>
    `;
  }

  const statusBadge = isResolved
    ? '<span class="ir-status-badge ir-status-resolved">Resolved</span>'
    : '<span class="ir-status-badge ir-status-pending">Pending</span>';

  article.innerHTML = `
    <div class="ir-header-row">
      <div>
        <h3>${escapeHtml(entry.subject)}</h3>
        <div class="ir-meta">${metaParts.join(' \u00b7 ')}</div>
      </div>
      <div class="ir-header-right">
        ${statusBadge}
        <span class="ir-quarter-tag">${escapeHtml(entry.quarter || '')}</span>
      </div>
    </div>
    <div class="ir-verdict-row">
      <div class="ir-verdict-icon ${verdict.cssClass}">${verdict.icon}</div>
      <div class="ir-verdict-text">
        <div class="ir-verdict-headline">${escapeHtml(verdict.label)}</div>
        <div class="ir-verdict-explain">${escapeHtml(explanation)}</div>
      </div>
    </div>
    ${metricsHtml}
    <div class="ir-details-toggle" data-target="${detailsId}" data-chevron="${chevronId}">
      <span class="ir-chevron" id="${chevronId}">\u25b6</span> ${escapeHtml(detailsLabel)}
    </div>
    <div class="ir-details-body" id="${detailsId}">
      <div class="ir-assumptions">${assumptionsHtml}</div>
    </div>
    ${scoreHtml}
  `;

  const toggle = article.querySelector('.ir-details-toggle');
  toggle.addEventListener('click', () => {
    const body = article.querySelector(`#${detailsId}`);
    const chev = article.querySelector(`#${chevronId}`);
    const isOpen = body.classList.toggle('ir-details-open');
    chev.classList.toggle('ir-chevron-open', isOpen);
  });

  return article;
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
