// košarica: reads data/report.json and data/products.json and renders four views.
// No framework and no build step. All text from the data goes in through textContent.

const CHAIN_NAMES = {
  kaufland: 'Kaufland',
  konzum: 'Konzum',
  lidl: 'Lidl',
  plodine: 'Plodine',
  spar: 'Spar',
  studenac: 'Studenac',
};
const PAGE = 40;
const FAVORITES_KEY = 'kosarica:favorites';
const MIN_HEAT_PRODUCTS = 25; // fewer products than this: the index is shown as unreliable

const eur = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR' });
const int = new Intl.NumberFormat('hr-HR');
const pct = (v, digits = 1) => `${(v * 100).toLocaleString('hr-HR', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
const signedPct = (v, digits = 1) => {
  const r = Math.round(v * 100 * 10 ** digits) / 10 ** digits; // so -0.04 % shows as 0 %, not −0 %
  return (r > 0 ? '+' : r < 0 ? '−' : '') + pct(Math.abs(r) / 100, digits);
};
const chainName = (c) => CHAIN_NAMES[c] ?? c;
const dateHr = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('hr-HR', { day: 'numeric', month: 'long', year: 'numeric' });
const normalize = (s) =>
  s
    .toLowerCase()
    .replaceAll('đ', 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/** Tiny element builder: h('p', { class: 'x' }, 'text', child). Strings become text nodes. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function svgIcon(path, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}
const STAR = 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z';
const CHECK = 'M5 12.5 10 17l9-10';

// ---- favorites (kept in this browser only) ----
const favorites = {
  items: new Map(),
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '{}');
      this.items = new Map(Object.entries(saved).filter(([, q]) => Number.isInteger(q) && q > 0));
    } catch {
      this.items = new Map();
    }
  },
  save() {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(Object.fromEntries(this.items)));
    } catch {
      // private mode or storage full: favorites last until the page closes
    }
    updateFavCount();
  },
  has(gtin) {
    return this.items.has(gtin);
  },
  toggle(gtin) {
    if (this.items.has(gtin)) this.items.delete(gtin);
    else this.items.set(gtin, 1);
    this.save();
  },
  setQty(gtin, qty) {
    if (qty <= 0) this.items.delete(gtin);
    else this.items.set(gtin, qty);
    this.save();
  },
};

// ---- tooltip: one element, filled with text on hover or focus ----
const tooltip = document.getElementById('tooltip');
function bindTip(el, lines) {
  const show = (event) => {
    tooltip.replaceChildren(h('strong', {}, lines[0]), ...lines.slice(1).map((l) => h('div', {}, l)));
    tooltip.hidden = false;
    place(event);
  };
  const place = (event) => {
    const rect = el.getBoundingClientRect();
    const x = event?.clientX ?? rect.left + rect.width / 2;
    const y = event?.clientY ?? rect.top;
    const w = tooltip.offsetWidth;
    tooltip.style.left = `${Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8)}px`;
    tooltip.style.top = `${Math.max(8, y - tooltip.offsetHeight - 12)}px`;
  };
  const hide = () => (tooltip.hidden = true);
  el.addEventListener('pointerenter', show);
  el.addEventListener('pointermove', place);
  el.addEventListener('pointerleave', hide);
  el.addEventListener('focus', () => show());
  el.addEventListener('blur', hide);
}

// ---- data ----
let report;
let catalog; // { chains, categories, products: [{gtin, name, cat, prices, anchors, min, max, ...}] }

async function load() {
  const [r, p] = await Promise.all([fetch('data/report.json').then(ok), fetch('data/products.json').then(ok)]);
  report = r;
  catalog = {
    chains: p.chains,
    categories: p.categories,
    products: p.products.map(([gtin, name, cat, prices, anchors]) => {
      const present = prices.filter((x) => x != null);
      const min = Math.min(...present);
      const max = Math.max(...present);
      const anchorChanges = prices
        .map((price, i) => (price != null && anchors[i] ? price / anchors[i] - 1 : null))
        .filter((x) => x != null);
      return {
        gtin,
        name,
        cat,
        prices,
        anchors,
        min,
        max,
        saving: max - min,
        savingShare: max > 0 ? (max - min) / max : 0,
        chainsCount: present.length,
        anchorChange: anchorChanges.length ? median(anchorChanges) : null,
        search: normalize(name),
      };
    }),
  };
  catalog.byGtin = new Map(catalog.products.map((p) => [p.gtin, p]));
}
const ok = (res) => {
  if (!res.ok) throw new Error(`${res.url}: ${res.status}`);
  return res.json();
};
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- Pregled ----
function renderOverview() {
  const { summary, basket, cheapest, chains } = report;
  document.getElementById('as-of').textContent = `Zagreb i okolica · cijene od ${dateHr(summary.as_of)}`;
  const best = basket[0];
  const worst = basket.at(-1);
  document.getElementById('headline').textContent = best && worst && best !== worst
    ? `Ista košarica je u ${locative(best.chain)} ${pct(1 - best.total / worst.total, 0)} jeftinija nego u ${locative(worst.chain)}`
    : 'Cijene istih proizvoda u trgovačkim lancima';

  const kpis = [
    [int.format(summary.stores), 'trgovina'],
    [`${(summary.prices / 1e6).toLocaleString('hr-HR', { maximumFractionDigits: 2 })} mil.`, 'cijena danas'],
    [int.format(summary.products_in_several_chains), 'proizvoda u više lanaca'],
    [int.format(summary.days_collected), summary.days_collected === 1 ? 'dan podataka' : 'dana podataka'],
  ];
  document.getElementById('kpis').replaceChildren(...kpis.map(([v, l]) => h('div', { class: 'kpi' }, h('strong', {}, v), h('span', {}, l))));

  document.getElementById('basket-note').textContent = best
    ? `${int.format(best.items)} proizvoda koje prodaju svi lanci, svaki po srednjoj cijeni lanca`
    : '';
  const maxTotal = Math.max(...basket.map((b) => b.total));
  document.getElementById('basket').replaceChildren(
    ...basket.map((b, i) =>
      bar(b.chain, b.total / maxTotal, eur.format(b.total), i === 0 ? bestTag() : `+${pct(b.above_cheapest)}`, i === 0, [
        `${eur.format(b.total)}`,
        `${chainName(b.chain)}, ${int.format(b.items)} proizvoda`,
        i === 0 ? 'najjeftinija košarica' : `${pct(b.above_cheapest)} skuplje od najjeftinije`,
      ]),
    ),
  );

  const byShare = [...cheapest].sort((a, b) => b.cheapest_share - a.cheapest_share);
  document.getElementById('cheapest').replaceChildren(
    ...byShare.map((c, i) =>
      bar(c.chain, c.cheapest_share, pct(c.cheapest_share, 0), `${int.format(c.comparable_products)} proizvoda`, i === 0, [
        pct(c.cheapest_share),
        chainName(c.chain),
        `najjeftiniji za ${int.format(c.cheapest)} od ${int.format(c.comparable_products)} proizvoda`,
      ]),
    ),
  );

  const byOffer = [...chains].sort((a, b) => b.offer_share - a.offer_share);
  const maxOffer = Math.max(...byOffer.map((c) => c.offer_share), 0.01);
  document.getElementById('offers').replaceChildren(
    ...byOffer.map((c) =>
      bar(c.chain, c.offer_share / maxOffer, pct(c.offer_share), `${int.format(c.products)} proizvoda`, false, [
        pct(c.offer_share),
        chainName(c.chain),
        `${int.format(Math.round(c.offer_share * c.products))} od ${int.format(c.products)} proizvoda na akciji`,
      ]),
    ),
  );

  renderAnchor(chains);
  renderChanges(report.daily_changes);
}

function locative(chain) {
  return { kaufland: 'Kauflandu', konzum: 'Konzumu', lidl: 'Lidlu', plodine: 'Plodinama', spar: 'Sparu', studenac: 'Studencu' }[chain] ?? chainName(chain);
}

function bestTag() {
  const span = h('span', { class: 'tag-best' }, 'najjeftinije');
  span.prepend(svgIcon(CHECK));
  return span;
}

function bar(chain, share, value, sub, best, tip) {
  const row = h(
    'div',
    { class: `hbar${best ? ' best' : ''}`, tabindex: 0 },
    h('span', { class: 'name' }, chainName(chain)),
    h('span', { class: 'track' }, h('span', { class: 'fill', style: `width:${Math.max(0, Math.min(1, share)) * 100}%` })),
    h('span', { class: 'value' }, value, h('small', {}, sub)),
  );
  bindTip(row, tip);
  return row;
}

function renderAnchor(chains) {
  const parts = [
    ['down', 'pojeftinilo'],
    ['same', 'isto'],
    ['up', 'poskupjelo'],
  ];
  document
    .getElementById('anchor-legend')
    .replaceChildren(...parts.map(([cls, label]) => h('li', {}, h('i', { class: `seg ${cls}` }), label)));
  const rows = chains.filter((c) => c.compared).sort((a, b) => b.share_up_since_anchor - a.share_up_since_anchor);
  document.getElementById('anchor').replaceChildren(
    ...rows.map((c) => {
      const shares = { down: c.share_down_since_anchor, up: c.share_up_since_anchor };
      shares.same = Math.max(0, 1 - shares.down - shares.up);
      const segs = parts.map(([cls, label]) => {
        const seg = h('span', { class: `seg ${cls}`, style: `flex:${shares[cls]}`, tabindex: 0 }, shares[cls] >= 0.09 ? pct(shares[cls], 0) : '');
        bindTip(seg, [pct(shares[cls]), `${chainName(c.chain)}: ${label}`, `od ${int.format(c.compared)} cijena sa sidrenom cijenom`]);
        return seg;
      });
      return h('div', { class: 'stack' }, h('span', { class: 'name' }, chainName(c.chain)), h('div', { class: 'bar' }, segs));
    }),
  );
}

function renderChanges(rows) {
  const box = document.getElementById('changes');
  const byDay = new Map();
  for (const r of rows) {
    const d = byDay.get(r.day) ?? { day: r.day, up: 0, down: 0 };
    d.up += r.increases;
    d.down += r.decreases;
    byDay.set(r.day, d);
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  if (days.length < 2) {
    box.replaceChildren(
      h(
        'p',
        { class: 'note' },
        `Cijene se prate od ${dateHr(report.summary.as_of)} Promjene se vide od drugog dana prikupljanja, a graf od trećeg.`,
        days.length === 1 ? ` Prvi dan: ${int.format(days[0].up)} poskupljenja i ${int.format(days[0].down)} pojeftinjenja.` : '',
      ),
    );
    return;
  }
  box.replaceChildren(lineChart(days));
}

/** Two lines (increases, decreases) on one axis, with a crosshair tooltip. */
function lineChart(days) {
  const W = 720;
  const H = 240;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const max = Math.max(...days.flatMap((d) => [d.up, d.down]), 1);
  const x = (i) => pad.l + (i / Math.max(1, days.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const ns = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Poskupljenja i pojeftinjenja po danu' });
  const grid = s('g', { class: 'grid' });
  const axis = s('g', { class: 'axis' });
  for (const t of [0, 0.5, 1]) {
    grid.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(max * t), y2: y(max * t) }));
    const label = s('text', { x: pad.l - 6, y: y(max * t) + 4, 'text-anchor': 'end' });
    label.textContent = int.format(Math.round(max * t));
    axis.append(label);
  }
  const step = Math.ceil(days.length / 6);
  days.forEach((d, i) => {
    if (i % step && i !== days.length - 1) return;
    const label = s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' });
    label.textContent = new Date(`${d.day}T12:00:00`).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric' });
    axis.append(label);
  });
  svg.append(grid, axis);
  for (const [key, color] of [
    ['up', 'var(--up)'],
    ['down', 'var(--down)'],
  ]) {
    svg.append(s('path', { class: 'line', stroke: color, d: days.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d[key])}`).join('') }));
  }
  const cross = s('line', { class: 'crosshair', y1: pad.t, y2: H - pad.b, visibility: 'hidden' });
  const hit = s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' });
  svg.append(cross, hit);
  hit.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (days.length - 1));
    const d = days[Math.max(0, Math.min(days.length - 1, i))];
    cross.setAttribute('x1', x(days.indexOf(d)));
    cross.setAttribute('x2', x(days.indexOf(d)));
    cross.setAttribute('visibility', 'visible');
    tooltip.replaceChildren(
      h('strong', {}, dateHr(d.day)),
      h('div', {}, `${int.format(d.up)} poskupljenja`),
      h('div', {}, `${int.format(d.down)} pojeftinjenja`),
    );
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${event.clientY - tooltip.offsetHeight - 12}px`;
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  });
  const legend = h(
    'ul',
    { class: 'legend' },
    h('li', {}, h('i', { style: 'background:var(--up);height:3px' }), 'poskupljenja'),
    h('li', {}, h('i', { style: 'background:var(--down);height:3px' }), 'pojeftinjenja'),
  );
  return h('div', { class: 'chart' }, legend, svg);
}

// ---- Proizvodi ----
const filters = { q: '', cat: null, sort: 'common', onlyFav: false, shown: PAGE };

// above +100% a percentage stops reading well: "15×" says it faster than "+1.464 %"
const premiumText = (share) => (share >= 1 ? `${(share + 1).toLocaleString('hr-HR', { maximumFractionDigits: 1 })}× skuplje` : `+${pct(share, 0)}`);

function premiumClass(share) {
  if (share <= 0) return 'best';
  if (share < 0.05) return 'p1';
  if (share < 0.15) return 'p2';
  if (share < 0.3) return 'p3';
  return 'p4';
}

function renderPremiumLegend() {
  const items = [
    ['best', 'najjeftinije'],
    ['p1', 'do 5 % skuplje'],
    ['p2', '5–15 %'],
    ['p3', '15–30 %'],
    ['p4', 'više od 30 %'],
  ];
  document
    .getElementById('premium-legend')
    .replaceChildren(
      'Boja cijene: ',
      ...items.map(([cls, label]) => h('span', {}, h('i', { class: cls === 'best' ? '' : cls, style: cls === 'best' ? 'background:var(--brand-wash);outline:1px solid var(--brand)' : '' }), label)),
    );
}

function renderChips() {
  const counts = new Map();
  for (const p of catalog.products) counts.set(p.cat, (counts.get(p.cat) ?? 0) + 1);
  const chip = (cat, label, count) =>
    h(
      'button',
      {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(filters.cat === cat),
        onclick: () => {
          filters.cat = cat;
          filters.shown = PAGE;
          renderChips();
          renderProducts();
        },
      },
      label,
      h('span', {}, int.format(count)),
    );
  document
    .getElementById('categories')
    .replaceChildren(chip(null, 'Sve', catalog.products.length), ...catalog.categories.map((c, i) => chip(i, c, counts.get(i) ?? 0)));
}

function matchingProducts() {
  const words = normalize(filters.q).split(' ').filter(Boolean);
  let list = catalog.products.filter(
    (p) =>
      (filters.cat == null || p.cat === filters.cat) &&
      (!filters.onlyFav || favorites.has(p.gtin)) &&
      words.every((w) => p.search.includes(w)),
  );
  const sorters = {
    // sold by the most chains first: the products people buy everywhere, and the fairest comparisons
    common: (a, b) => b.chainsCount - a.chainsCount || b.savingShare - a.savingShare,
    savings: (a, b) => b.savingShare - a.savingShare || b.saving - a.saving,
    name: (a, b) => a.name.localeCompare(b.name, 'hr'),
    cheap: (a, b) => a.min - b.min,
    anchor: (a, b) => (b.anchorChange ?? -9) - (a.anchorChange ?? -9),
  };
  list = list.sort(sorters[filters.sort]);
  if (words.length && (filters.sort === 'common' || filters.sort === 'savings')) {
    // with a search, names that start with the first word come first
    const first = words[0];
    list.sort((a, b) => Number(b.search.startsWith(first)) - Number(a.search.startsWith(first)));
  }
  return list;
}

function productCard(p, { withQty = false } = {}) {
  const fav = favorites.has(p.gtin);
  const star = h('button', {
    class: 'star',
    type: 'button',
    'aria-pressed': String(fav),
    'aria-label': fav ? `Makni ${p.name} iz košarice` : `Dodaj ${p.name} u košaricu`,
    onclick: () => {
      favorites.toggle(p.gtin);
      if (location.hash === '#kosarica') renderMine();
      else star.setAttribute('aria-pressed', String(favorites.has(p.gtin)));
    },
  });
  star.append(svgIcon(STAR));

  const cheapestIndex = p.prices.indexOf(p.min);
  const prices = catalog.chains.map((chain, i) => {
    const price = p.prices[i];
    if (price == null) return h('div', { class: 'price none' }, h('span', { class: 'chain' }, chainName(chain)), h('span', { class: 'amount' }, '—'));
    const share = price / p.min - 1;
    const cls = premiumClass(share);
    const el = h(
      'div',
      { class: `price ${cls}`, tabindex: 0 },
      h('span', { class: 'chain' }, chainName(chain)),
      h('span', { class: 'amount' }, eur.format(price)),
      h('span', { class: 'diff' }, cls === 'best' ? 'najjeftinije' : premiumText(share)),
    );
    const anchor = p.anchors[i];
    bindTip(el, [
      eur.format(price),
      `${chainName(chain)}, srednja cijena u trgovinama`,
      cls === 'best' ? 'najniža cijena među lancima' : `${eur.format(price - p.min)} skuplje nego u ${locative(catalog.chains[cheapestIndex])}`,
      anchor ? `2. 5. 2025.: ${eur.format(anchor)} (${signedPct(price / anchor - 1)})` : 'bez sidrene cijene',
    ]);
    return el;
  });

  const meta = h('div', { class: 'meta' }, h('span', { class: 'cat' }, catalog.categories[p.cat]));
  if (p.chainsCount > 1 && p.saving > 0) {
    meta.append(h('span', { class: 'saving' }, `do ${eur.format(p.saving)} jeftinije u ${locative(catalog.chains[cheapestIndex])}`));
  }
  if (p.anchorChange != null && Math.abs(p.anchorChange) >= 0.005) {
    const up = p.anchorChange > 0;
    meta.append(
      h(
        'span',
        { class: 'drift' },
        h('i', { style: `background:var(${up ? '--up' : '--down'})` }),
        `od svibnja 2025. ${signedPct(p.anchorChange, 0)}`,
      ),
    );
  }
  if (withQty) {
    const qty = favorites.items.get(p.gtin) ?? 1;
    meta.append(
      h(
        'span',
        { class: 'qty', role: 'group', 'aria-label': 'Količina' },
        h('button', { type: 'button', 'aria-label': 'Manje', onclick: () => (favorites.setQty(p.gtin, qty - 1), renderMine()) }, '−'),
        h('output', {}, qty),
        h('button', { type: 'button', 'aria-label': 'Više', onclick: () => (favorites.setQty(p.gtin, qty + 1), renderMine()) }, '+'),
      ),
    );
  }

  return h('li', { class: 'product' }, star, h('h3', {}, p.name), meta, h('div', { class: 'prices' }, prices));
}

function renderProducts() {
  const list = matchingProducts();
  document.getElementById('result-count').textContent =
    list.length === 0 ? 'Nema proizvoda za tu pretragu.' : `${int.format(list.length)} ${plural(list.length, 'proizvod', 'proizvoda', 'proizvoda')}`;
  document.getElementById('products').replaceChildren(...list.slice(0, filters.shown).map((p) => productCard(p)));
  const more = document.getElementById('more');
  more.hidden = list.length <= filters.shown;
  more.textContent = `Prikaži još (${int.format(list.length - filters.shown)})`;
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---- Kategorije ----
function heatClass(v) {
  if (v <= -0.1) return 'b-3';
  if (v <= -0.05) return 'b-2';
  if (v <= -0.02) return 'b-1';
  if (v < 0.02) return 'b0';
  if (v < 0.05) return 'b1';
  if (v < 0.1) return 'b2';
  return 'b3';
}

function renderHeat() {
  const legend = [
    ['b-3', '10 % ili više jeftinije'],
    ['b-2', '5–10 %'],
    ['b-1', '2–5 %'],
    ['b0', 'oko prosjeka'],
    ['b1', '2–5 %'],
    ['b2', '5–10 %'],
    ['b3', '10 % ili više skuplje'],
  ];
  document.getElementById('heat-legend').replaceChildren(...legend.map(([cls, label]) => h('li', {}, h('i', { class: cls }), label)));

  const chains = [...new Set(report.categories.map((c) => c.chain))].sort();
  const cells = new Map(report.categories.map((c) => [`${c.category}|${c.chain}`, c]));
  const totals = new Map();
  for (const c of report.categories) totals.set(c.category, (totals.get(c.category) ?? 0) + c.products);
  const categories = [...totals.keys()]
    .filter((c) => totals.get(c) >= MIN_HEAT_PRODUCTS * 2)
    .sort((a, b) => (a === 'Ostalo') - (b === 'Ostalo') || totals.get(b) - totals.get(a));

  const head = h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Kategorija')), ...chains.map((c) => h('th', { scope: 'col' }, chainName(c))));
  const body = categories.map((category) => {
    const row = h('tr', {}, h('th', { scope: 'row' }, category, h('small', {}, `${int.format(Math.round(totals.get(category) / chains.length))} proizvoda po lancu`)));
    for (const chain of chains) {
      const c = cells.get(`${category}|${chain}`);
      if (!c) {
        row.append(h('td', {}, h('button', { class: 'thin', type: 'button', disabled: true }, '—')));
        continue;
      }
      const thin = c.products < MIN_HEAT_PRODUCTS;
      const button = h(
        'button',
        {
          class: thin ? 'thin' : heatClass(c.index_vs_average),
          type: 'button',
          onclick: () => {
            filters.cat = catalog.categories.indexOf(category);
            filters.q = '';
            filters.shown = PAGE;
            document.getElementById('q').value = '';
            location.hash = '#proizvodi';
          },
        },
        thin ? 'malo podataka' : signedPct(c.index_vs_average, 0),
      );
      bindTip(button, [
        thin ? `${int.format(c.products)} proizvoda` : signedPct(c.index_vs_average),
        `${chainName(chain)}: ${category}`,
        thin ? 'premalo zajedničkih proizvoda za pouzdanu usporedbu' : 'u odnosu na prosjek lanaca koji prodaju iste proizvode',
        `${int.format(c.products)} proizvoda, najjeftiniji za ${pct(c.cheapest_share, 0)}`,
      ]);
      row.append(h('td', {}, button));
    }
    return row;
  });
  document.getElementById('heat').replaceChildren(h('thead', {}, head), h('tbody', {}, body));
}

// ---- Moja košarica ----
function renderMine() {
  const items = [...favorites.items.entries()].map(([gtin, qty]) => ({ p: catalog.byGtin.get(gtin), qty })).filter((x) => x.p);
  document.getElementById('basket-empty').hidden = items.length > 0;
  document.getElementById('basket-full').hidden = items.length === 0;
  if (!items.length) return;

  const totals = catalog.chains.map((chain, i) => {
    let total = 0;
    let missing = 0;
    for (const { p, qty } of items) {
      if (p.prices[i] == null) missing += 1;
      else total += p.prices[i] * qty;
    }
    return { chain, total, missing };
  });
  // a fair comparison needs every product; chains missing some are listed after
  const complete = totals.filter((t) => t.missing === 0).sort((a, b) => a.total - b.total);
  const partial = totals.filter((t) => t.missing > 0 && t.missing < items.length).sort((a, b) => a.missing - b.missing || a.total - b.total);
  const ranked = [...complete, ...partial];
  const max = Math.max(...ranked.map((t) => t.total), 0.01);
  const best = complete[0];
  const worst = complete.at(-1);
  const count = items.reduce((n, x) => n + x.qty, 0);

  document.getElementById('my-headline').textContent = best
    ? `Najjeftinije u ${locative(best.chain)}: ${eur.format(best.total)}`
    : 'Nijedan lanac nema sve proizvode iz košarice';
  document.getElementById('my-note').textContent =
    best && worst && best !== worst
      ? `${int.format(count)} ${plural(count, 'komad', 'komada', 'komada')}; u ${locative(worst.chain)} bi platio ${eur.format(worst.total - best.total)} više.`
      : `${int.format(count)} ${plural(count, 'komad', 'komada', 'komada')}.`;
  document.getElementById('my-totals').replaceChildren(
    ...ranked.map((t) =>
      bar(
        t.chain,
        t.total / max,
        eur.format(t.total),
        t.missing ? `nema ${t.missing} ${plural(t.missing, 'proizvod', 'proizvoda', 'proizvoda')}` : t === best ? bestTag() : `+${eur.format(t.total - best.total)}`,
        t === best,
        [eur.format(t.total), chainName(t.chain), t.missing ? `bez ${t.missing} proizvoda koje ne prodaje` : 'cijela košarica'],
      ),
    ),
  );

  const split = items.reduce((sum, { p, qty }) => sum + p.min * qty, 0);
  const shops = new Set(items.map(({ p }) => p.prices.indexOf(p.min))).size;
  document.getElementById('my-split').textContent = !best
    ? `Kupiš li svaki proizvod ondje gdje je najjeftiniji (${shops} ${plural(shops, 'lanac', 'lanca', 'lanaca')}), platit ćeš ${eur.format(split)}.`
    : split < best.total - 0.005
      ? `Da svaki proizvod kupiš ondje gdje je najjeftiniji (${shops} ${plural(shops, 'lanac', 'lanca', 'lanaca')}), platio bi ${eur.format(split)}, ${eur.format(best.total - split)} manje nego samo u ${locative(best.chain)}.`
      : `Sve je najjeftinije u ${locative(best.chain)}; kupnja po više trgovina ne donosi uštedu.`;

  document.getElementById('my-items').replaceChildren(
    ...items.sort((a, b) => a.p.name.localeCompare(b.p.name, 'hr')).map(({ p }) => productCard(p, { withQty: true })),
  );
}

function updateFavCount() {
  const badge = document.getElementById('fav-count');
  badge.hidden = favorites.items.size === 0;
  badge.textContent = favorites.items.size;
}

// ---- routing ----
const VIEWS = ['pregled', 'proizvodi', 'kategorije', 'kosarica'];
function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'pregled';
  for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  tooltip.hidden = true;
  if (view === 'proizvodi') {
    renderChips();
    renderProducts();
  }
  if (view === 'kosarica') renderMine();
  window.scrollTo({ top: 0 });
}

function wire() {
  let timer;
  document.getElementById('q').addEventListener('input', (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filters.q = event.target.value;
      filters.shown = PAGE;
      renderProducts();
    }, 120);
  });
  document.getElementById('sort').addEventListener('change', (event) => {
    filters.sort = event.target.value;
    filters.shown = PAGE;
    renderProducts();
  });
  const onlyFav = document.getElementById('only-fav');
  onlyFav.addEventListener('click', () => {
    filters.onlyFav = !filters.onlyFav;
    onlyFav.setAttribute('aria-pressed', String(filters.onlyFav));
    filters.shown = PAGE;
    renderProducts();
  });
  document.getElementById('more').addEventListener('click', () => {
    filters.shown += PAGE;
    renderProducts();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', () => (tooltip.hidden = true), { passive: true });
}

async function main() {
  favorites.load();
  updateFavCount();
  try {
    await load();
  } catch (error) {
    document.getElementById('loading').textContent = 'Podaci se nisu mogli učitati. Pokušaj ponovo za koju minutu.';
    console.error(error);
    return;
  }
  document.getElementById('loading').remove();
  document.getElementById('generated').textContent = `ažurirano ${new Date(report.generated_at).toLocaleString('hr-HR')}`;
  renderOverview();
  renderPremiumLegend();
  renderHeat();
  wire();
  route();
}

main();
