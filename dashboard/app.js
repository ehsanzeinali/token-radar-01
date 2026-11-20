// Signal Board: a no-network dashboard over window.RADAR. It ranks no-token protocols by a stated
// model, keeps live-token and wrapped-product records in separate views, and derives a farm plan
// from category, size, chain and age. Every figure shown here is computed from data.js.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var app = document.getElementById('app');
  var state = { tab: 'ranked', q: '', cat: 'all', sort: 'value', dir: -1, sel: null };
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(n) {
    if (n === null || n === undefined) return 'unknown';
    if (n >= 365) return (n / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(n)) + 'd';
  }
  function catName(i) { return i < 0 ? 'Unclassified' : (D.cats[i] || 'Other'); }
  function chainNames(a) { return (a || []).map(function (i) { return D.chains[i] || 'Unknown'; }); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else if (k === 'selected' || k === 'checked') node[k] = true;
      else node.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function fromRows(a, kind) {
    return a.map(function (r, index) {
      var o = {
        slug: r[0], name: r[1], cat: catName(r[2]), chains: chainNames(r[3]),
        tvl: r[4], growth: r[5], age: r[6], value: r[7], rank: index + 1,
        mcap: null, symbol: null, reason: null,
      };
      if (kind === 'live') { o.mcap = r[5]; o.growth = r[6]; o.symbol = r[7]; }
      if (kind === 'aside') { o.reason = r[5]; }
      return o;
    });
  }
  var ROWS = fromRows(D.rows, 'ranked');
  var LIVE = fromRows(D.live, 'live');
  var ASIDE = fromRows(D.aside, 'aside');

  // The same arithmetic lib/model.ts uses. Keeping it on the page makes the number auditable.
  function parts(p) {
    var m = D.m;
    var raw = p.growth === null || p.growth === undefined || !isFinite(p.growth) ? 0 : p.growth;
    var gp = Math.min(m.gc, Math.max(m.gf, raw));
    var gm = 1 + (gp / 100) * m.gw;
    var a = p.age === null || p.age === undefined ? m.ua : p.age;
    var tm = m.af + (Math.min(Math.max(a, 0), m.ad) / m.ad) * m.ar;
    return { gp: gp, gm: gm, tm: tm, age: a, value: Math.max(1, Math.round(p.tvl * m.b * gm * tm)) };
  }

  function planFor(p) {
    var tvl = p.tvl;
    var capital = tvl >= 2e9 ? 400 : tvl >= 5e8 ? 250 : tvl >= 1e8 ? 150 : tvl >= 2e7 ? 100 : 60;
    var gas = capital >= 250 ? 12 : capital >= 150 ? 8 : 5;
    var hold = p.age === null || p.age === undefined ? 30 : p.age < 180 ? 60 : p.age < 365 ? 45 : 30;
    var chain = p.chains.length ? p.chains[0] : 'its main chain';
    var c = p.cat.toLowerCase();
    var action;
    if (/risk curator|capital allocator|allocator|vault|yield aggregator|asset management/.test(c)) {
      action = `Deposit $${capital} of USDC into one published ${p.name} vault on ${chain}, record the entry share price and keep the receipt.`;
    } else if (/lend|cdp|collateral/.test(c)) {
      action = `Supply $${capital} of USDC to ${p.name} on ${chain}; if borrowing is needed, keep the loan under 30 percent of the deposit so the position stays simple.`;
    } else if (/dexs?|liquidity|farm/.test(c)) {
      action = `Provide about $${capital} of two-sided liquidity to the main ${p.name} pool on ${chain} and record both assets, the price range and the pool shares.`;
    } else if (/prediction/.test(c)) {
      action = `Fund $${capital} on ${chain} and take one small position through ${p.name}; write down the market, side and expiry before you enter.`;
    } else if (/rwa|bond/.test(c)) {
      action = `Mint or buy $${capital} of the yield asset published by ${p.name} on ${chain} and hold it through one full distribution period.`;
    } else if (/perpetual|derivative|options/.test(c)) {
      action = `Deposit $${capital} of USDC as margin on ${chain} and open one small hedged position through ${p.name}; record the liquidation price.`;
    } else if (/staking|restaking/.test(c)) {
      action = `Stake about $${capital} of the chain's native asset through ${p.name} on ${chain} and keep the staking receipt in the same wallet.`;
    } else if (/insurance|cover/.test(c)) {
      action = `Buy about $${capital} of cover from ${p.name} on ${chain} and keep the policy number and expiry in the farm log.`;
    } else {
      action = `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open; record the contract address from the protocol's own page.`;
    }
    return { capital: capital, gas: gas, hold: hold, action: action };
  }

  function farmSteps(p) {
    var q = planFor(p);
    var steps = [
      [`Open a dedicated wallet for ${p.name}, fund it with about $${q.gas} of gas and verify the chain and contract address on the protocol's own page.`, `about $${q.gas} of gas`, '5 minutes'],
      [q.action, `$${q.capital} of capital and about $${q.gas} of gas`, '15 minutes to set up'],
      ['Make one qualifying on-chain action each week, such as a deposit, a borrow, a swap or a vote, and save the transaction hash.', 'about $2 of gas each week', '10 minutes each week'],
      [`Keep the position open for at least ${q.hold} days so the activity appears in more than one weekly snapshot; do not churn it on the last day.`, `the $${q.capital} stays in the position`, `${q.hold} days`],
      [`Check ${p.name}'s own rewards or points page weekly and claim only from a link the protocol publishes; never pay an unsolicited claim fee.`, 'no fee to check', '10 minutes each week'],
      ["Write the wallet, dates, contract and every transaction hash in a farm log, then set an exit date and unwind if the protocol's own terms change.", 'nothing beyond the log', '5 minutes at entry and exit'],
    ];
    return steps.map(function (s) { return `${s[0]} Cost: ${s[1]}. Time: ${s[2]}.`; });
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('q')) state.q = params.get('q');
    if (params.get('cat')) state.cat = params.get('cat');
    if (params.get('p')) state.sel = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.tab !== 'ranked') params.set('tab', state.tab);
    if (state.q) params.set('q', state.q);
    if (state.cat !== 'all') params.set('cat', state.cat);
    if (state.sel) params.set('p', state.sel);
    var s = params.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname);
  }
  function current() { return state.tab === 'live' ? LIVE : state.tab === 'aside' ? ASIDE : ROWS; }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return current().filter(function (r) {
      if (state.cat !== 'all' && r.cat !== state.cat) return false;
      if (!q) return true;
      return [r.name, r.slug, r.cat, r.reason || '', r.chains.join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl; bv = b.tvl; }
      else if (key === 'growth') { av = a.growth === null ? -Infinity : a.growth; bv = b.growth === null ? -Infinity : b.growth; }
      else if (key === 'age') { av = a.age === null ? Infinity : a.age; bv = b.age === null ? Infinity : b.age; }
      else if (key === 'cap') { av = a.mcap || 0; bv = b.mcap || 0; }
      else if (state.tab === 'aside') { av = a.tvl; bv = b.tvl; }
      else { av = state.tab === 'ranked' ? parts(a).value : (a.mcap || 0); bv = state.tab === 'ranked' ? parts(b).value : (b.mcap || 0); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function topBar() {
    return el('header', { class: 'topbar' },
      el('div', { class: 'identity' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'wordmark', text: 'SIGNAL / BOARD' }),
        el('span', { class: 'edition', text: '02' })),
      el('div', { class: 'topmeta' },
        el('span', { text: 'SNAPSHOT ' + D.as }),
        el('span', { text: D.mv }),
        el('span', { text: 'NO TOKEN ON RECORD' })));
  }

  function hero() {
    var top = ROWS[0];
    return el('section', { class: 'hero' },
      el('div', { class: 'hero-copy' },
        el('p', { class: 'eyebrow', text: 'PRE-TOKEN RADAR / SORTED BY IMPLIED VALUE' }),
        el('h1', { text: 'Before the ticker.' }),
        el('p', { class: 'lede', text: `Every no-token protocol in the snapshot, ranked by a model built from TVL, seven-day flow and the time it has run without a token on record.` }),
        el('p', { class: 'caution', text: 'Implied value is this board’s own claim, not a forecast or a make.fun statement. A missing token field is not proof that no token exists.' })),
      el('div', { class: 'hero-card' },
        el('div', { class: 'hero-card-top' }, el('span', { text: 'TOP SIGNAL' }), el('span', { class: 'live-dot', text: 'RANK 01' })),
        el('div', { class: 'hero-name', text: top ? top.name : 'No rows' }),
        el('div', { class: 'hero-value', text: top ? fmtUsd(parts(top).value) : 'n/a' }),
        el('div', { class: 'hero-sub', text: top ? `${top.cat} · ${top.chains.slice(0, 2).join(' / ')} · ${fmtUsd(top.tvl)} TVL` : '' }),
        el('div', { class: 'hero-rule' }),
        el('div', { class: 'hero-foot', text: 'Click any row to open the model breakdown and a costed farm plan.' })));
  }

  function stats() {
    function stat(label, value, note) {
      return el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), el('b', { text: value }), el('span', { class: 'stat-note', text: note }));
    }
    return el('section', { class: 'stats' },
      stat('WATCHLIST COVERED', `${D.w}/${D.w}`, 'the floor, all present'),
      stat('RANKED RECORDS', String(ROWS.length), 'no token on record'),
      stat('EARLY ROWS', String(ROWS.length - D.w), 'below the watchlist floor'),
      stat('SET ASIDE', String(LIVE.length + ASIDE.length), 'live tokens and wrapped products'));
  }

  function controls() {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, chain or category', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'cat', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      D.cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.cat }); }));
    select.addEventListener('change', function () { state.cat = select.value; writeHash(); render(); });
    function tab(name, label) {
      return el('button', { type: 'button', class: 'tab', 'aria-pressed': state.tab === name ? 'true' : 'false', text: label, onclick: function () { state.tab = name; state.sort = name === 'ranked' ? 'value' : name === 'live' ? 'cap' : 'tvl'; state.dir = -1; writeHash(); render(); } });
    }
    return el('section', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'SEARCH' }), search),
      el('div', { class: 'field' }, el('label', { for: 'cat', text: 'CATEGORY' }), select),
      el('div', { class: 'field' }, el('span', { class: 'label', text: 'VIEW' }), el('div', { class: 'tabs' }, tab('ranked', 'Ranked'), tab('live', 'Live market'), tab('aside', 'Set aside'))),
      el('span', { class: 'count', text: filtered().length + ' of ' + current().length + ' shown' }));
  }

  function sortHead(key, label) {
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
      label, state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null));
  }

  function rowCell(r, i) {
    if (state.tab === 'aside') {
      return el('tr', null,
        el('td', { class: 'rankdim', text: '—' }),
        el('td', null, el('div', { class: 'pname' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.cat + ' · ' + r.chains.slice(0, 2).join(', ') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl) }),
        el('td', { class: 'reason', text: r.reason }));
    }
    if (state.tab === 'live') {
      return el('tr', null,
        el('td', { class: 'rankdim', text: 'MKT' }),
        el('td', null, el('div', { class: 'pname' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.symbol ? r.symbol + ' · ' : '') + r.cat }))),
        el('td', { class: 'num', text: fmtUsd(r.mcap) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl) }),
        el('td', { class: 'num ' + (r.growth >= 0 ? 'pos' : 'neg'), text: fmtPct(r.growth) }),
        el('td', { class: 'sub', text: r.chains.slice(0, 2).join(', ') || '—' }));
    }
    var p = parts(r);
    var topValue = ROWS.length && parts(ROWS[0]).value ? parts(ROWS[0]).value : 1;
    var tr = el('tr', {
      tabindex: '0', 'data-selected': state.sel === r.slug ? 'true' : 'false',
      onclick: function () { state.sel = r.slug; writeHash(); render(); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.sel = r.slug; writeHash(); render(); } },
    },
      el('td', { class: 'rank', text: String(r.rank).padStart(2, '0') }),
      el('td', null, el('div', { class: 'pname' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.cat + ' · ' + (r.chains.slice(0, 2).join(' / ') || 'unnamed chain') }))),
      el('td', { class: 'num', text: fmtUsd(r.tvl) }),
      el('td', { class: 'num ' + (r.growth === null ? '' : r.growth >= 0 ? 'pos' : 'neg'), text: fmtPct(r.growth) }),
      el('td', { class: 'num dim', text: fmtAge(r.age) }),
      el('td', null, el('div', { class: 'value' },
        el('span', { class: 'meter', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((p.value / topValue) * 100)) + '%' })),
        el('b', { text: fmtUsd(p.value) }))),
      el('td', { class: 'status', text: 'NO TOKEN' }));
    return tr;
  }

  function table() {
    var list = sorted(filtered());
    if (!list.length) {
      return el('section', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No matching records' }),
        el('p', { text: 'Clear the search or choose another category to bring the board back.' }),
        el('button', { class: 'button', type: 'button', text: 'CLEAR FILTERS', onclick: function () { state.q = ''; state.cat = 'all'; writeHash(); render(); } })));
    }
    var head, caption;
    if (state.tab === 'aside') {
      head = [sortHead('', '—'), sortHead('name', 'Set-aside record'), sortHead('tvl', 'TVL'), el('th', { scope: 'col', text: 'WHY IT IS NOT RANKED' })];
      caption = 'These records carry no token field but describe products of assets that already trade, or exchange and versioned wrappers.';
    } else if (state.tab === 'live') {
      head = [el('th', { scope: 'col', text: 'MKT' }), sortHead('name', 'Protocol'), sortHead('cap', 'Market cap'), sortHead('tvl', 'TVL'), sortHead('growth', '7d'), el('th', { scope: 'col', text: 'CHAINS' })];
      caption = 'The market’s own values for protocols whose token already trades. These never enter the ranked board.';
    } else {
      head = [el('th', { scope: 'col', text: '#' }), sortHead('name', 'Protocol'), sortHead('tvl', 'TVL'), sortHead('growth', '7d'), sortHead('age', 'AGE'), sortHead('value', 'Implied value'), el('th', { scope: 'col', text: 'STATUS' })];
      caption = 'Ranked by implied value. Select a row for its arithmetic and a costed farm plan.';
    }
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('span', { class: 'panel-title', text: state.tab === 'ranked' ? 'RANKED BOARD' : state.tab === 'live' ? 'LIVE TOKEN MARKET' : 'SET ASIDE' }), el('span', { class: 'caption', text: caption })),
      el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, head)), el('tbody', null, list.map(rowCell)))));
  }

  function modelNote() {
    return el('section', { class: 'modelnote' },
      el('div', { class: 'formula' },
        el('span', { class: 'formula-label', text: 'THE MODEL' }),
        el('code', { text: 'implied = TVL × 0.32 × (1 + clamp(7d, −60, 150) × 0.006) × (0.80 + min(age, 1460) × 0.000342)' })),
      el('p', { text: 'Unknown first-tracked dates use 365 days. Rank 1 carries the largest implied value. The same constants drive every row; no name is special-cased.' }));
  }

  function closeDetail() { state.sel = null; writeHash(); render(); }

  function detail() {
    if (!state.sel) return null;
    var p = ROWS.filter(function (r) { return r.slug === state.sel; })[0];
    if (!p) return null;
    var q = parts(p);
    var plan = planFor(p);
    function line(label, value) { return el('div', { class: 'calc-line' }, el('span', { text: label }), el('b', { text: value })); }
    return el('div', { class: 'detail-wrap' },
      el('div', { class: 'scrim', onclick: closeDetail }),
      el('aside', { class: 'detail', role: 'dialog', 'aria-modal': 'true', 'aria-label': p.name + ' detail' },
        el('div', { class: 'detail-top' },
          el('div', null, el('span', { class: 'eyebrow', text: 'RANK ' + String(ROWS.indexOf(p) + 1).padStart(2, '0') + ' / ' + ROWS.length }), el('h2', { text: p.name })),
          el('button', { class: 'close', type: 'button', text: 'CLOSE', onclick: closeDetail })),
        el('p', { class: 'detail-sub', text: p.cat + ' · ' + (p.chains.join(' / ') || 'unnamed chain') + ' · first tracked ' + (p.age === null ? 'unknown' : fmtAge(p.age) + ' before the snapshot') }),
        el('div', { class: 'detail-value' }, el('span', { text: 'IMPLIED VALUE' }), el('b', { text: fmtUsd(q.value) })),
        el('section', { class: 'detail-section' }, el('h3', { text: 'How the number is built' }),
          el('div', { class: 'calc' },
            line('TVL on record', fmtUsd(p.tvl)),
            line('Base × 0.32', fmtUsd(Math.round(p.tvl * D.m.b))),
            line('7-day flow', fmtPct(p.growth)),
            line('Growth multiplier', q.gm.toFixed(3) + '×'),
            line('Tenure multiplier', q.tm.toFixed(3) + '×'),
            line('Implied value', fmtUsd(q.value)))),
        el('section', { class: 'detail-section' }, el('h3', { text: 'A costed farm plan' }),
          el('p', { class: 'detail-note', text: `Sized at $${plan.capital} of capital with about $${plan.gas} of gas and a ${plan.hold}-day minimum hold. No token issue is promised.` }),
          el('ol', { class: 'steps' }, farmSteps(p).map(function (s) {
            var cut = s.lastIndexOf(' Cost: ');
            return el('li', null, el('span', { text: s.slice(0, cut) }), el('small', { text: s.slice(cut + 7) }));
          }))),
        el('p', { class: 'detail-foot', text: 'Check every contract and reward claim on the protocol’s own page. This board is a research aid, not financial advice.' })));
  }

  function render() {
    var selected = state.sel;
    app.replaceChildren(topBar(), hero(), stats(), controls(), table(), modelNote(), detail());
    if (selected) {
      var node = app.querySelector('.detail');
      if (node) node.scrollTop = 0;
    }
  }

  readHash();
  render();
  app.setAttribute('aria-busy', 'false');
})();
