// Košarica: reads data/report.json and data/products.json and sets four pages.
// No framework, no build step. Text from the data always goes in as text, never as HTML.

const CHAIN = { kaufland: 'Kaufland', konzum: 'Konzum', lidl: 'Lidl', plodine: 'Plodine', spar: 'Spar', studenac: 'Studenac' };
const IN_CHAIN = { kaufland: 'Kauflandu', konzum: 'Konzumu', lidl: 'Lidlu', plodine: 'Plodinama', spar: 'Sparu', studenac: 'Studencu' };
const PAGE = 40;
const FAVORITES_KEY = 'kosarica:favorites';
const MIN_HEAT_PRODUCTS = 25;

const eur = new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR' });
const num2 = new Intl.NumberFormat('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat('hr-HR');
const pct = (v, digits = 0) => `${(v * 100).toLocaleString('hr-HR', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
const signedPct = (v, digits = 0) => {
  const r = Math.round(v * 100 * 10 ** digits) / 10 ** digits; // -0.4 % rounds to 0 %, not −0 %
  return (r > 0 ? '+' : r < 0 ? '−' : '') + pct(Math.abs(r) / 100, digits);
};
const chainName = (c) => CHAIN[c] ?? c;
const inChain = (c) => IN_CHAIN[c] ?? chainName(c);
const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('hr-HR', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('hr-HR');
const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('hr-HR', { weekday: 'long' });
const normalize = (s) =>
  s
    .toLowerCase()
    .replaceAll('đ', 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** h('p', { class: 'x' }, 'text', child): strings become text nodes. */
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
const SVG = 'http://www.w3.org/2000/svg';
function svg(viewBox, cls, stretch, ...paths) {
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  if (stretch) el.setAttribute('preserveAspectRatio', 'none');
  if (cls) el.setAttribute('class', cls);
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    el.append(p);
  }
  return el;
}

// Hand-drawn marks: a few slightly different strokes, picked per item so they don't repeat.
const RINGS = [
  'M7,27 C3,13 26,3 53,4 C81,5 98,13 96,24 C94,36 72,43 46,42 C20,41 4,33 5,22 C6,13 21,7 36,6',
  'M10,8 C30,1 77,1 93,12 C101,20 94,37 66,41 C39,45 7,40 3,25 C0,14 14,6 31,4',
  'M50,3 C79,2 99,11 97,25 C95,38 69,44 43,42 C17,40 1,31 4,18 C7,7 28,2 58,5',
];
const SCRIBBLE = 'M2,9 C14,5 27,10 41,7 C56,4 70,10 84,6 C90,5 95,6 98,4';
const STAR = 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z';
const pickRing = (key) => RINGS[[...key].reduce((n, c) => n + c.charCodeAt(0), 0) % RINGS.length];
const ring = (key) => svg('0 0 100 46', 'ring', true, key ? pickRing(key) : RINGS[0]);

// ---- favorites, in this browser only ----
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
      // private mode or full storage: favorites last until the tab closes
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

// ---- tooltip ----
const tooltip = document.getElementById('tooltip');
function showTip(lines, x, y) {
  tooltip.replaceChildren(h('strong', {}, lines[0]), ...lines.slice(1).map((l) => h('div', {}, l)));
  tooltip.hidden = false;
  const w = tooltip.offsetWidth;
  tooltip.style.left = `${Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8)}px`;
  tooltip.style.top = `${Math.max(8, y - tooltip.offsetHeight - 14)}px`;
}
function bindTip(el, lines) {
  el.addEventListener('pointermove', (e) => showTip(lines, e.clientX, e.clientY));
  el.addEventListener('pointerleave', () => (tooltip.hidden = true));
  el.addEventListener('focus', () => {
    const r = el.getBoundingClientRect();
    showTip(lines, r.left + r.width / 2, r.top);
  });
  el.addEventListener('blur', () => (tooltip.hidden = true));
}

// ---- data ----
let report;
let catalog;

async function load() {
  const get = (url) =>
    fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.json();
    });
  const [r, p] = await Promise.all([get('data/report.json'), get('data/products.json')]);
  report = r;
  catalog = {
    chains: p.chains,
    categories: p.categories,
    products: p.products.map(([gtin, name, cat, prices, anchors]) => {
      const present = prices.filter((x) => x != null);
      const min = Math.min(...present);
      const max = Math.max(...present);
      const drift = prices.map((price, i) => (price != null && anchors[i] ? price / anchors[i] - 1 : null)).filter((x) => x != null);
      return {
        gtin,
        name,
        cat,
        prices,
        anchors,
        min,
        max,
        best: prices.indexOf(min),
        saving: max - min,
        savingShare: max > 0 ? (max - min) / max : 0,
        chainsCount: present.length,
        drift: drift.length ? median(drift) : null,
        search: normalize(name),
      };
    }),
  };
  catalog.byGtin = new Map(catalog.products.map((p) => [p.gtin, p]));
}

// ---- masthead ----
function renderMasthead() {
  const { summary } = report;
  document.getElementById('issue').textContent = `Br. ${summary.days_collected} · ${weekday(summary.as_of)}, ${longDate(summary.as_of)}`;
  document.getElementById('place').textContent = `Zagreb i okolica · ${int.format(summary.stores)} trgovina`;
  document.getElementById('generated').textContent = `Zadnji put složeno ${new Date(report.generated_at).toLocaleString('hr-HR')}.`;
}

// ---- Pregled ----
function renderOverview() {
  const { summary, basket, cheapest, chains } = report;
  const best = basket[0];
  const worst = basket.at(-1);

  const h1 = document.getElementById('headline');
  if (best && worst && best !== worst) {
    const em = h('em', {}, `${pct(1 - best.total / worst.total)} jeftiniji`);
    em.append(svg('0 0 100 12', 'scribble', true, SCRIBBLE));
    h1.replaceChildren('Isti proizvodi su u ', inChain(best.chain), ' ', em, ' nego u ', inChain(worst.chain), '.');
  } else {
    h1.textContent = 'Što košta isto, u različitim dućanima.';
  }

  const facts = [
    [int.format(summary.stores), 'trgovina u Zagrebu i okolici'],
    [int.format(summary.chains), plural(summary.chains, 'trgovački lanac', 'trgovačka lanca', 'trgovačkih lanaca')],
    [`${(summary.prices / 1e6).toLocaleString('hr-HR', { maximumFractionDigits: 1 })} mil.`, 'cijena danas'],
    [int.format(summary.products_in_several_chains), 'proizvoda u barem dva lanca'],
  ];
  document.getElementById('facts').replaceChildren(...facts.flatMap(([v, l]) => [h('dt', {}, v), h('dd', {}, l)]));

  // 01 the same basket
  if (best && worst) {
    document
      .getElementById('basket-text')
      .replaceChildren(
        `Uzmimo ${int.format(best.items)} proizvoda koje prodaje svih ${summary.chains} lanaca: isti barkod, isto pakiranje. U ${inChain(best.chain)} takva košarica košta `,
        h('strong', {}, eur.format(best.total)),
        `, u ${inChain(worst.chain)} `,
        h('strong', {}, eur.format(worst.total)),
        `. To je ${eur.format(worst.total - best.total)} razlike za potpuno iste stvari.`,
      );
  }
  document.getElementById('receipt').replaceWith(
    receipt({
      id: 'receipt',
      title: 'Ista košarica',
      sub: `${int.format(best?.items ?? 0)} proizvoda · ${shortDate(summary.as_of)}`,
      lines: basket.map((b, i) => ({
        what: chainName(b.chain),
        amount: b.total,
        sub: i === 0 ? null : `+${num2.format(b.total - best.total)} (${signedPct(b.above_cheapest, 1)})`,
        stamp: i === 0,
      })),
      total: best && worst ? ['Razlika', worst.total - best.total] : null,
      foot: '* cijena proizvoda = medijan trgovina lanca *',
    }),
  );

  // 02 who is cheapest most often
  const byShare = [...cheapest].sort((a, b) => b.cheapest_share - a.cheapest_share);
  const lead = byShare[0];
  const rest = byShare.slice(1);
  if (lead && rest.length) {
    const smallest = [...cheapest].sort((a, b) => a.comparable_products - b.comparable_products)[0];
    document.getElementById('cheapest-text').replaceChildren(
      'Kad isti proizvod ima više lanaca, ',
      h('strong', {}, chainName(lead.chain)),
      ` ima najnižu cijenu u ${pct(lead.cheapest_share)} slučajeva. Ostali su između ${pct(Math.min(...rest.map((c) => c.cheapest_share)))} i ${pct(Math.max(...rest.map((c) => c.cheapest_share)))}.`,
      smallest.chain === lead.chain
        ? ` No ${chainName(lead.chain)} ima i najmanje takvih proizvoda, ${int.format(lead.comparable_products)}: većinu njegove ponude drugi lanci ne prodaju.`
        : '',
    );
  }
  document.getElementById('cheapest').replaceWith(
    lollipops(
      'cheapest',
      byShare.map((c) => ({
        chain: c.chain,
        value: c.cheapest_share,
        label: pct(c.cheapest_share),
        tip: [pct(c.cheapest_share, 1), `${chainName(c.chain)}: najjeftiniji za ${int.format(c.cheapest)} od ${int.format(c.comparable_products)} proizvoda`],
      })),
      1,
      [0, 0.25, 0.5, 0.75, 1].map((t) => [t, pct(t)]),
    ),
  );

  // 03 since the anchor date
  renderAnchor(chains);

  // 04 offers
  const byOffer = [...chains].sort((a, b) => b.offer_share - a.offer_share);
  const top = Math.max(0.05, Math.ceil(Math.max(...byOffer.map((c) => c.offer_share)) * 20) / 20);
  const stepSize = top > 0.2 ? 0.1 : 0.05;
  const ticks = [];
  for (let t = 0; t <= top + 1e-9; t += stepSize) ticks.push([t, pct(t)]);
  document.getElementById('offers').replaceWith(
    lollipops(
      'offers',
      byOffer.map((c) => ({
        chain: c.chain,
        value: c.offer_share,
        label: pct(c.offer_share, 1),
        tip: [pct(c.offer_share, 1), `${chainName(c.chain)}: ${int.format(Math.round(c.offer_share * c.products))} od ${int.format(c.products)} proizvoda na akciji`],
      })),
      top,
      ticks,
    ),
  );

  renderChanges(report.daily_changes);
}

function receiptLine(what, amount, extra) {
  return h('div', { class: 'r-line' }, h('span', { class: 'what' }, what), h('span', { class: 'lead-dots' }), h('span', { class: 'amt' }, amount), extra);
}

function receipt({ id, title, sub, lines, total, foot, items }) {
  const fig = h('figure', { class: 'receipt', id, 'aria-label': title });
  fig.append(h('div', { class: 'r-head' }, 'Košarica · Zagreb'), h('div', { class: 'r-title' }, title), h('div', { class: 'r-head' }, sub), h('hr'));
  if (items?.length) {
    for (const it of items) {
      fig.append(receiptLine(it.what, num2.format(it.amount)));
      if (it.sub) fig.append(h('div', { class: 'r-sub' }, it.sub));
    }
    fig.append(h('hr'));
  }
  for (const line of lines) {
    fig.append(receiptLine(line.what, `${num2.format(line.amount)} €`, line.stamp ? h('span', { class: 'stamp' }, 'Najjeftinije') : null));
    if (line.sub) fig.append(h('div', { class: 'r-sub' }, line.sub));
  }
  if (total) {
    const t = receiptLine(total[0], `${num2.format(total[1])} €`);
    t.classList.add('r-total');
    fig.append(h('hr'), t);
  }
  if (foot) fig.append(h('div', { class: 'r-foot' }, foot));
  return fig;
}

function lollipops(id, rows, max, ticks) {
  const box = h('div', { class: 'lollipops', id });
  const axis = h('div', { class: 'axis-labels', 'aria-hidden': 'true' });
  for (const [t, label] of ticks) axis.append(h('span', { style: `left:${(t / max) * 100}%` }, label));
  box.append(axis);
  rows.forEach((r, i) => {
    const x = Math.min(1, r.value / max) * 100;
    const plot = h(
      'div',
      { class: 'plot' },
      ...ticks.map(([t]) => h('span', { class: 'gridline', style: `left:${(t / max) * 100}%` })),
      h('span', { class: 'stick', style: `width:${x}%` }),
      h('span', { class: 'dot', style: `left:${x}%` }),
      h('span', { class: 'val', style: `left:${x}%` }, r.label),
    );
    const row = h('div', { class: `lolli${i === 0 ? ' first' : ''}`, tabindex: 0 }, h('span', { class: 'name' }, chainName(r.chain)), plot);
    bindTip(row, r.tip);
    box.append(row);
  });
  return box;
}

function renderAnchor(chains) {
  const rows = chains.filter((c) => c.compared).sort((a, b) => b.share_up_since_anchor - a.share_up_since_anchor);
  const max = Math.max(...rows.flatMap((c) => [c.share_up_since_anchor, c.share_down_since_anchor]), 0.1);
  const head = h(
    'div',
    { class: 'div-head', 'aria-hidden': 'true' },
    h('span'),
    h('span', { class: 'l' }, 'pojeftinilo'),
    h('span', { class: 'r' }, 'poskupjelo'),
    h('span', { class: 's' }, 'isto'),
  );
  const body = rows.map((c) => {
    const down = c.share_down_since_anchor;
    const up = c.share_up_since_anchor;
    const same = Math.max(0, 1 - down - up);
    const w = (v) => `${(v / max) * 100}%`;
    const left = h('div', { class: 'half left' }, h('span', { class: 'bar', style: `width:${w(down)}` }), h('span', { class: 'lab', style: `right:calc(${w(down)} + 8px)` }, pct(down)));
    const right = h('div', { class: 'half right' }, h('span', { class: 'bar', style: `width:${w(up)}` }), h('span', { class: 'lab', style: `left:calc(${w(up)} + 8px)` }, pct(up)));
    const row = h('div', { class: 'div-row', tabindex: 0 }, h('span', { class: 'name' }, chainName(c.chain)), left, right, h('span', { class: 'same' }, pct(same)));
    bindTip(row, [chainName(c.chain), `pojeftinilo ${pct(down, 1)}`, `poskupjelo ${pct(up, 1)}`, `isto ${pct(same, 1)}`, `od ${int.format(c.compared)} cijena sa sidrenom cijenom`]);
    return row;
  });
  document.getElementById('anchor').replaceChildren(head, ...body);
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
        `Prvi cjenik skupljen je ${longDate(report.summary.as_of)} Koliko je cijena svaki dan poraslo, a koliko palo, ovdje će se crtati od trećeg dana.`,
        days.length === 1 ? ` Zasad: ${int.format(days[0].up)} poskupljenja i ${int.format(days[0].down)} pojeftinjenja.` : '',
      ),
    );
    return;
  }
  box.replaceChildren(lineChart(days));
}

/** Increases and decreases per day: two lines on one axis, labeled at their ends. */
function lineChart(days) {
  const W = 760;
  const H = 260;
  const pad = { l: 48, r: 110, t: 14, b: 30 };
  const max = Math.max(...days.flatMap((d) => [d.up, d.down]), 1);
  const last = days.length - 1;
  const x = (i) => pad.l + (i / Math.max(1, last)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const s = (tag, attrs, text) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  };
  const root = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Poskupljenja i pojeftinjenja po danu' });
  const grid = s('g', { class: 'grid' });
  const axis = s('g', { class: 'axis' });
  for (const t of [0, 0.5, 1]) {
    grid.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(max * t), y2: y(max * t) }));
    axis.append(s('text', { x: pad.l - 8, y: y(max * t) + 4, 'text-anchor': 'end' }, int.format(Math.round(max * t))));
  }
  const step = Math.ceil(days.length / 7);
  days.forEach((d, i) => {
    if (i % step && i !== last) return;
    axis.append(s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, new Date(`${d.day}T12:00:00`).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric' })));
  });
  root.append(grid, axis);
  for (const [key, color, label] of [
    ['up', 'var(--dearer)', 'poskupljenja'],
    ['down', 'var(--cheaper)', 'pojeftinjenja'],
  ]) {
    root.append(s('path', { class: 'line', stroke: color, d: days.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d[key])}`).join('') }));
    root.append(s('text', { class: 'line-label', x: x(last) + 8, y: y(days[last][key]) + 5, fill: color }, label));
  }
  const cross = s('line', { class: 'crosshair', y1: pad.t, y2: H - pad.b, visibility: 'hidden' });
  const hit = s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' });
  root.append(cross, hit);
  hit.addEventListener('pointermove', (event) => {
    const box = root.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(last, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * last)));
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    showTip([longDate(days[i].day), `${int.format(days[i].up)} poskupljenja`, `${int.format(days[i].down)} pojeftinjenja`], event.clientX, event.clientY);
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  });
  return h('div', { class: 'chart' }, root);
}

// ---- Proizvodi ----
const filters = { q: '', cat: null, sort: 'common', onlyFav: false, shown: PAGE };

function premiumTier(share) {
  if (share <= 0) return 0;
  if (share < 0.05) return 1;
  if (share < 0.15) return 2;
  if (share < 0.3) return 3;
  return 4;
}
// past +100 % a multiple reads faster: "2,3×" rather than "+130 %"
const premiumText = (share) => (share >= 1 ? `${(share + 1).toLocaleString('hr-HR', { maximumFractionDigits: 1 })}×` : `+${pct(share)}`);

function renderKey() {
  const tiers = [
    [1, 'do 5 % skuplje'],
    [2, '5–15 %'],
    [3, '15–30 %'],
    [4, 'više od 30 %'],
  ];
  const sample = h('span', { style: 'position:relative;display:inline-block;padding:0 4px;font-family:var(--mono);color:var(--ink)' }, '1,99');
  sample.append(ring());
  document
    .getElementById('premium-legend')
    .replaceChildren(h('span', {}, sample, '  najjeftinije'), ...tiers.map(([t, label]) => h('span', {}, h('i', { class: `t${t}` }), label)));
}

function renderCategories() {
  const counts = new Map();
  for (const p of catalog.products) counts.set(p.cat, (counts.get(p.cat) ?? 0) + 1);
  const pick = (cat) => () => {
    filters.cat = cat;
    filters.shown = PAGE;
    renderCategories();
    renderProducts();
  };
  const items = [[null, 'Sve', catalog.products.length], ...catalog.categories.map((c, i) => [i, c, counts.get(i) ?? 0])];
  const nodes = [];
  items.forEach(([cat, label, count], i) => {
    if (i) nodes.push(h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'));
    nodes.push(h('button', { class: 'cat', type: 'button', 'aria-pressed': String(filters.cat === cat), onclick: pick(cat) }, label, h('sup', {}, int.format(count))));
  });
  document.getElementById('categories').replaceChildren(...nodes);
}

function matching() {
  const words = normalize(filters.q).split(' ').filter(Boolean);
  const list = catalog.products.filter(
    (p) => (filters.cat == null || p.cat === filters.cat) && (!filters.onlyFav || favorites.has(p.gtin)) && words.every((w) => p.search.includes(w)),
  );
  const sorters = {
    common: (a, b) => b.chainsCount - a.chainsCount || b.savingShare - a.savingShare,
    savings: (a, b) => b.savingShare - a.savingShare || b.saving - a.saving,
    cheap: (a, b) => a.min - b.min,
    anchor: (a, b) => (b.drift ?? -9) - (a.drift ?? -9),
    name: (a, b) => a.name.localeCompare(b.name, 'hr'),
  };
  list.sort(sorters[filters.sort]);
  if (words.length && (filters.sort === 'common' || filters.sort === 'savings')) {
    const first = words[0];
    list.sort((a, b) => Number(b.search.startsWith(first)) - Number(a.search.startsWith(first)));
  }
  return list;
}

function tableHead() {
  return h(
    'thead',
    {},
    h('tr', {}, h('th', { class: 'fav' }, h('span', { class: 'sr-only' }, 'U košarici')), h('th', {}, 'Proizvod'), ...catalog.chains.map((c) => h('th', {}, chainName(c)))),
  );
}

function productRow(p, { qty = null, onChange = null } = {}) {
  const fav = favorites.has(p.gtin);
  const star = h('button', {
    class: 'star',
    type: 'button',
    'aria-pressed': String(fav),
    'aria-label': `${p.name}: ${fav ? 'makni iz košarice' : 'dodaj u košaricu'}`,
    onclick: () => {
      favorites.toggle(p.gtin);
      star.setAttribute('aria-pressed', String(favorites.has(p.gtin)));
      onChange?.();
    },
  });
  star.append(svg('0 0 24 24', '', false, STAR));

  const meta = h('div', { class: 'pmeta' }, h('span', { class: 'pcat' }, catalog.categories[p.cat]));
  if (p.saving > 0.004) meta.append(h('span', { class: 'saving' }, `u ${inChain(catalog.chains[p.best])} ${eur.format(p.saving)} jeftinije`));
  if (p.drift != null && Math.abs(p.drift) >= 0.005) {
    meta.append(h('span', { class: p.drift > 0 ? 'drift-up' : 'drift-down' }, `od svibnja 2025. ${signedPct(p.drift)}`));
  }
  if (qty != null) {
    meta.append(
      h(
        'span',
        { class: 'qty', role: 'group', 'aria-label': 'Količina' },
        h('button', { type: 'button', 'aria-label': 'Manje', onclick: () => (favorites.setQty(p.gtin, qty - 1), onChange?.()) }, '−'),
        h('output', {}, `${qty}×`),
        h('button', { type: 'button', 'aria-label': 'Više', onclick: () => (favorites.setQty(p.gtin, qty + 1), onChange?.()) }, '+'),
      ),
    );
  }

  const cells = catalog.chains.map((chain, i) => {
    const price = p.prices[i];
    if (price == null) return h('td', { class: 'p none', 'data-chain': chainName(chain) }, '·');
    const share = price / p.min - 1;
    const tier = premiumTier(share);
    const amt = h('span', { class: 'amt' }, num2.format(price));
    const td = h('td', { class: 'p', 'data-chain': chainName(chain), tabindex: 0 }, amt);
    if (tier === 0) {
      amt.append(ring(p.gtin + chain));
      td.append(h('span', { class: 'cheapest-label' }, 'najjeftinije'));
    } else {
      td.append(h('span', { class: `tick t${tier}` }), h('span', { class: 'diff' }, premiumText(share)));
    }
    const anchor = p.anchors[i];
    bindTip(td, [
      eur.format(price),
      `${chainName(chain)}, srednja cijena u trgovinama`,
      tier === 0 ? 'najniža cijena među lancima' : `${eur.format(price - p.min)} skuplje nego u ${inChain(catalog.chains[p.best])}`,
      anchor ? `2. svibnja 2025.: ${eur.format(anchor)} (${signedPct(price / anchor - 1, 1)})` : 'bez sidrene cijene',
    ]);
    return td;
  });

  return h('tr', {}, h('td', { class: 'fav' }, star), h('td', { class: 'product' }, h('div', { class: 'pname' }, p.name), meta), ...cells);
}

function renderProducts() {
  const list = matching();
  document.getElementById('result-count').textContent =
    list.length === 0 ? 'Ništa ne odgovara pretrazi.' : `${int.format(list.length)} ${plural(list.length, 'proizvod', 'proizvoda', 'proizvoda')}`;
  document.getElementById('pricelist').replaceChildren(tableHead(), h('tbody', {}, list.slice(0, filters.shown).map((p) => productRow(p))));
  const more = document.getElementById('more');
  more.hidden = list.length <= filters.shown;
  more.textContent = `još ${int.format(Math.min(PAGE, list.length - filters.shown))} od ${int.format(list.length - filters.shown)}`;
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
    ['b-3', '−10 %'],
    ['b-2', '−5'],
    ['b-1', '−2'],
    ['b0', 'prosjek'],
    ['b1', '+2'],
    ['b2', '+5'],
    ['b3', '+10 %'],
  ];
  document.getElementById('heat-legend').replaceChildren(...legend.map(([cls, label]) => h('div', {}, h('i', { class: cls }), label)));

  const chains = [...new Set(report.categories.map((c) => c.chain))].sort();
  const cells = new Map(report.categories.map((c) => [`${c.category}|${c.chain}`, c]));
  const totals = new Map();
  for (const c of report.categories) totals.set(c.category, (totals.get(c.category) ?? 0) + c.products);
  const categories = [...totals.keys()]
    .filter((c) => totals.get(c) >= MIN_HEAT_PRODUCTS * 2)
    .sort((a, b) => (a === 'Ostalo') - (b === 'Ostalo') || totals.get(b) - totals.get(a));

  const head = h('tr', {}, h('th', {}, h('span', { class: 'sr-only' }, 'Kategorija')), ...chains.map((c) => h('th', {}, chainName(c))));
  const rows = categories.map((category) => {
    const row = h('tr', {}, h('th', { scope: 'row' }, category, h('small', {}, `${int.format(Math.round(totals.get(category) / chains.length))} po lancu`)));
    for (const chain of chains) {
      const c = cells.get(`${category}|${chain}`);
      if (!c) {
        row.append(h('td', {}, h('button', { class: 'thin', type: 'button', disabled: true }, '·')));
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
        thin ? 'premalo' : signedPct(c.index_vs_average),
      );
      bindTip(button, [
        thin ? `${int.format(c.products)} proizvoda` : signedPct(c.index_vs_average, 1),
        `${chainName(chain)} · ${category}`,
        thin ? 'premalo zajedničkih proizvoda za usporedbu' : 'prema prosjeku lanaca za iste proizvode',
        `${int.format(c.products)} proizvoda; najjeftiniji za ${pct(c.cheapest_share)}`,
      ]);
      row.append(h('td', {}, button));
    }
    return row;
  });
  document.getElementById('heat').replaceChildren(h('thead', {}, head), h('tbody', {}, rows));
  renderHeatNote(categories, chains, cells);
}

/** The margin note: the table's story in a few sentences, computed from it. */
function renderHeatNote(categories, chains, cells) {
  const solid = (cat, chain) => {
    const c = cells.get(`${cat}|${chain}`);
    return c && c.products >= MIN_HEAT_PRODUCTS ? c : null;
  };
  const stats = chains.map((chain) => {
    const values = categories.map((cat) => solid(cat, chain)?.index_vs_average).filter((v) => v != null);
    return { chain, below: values.filter((v) => v <= -0.02).length, count: values.length, values };
  });
  const leader = [...stats].filter((s) => s.count).sort((a, b) => b.below / b.count - a.below / a.count)[0];
  const notes = [];
  if (leader?.below) {
    const neg = leader.values.filter((v) => v <= -0.02).map((v) => Math.abs(v));
    notes.push(
      h('p', {}, h('em', {}, chainName(leader.chain)), ` je ispod prosjeka u ${leader.below} od ${leader.count} kategorija, obično za ${pct(Math.min(...neg))} do ${pct(Math.max(...neg))}.`),
    );
  }
  let low = null;
  let high = null;
  for (const cat of categories) {
    for (const chain of chains) {
      const c = solid(cat, chain);
      if (!c) continue;
      if (chain !== leader?.chain && (!low || c.index_vs_average < low.index_vs_average)) low = c;
      if (!high || c.index_vs_average > high.index_vs_average) high = c;
    }
  }
  if (low && low.index_vs_average <= -0.05) {
    notes.push(h('p', {}, 'Najveća iznimka: ', h('em', {}, chainName(low.chain)), ` u kategoriji ${low.category.toLowerCase()}, ${signedPct(low.index_vs_average)}.`));
  }
  if (high && high.index_vs_average >= 0.03) {
    notes.push(h('p', {}, 'Najskuplje je ', h('em', {}, chainName(high.chain)), ` u kategoriji ${high.category.toLowerCase()}, ${signedPct(high.index_vs_average)}.`));
  }
  notes.push(h('p', { style: 'font-size:0.95rem;color:var(--muted)' }, 'Prugasta polja: premalo zajedničkih proizvoda za pošten račun.'));
  document.getElementById('heat-note').replaceChildren(...notes);
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
  const complete = totals.filter((t) => !t.missing).sort((a, b) => a.total - b.total);
  const partial = totals.filter((t) => t.missing && t.missing < items.length).sort((a, b) => a.missing - b.missing);
  const best = complete[0];
  const worst = complete.at(-1);
  const split = items.reduce((sum, { p, qty }) => sum + p.min * qty, 0);
  const shops = new Set(items.map(({ p }) => p.best)).size;
  const pieces = items.reduce((n, x) => n + x.qty, 0);

  document.getElementById('my-receipt').replaceWith(
    receipt({
      id: 'my-receipt',
      title: 'Moja košarica',
      sub: `${pieces} ${plural(pieces, 'komad', 'komada', 'komada')} · ${shortDate(report.summary.as_of)}`,
      items: items.map(({ p, qty }) => ({ what: `${qty}× ${p.name}`, amount: p.min * qty, sub: `najjeftinije: ${chainName(catalog.chains[p.best])}` })),
      lines: [
        ...complete.map((t, i) => ({ what: chainName(t.chain), amount: t.total, stamp: i === 0 && complete.length > 1 })),
        ...partial.map((t) => ({ what: chainName(t.chain), amount: t.total, sub: `bez ${t.missing} ${plural(t.missing, 'proizvoda', 'proizvoda', 'proizvoda')}` })),
      ],
      total: ['Po dućanima', split],
      foot: `* svaki proizvod ondje gdje je najjeftiniji: ${shops} ${plural(shops, 'lanac', 'lanca', 'lanaca')} *`,
    }),
  );

  const text = [];
  if (best) {
    text.push(`Sve zajedno najjeftinije je u ${inChain(best.chain)}: ${eur.format(best.total)}.`);
    if (worst && worst !== best) text.push(` U ${inChain(worst.chain)} bi za isto platio ${eur.format(worst.total - best.total)} više.`);
    if (split < best.total - 0.005) {
      text.push(` Ako svaki proizvod kupiš ondje gdje je najjeftiniji, uštedio bi još ${eur.format(best.total - split)}, ali to je ${shops} ${plural(shops, 'dućan', 'dućana', 'dućana')}.`);
    }
  } else {
    text.push(`Nijedan lanac nema sve iz košarice. Po dućanima bi sve to platio ${eur.format(split)}.`);
  }
  document.getElementById('my-text').textContent = text.join('');
  const rerender = () => renderMine();
  document
    .getElementById('my-items')
    .replaceChildren(tableHead(), h('tbody', {}, items.sort((a, b) => a.p.name.localeCompare(b.p.name, 'hr')).map(({ p, qty }) => productRow(p, { qty, onChange: rerender }))));
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
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  tooltip.hidden = true;
  if (view === 'proizvodi') {
    renderCategories();
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
    document.getElementById('loading').textContent = 'Cjenici se trenutno ne mogu učitati. Pokušaj za koju minutu.';
    console.error(error);
    return;
  }
  document.getElementById('loading').remove();
  renderMasthead();
  renderOverview();
  renderKey();
  renderHeat();
  wire();
  route();
}

main();
