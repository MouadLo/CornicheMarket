/* Sell: category grid + always-visible cart, pads, payment, tickets.
   Behaviour follows SELL-GRID-DESIGN.md (tiles, pads, Divers, x Qté) and
   adds the shell pieces from THEME-STRUCTURE.md (undo last, tickets panel,
   last-ticket card, price check, in-app keyboard). */
function sellScreen() {
  const P = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  const isTablet = document.body.dataset.device === 'tablet';
  let tab = 'fav';
  let cart = START_CART.map((l) => ({ ...l }));
  let undo = [];
  let selected = null;
  let mult = null;
  let lastTicket = null;
  let weighing = null;
  let query = '';

  const catName = (id) => LO(CATEGORIES.find((c) => c.id === id));
  const inCart = (id) => cart.find((l) => l.id === id);
  const lineTotal = (l) => Math.round(l.qty * P[l.id].price);
  const total = () => cart.reduce((s, l) => s + lineTotal(l), 0);
  const count = () => cart.reduce((s, l) => s + (P[l.id].kg ? 1 : l.qty), 0);

  function tileList() {
    if (query) {
      return PRODUCTS.filter((p) => !p.misc && /coca/i.test(p.name));
    }
    const ids = tab === 'fav' ? FAVORITES : PRODUCTS.filter((p) => p.cat === tab).map((p) => p.id).sort((a, b) => P[a].name.localeCompare(P[b].name));
    return [P.divers, ...ids.map((id) => P[id])];
  }

  function renderCats() {
    $('#cats').innerHTML = CATEGORIES.map((c) => `<button class="chip ${c.id === tab && !query ? 'on' : ''}" data-cat="${c.id}">${c.star ? icon('star', 'ic-sm star') : ''}<span>${LO(c)}</span></button>`).join('');
  }

  function stockBadge(p) {
    if (p.misc) return '';
    const s = p.kg ? p.stock.toFixed(1) : p.stock;
    const cls = p.stock <= 0 ? 'out' : p.stock <= p.low ? 'low' : '';
    return `<span class="t-stock ${cls}"><span class="num">${s}</span></span>`;
  }

  function renderTiles() {
    const el = $('#tiles');
    el.innerHTML = tileList().map((p) => {
      if (p.misc) {
        return `<button class="tile divers" data-pid="divers"><span class="t-name">${L('Divers', 'متفرقات')}</span><span class="t-sub">${icon('pencil', 'ic-sm')}${L('Montant libre', 'مبلغ حر')}</span></button>`;
      }
      const line = inCart(p.id);
      const qty = line ? (p.kg ? `<span class="badge brand">${icon('check', 'ic-sm')}</span>` : `<span class="badge brand">×${line.qty}</span>`) : p.kg ? `<span class="t-kg">${icon('scale', 'ic-sm')}</span>` : '';
      return `<button class="tile ${p.color}" data-pid="${p.id}"><span class="t-name">${qty}${bdi(p.name)}</span><span class="t-price"><span class="money">${moneyText(p.price).replace(' DH', '')}<small>${p.kg ? '/kg' : ' DH'}</small></span></span>${stockBadge(p)}</button>`;
    }).join('');
    $('#search-hint')?.remove();
    if (query) el.insertAdjacentHTML('beforebegin', `<div id="search-hint" style="font-size:var(--fs-caption);color:var(--ink-600);font-weight:600;flex:none">${L('2 résultats pour « coca » · « كوكا » trouve les mêmes', 'نتيجتان لـ «كوكا» · «coca» تعطي نفس النتائج')}</div>`);
  }

  function lineHtml(l) {
    const p = P[l.id];
    const sel = selected === l.id;
    const control = p.kg
      ? `<button class="weight" data-weigh="${p.id}">${icon('scale', 'ic-sm')}${qtyText(l.qty, true)}</button>`
      : `<div class="stepper"><button data-dec="${p.id}" aria-label="-">${icon('minus')}</button><span class="q">${l.qty}</span><button data-inc="${p.id}" aria-label="+">${icon('plus')}</button></div>`;
    const sub = p.kg ? `${moneyText(p.price)}/kg` : `${moneyText(p.price)} × ${l.qty}`;
    return `<div class="line ${sel ? 'sel' : ''} ${l.fresh ? 'new' : ''}" data-line="${p.id}">
      <div style="min-width:0" data-select="${p.id}"><div class="l-name">${bdi(p.name)}</div><div class="l-sub"><span class="money">${sub}</span></div></div>
      ${control}<div class="l-total">${money(lineTotal(l))}</div>
      ${sel ? `<div class="line-actions"><button class="btn btn-secondary btn-sm">${icon('percent', 'ic-sm')}${L('Remise', 'خصم')}</button><button class="btn btn-secondary btn-sm" data-open="dlg-qty">${icon('keyboard', 'ic-sm')}${L('Quantité', 'الكمية')}</button><span class="grow"></span><button class="btn btn-danger-soft btn-sm" data-remove="${p.id}">${icon('trash', 'ic-sm')}${L('Retirer', 'إزالة')}</button></div>` : ''}
    </div>`;
  }

  function renderCart() {
    const el = $('#cart');
    const n = count();
    const head = `<div class="cart-head">
        <div class="cart-title">${L('Panier', 'السلة')}${cart.length ? `<small>· ${n} ${L('articles', 'منتجات')}</small>` : ''}</div>
        <button class="btn btn-quiet btn-sm" id="undo" ${undo.length ? '' : 'disabled'}>${icon('undo', 'ic-sm')}${L('Annuler dernier', 'تراجع')}</button>
        <button class="btn btn-secondary btn-sm" data-open="tickets">${icon('receipt', 'ic-sm')}${L('Tickets', 'التذاكر')}</button>
      </div>`;
    const cam = isTablet ? `<div class="camera ${Q.get('cam') === '0' ? '' : 'open'}" id="camera"><div class="view"></div><div class="bc"></div><div class="frame"></div><div class="laser"></div>
        <span class="status ok cam-ok">${icon('check')}${L('Coca-Cola 33cl ajouté', 'تمت إضافة Coca-Cola 33cl')}</span>
        <div class="cam-bar">${icon('camera', 'ic-sm')}<span>${L('Caméra arrière · bip activé', 'الكاميرا الخلفية · الصفير مفعل')}</span><span class="grow"></span><button class="btn btn-quiet btn-sm" data-close>${icon('x', 'ic-sm')}${L('Fermer', 'إغلاق')}</button></div></div>` : '';
    if (!cart.length) {
      el.innerHTML = `${head}${cam}<div class="cart-empty"><div class="state"><div class="state-ic">${icon('scan', 'ic-lg')}</div><h3>${L('Panier vide', 'السلة فارغة')}</h3><p>${L('Scannez un article ou touchez une tuile.', 'امسح منتجًا أو المس مربعًا.')}</p></div></div>
        ${lastTicket ? `<div class="last-ticket"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${L('Dernier ticket', 'آخر تذكرة')} <span class="num">#${lastTicket.no}</span></b><span class="muted num">14:32</span></div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px"><span class="muted">${L('Espèces · rendu', 'نقدًا · الباقي')} ${money(lastTicket.change)}</span><b style="font-size:var(--fs-subtitle)">${money(lastTicket.total)}</b></div>
          <div class="acts"><button class="btn btn-secondary btn-sm">${icon('message', 'ic-sm')}WhatsApp</button><button class="btn btn-secondary btn-sm">${icon('printer', 'ic-sm')}${L('Imprimer', 'طباعة')}</button></div></div>` : ''}`;
      return;
    }
    el.innerHTML = `${head}${cam}<div class="cart-lines">${cart.map(lineHtml).join('')}</div>
      <div class="cart-foot">
        <button class="link-btn">${icon('plus', 'ic-sm')}${L('Remise sur la vente', 'خصم على البيع')}</button>
        <div class="cart-sum"><span class="lbl2">${L('Total', 'المجموع')}</span><span class="total">${money(total())}</span></div>
        <button class="btn btn-pay btn-block" data-open="dlg-pay">${L('Encaisser', 'تحصيل')} ${money(total())}</button>
      </div>`;
    cart.forEach((l) => delete l.fresh);
  }

  function add(id, qty, fromScan = false) {
    const p = P[id];
    const line = inCart(id);
    if (line && !p.kg) line.qty += qty; else if (line && p.kg) line.qty = qty; else cart.push({ id, qty, fresh: true });
    if (line) line.fresh = true;
    undo.push({ id, qty, kg: !!p.kg, existed: !!line });
    if (mult) { mult = null; renderMult(); }
    selected = null;
    renderCart(); renderTiles();
    const t = $(`.tile[data-pid="${id}"]`);
    if (t) { t.classList.add('hit'); setTimeout(() => t.classList.remove('hit'), 220); }
  }

  function renderMult() {
    const b = $('#mult');
    b.classList.toggle('armed', !!mult);
    b.innerHTML = mult ? `<span class="mult">×${mult}</span><span>${L('touchez un article', 'المس منتجًا')}</span>` : `<span class="mult">×</span><span>${L('Qté', 'الكمية')}</span>`;
  }

  /* ---- pads ---- */
  function padKeys(target, opts = {}) {
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', opts.decimal ? ',' : '', '0', 'del'];
    return `<div class="keypad" data-keys="${target}">${keys.map((k) => k === '' ? '<span></span>' : k === 'del' ? `<button class="key fn" data-k="del" aria-label="${L('Effacer', 'حذف')}">${icon('backspace')}</button>` : `<button class="key" data-k="${k}">${k}</button>`).join('')}</div>`;
  }
  const pads = { weight: '0,750', qty: '6', divers: '12', pay: '50' };
  document.addEventListener('click', (e) => {
    const k = e.target.closest('[data-keys] [data-k]');
    if (!k) return;
    const which = k.closest('[data-keys]').dataset.keys;
    let v = pads[which];
    if (k.dataset.k === 'del') v = v.slice(0, -1); else if (v === '0' && k.dataset.k !== ',') v = k.dataset.k; else v += k.dataset.k;
    pads[which] = v;
    renderPads();
  });
  const num = (s) => parseFloat((s || '0').replace(',', '.')) || 0;

  function renderPads() {
    const wp = weighing ? P[weighing] : P.tomates;
    const w = num(pads.weight);
    $('#dlg-weight .dialog').innerHTML = `
      <h2>${icon('scale')}${bdi(wp.name)} <span class="muted" style="font-weight:500;font-size:var(--fs-body)">· ${moneyText(wp.price)}/kg</span></h2>
      <div class="seg" style="margin:12px 0"><button class="on">${L('Poids', 'الوزن')}</button><button>${L('Montant', 'المبلغ')}</button></div>
      <div class="readout"><span class="big">${pads.weight || '0'} kg</span><span style="font-size:var(--fs-subtitle);font-weight:700">= ${money(Math.round(w * wp.price))}</span></div>
      <div class="presets" style="margin:12px 0">${['0.25', '0.5', '1', '1.5', '2'].map((x) => `<button class="btn btn-secondary btn-sm" data-preset="${x}">${x}</button>`).join('')}</div>
      ${padKeys('weight', { decimal: true })}
      <div class="actions"><button class="btn btn-secondary" data-close>${L('Annuler', 'إلغاء')}</button><button class="btn btn-primary" id="weigh-ok">${L('Ajouter', 'إضافة')}</button></div>`;
    $('#dlg-qty .dialog').innerHTML = `
      <h2><span class="mult">×</span>${L('Quantité', 'الكمية')}</h2>
      <p>${L('Le prochain article touché ou scanné sera ajouté ce nombre de fois.', 'سيضاف المنتج التالي (لمس أو مسح) بهذا العدد.')}</p>
      <div class="readout" style="margin-top:12px"><span class="big">×${pads.qty || '0'}</span></div>
      <div class="presets" style="margin:12px 0">${['2', '3', '6', '12', '24'].map((x) => `<button class="btn btn-secondary btn-sm" data-qpreset="${x}">${x}</button>`).join('')}</div>
      ${padKeys('qty')}
      <div class="actions"><button class="btn btn-secondary" data-close>${L('Annuler', 'إلغاء')}</button><button class="btn btn-primary" id="qty-ok" ${num(pads.qty) > 0 ? '' : 'disabled'}>OK</button></div>`;
    const d = num(pads.divers) * 100;
    $('#dlg-divers .dialog').innerHTML = `
      <h2>${icon('pencil')}${L('Divers', 'متفرقات')}</h2>
      <div class="readout" style="margin-top:12px"><span class="big">${pads.divers || '0'}.00 DH</span><span class="muted" style="font-size:var(--fs-caption)">${L('max 200.00 DH', 'الحد 200.00 DH')}</span></div>
      <button class="btn btn-quiet" style="margin:6px 0">${icon('plus', 'ic-sm')}${L('Ajouter une note (facultatif)', 'إضافة ملاحظة (اختياري)')}</button>
      ${padKeys('divers', { decimal: true })}
      <div class="actions"><button class="btn btn-secondary" data-close>${L('Annuler', 'إلغاء')}</button><button class="btn btn-primary" ${d > 0 && d <= 20000 ? '' : 'disabled'}>${L('Ajouter', 'إضافة')}</button></div>`;
    renderPay();
  }

  let method = 'cash';
  function renderPay() {
    const due = total();
    const tendered = num(pads.pay) * 100;
    const change = tendered - due;
    const cust = CUSTOMERS.slice(0, 5);
    $('#dlg-pay .dialog').innerHTML = `
      <div class="pay-left">
        <div class="due"><h2 style="margin:0">${L('À payer', 'المبلغ المستحق')}</h2><span class="total">${money(due)}</span></div>
        <div class="methods">
          <button class="method ${method === 'cash' ? 'on' : ''}" data-method="cash">${icon('banknote')}${L('Espèces', 'نقدًا')}</button>
          <button class="method ${method === 'card' ? 'on' : ''}" data-method="card">${icon('card')}${L('Carte', 'بطاقة')}</button>
          <button class="method ${method === 'credit' ? 'on' : ''}" data-method="credit">${icon('book')}${L('Crédit (carnet)', 'كريدي (الكارني)')}</button>
        </div>
        ${method === 'cash' ? `
          <div><div class="lbl">${L('Reçu du client', 'المبلغ المستلم')}</div><div class="readout"><span class="big">${pads.pay || '0'}.00 DH</span></div></div>
          <div class="presets">${[['exact', L('Exact', 'بالضبط')], ['50', '50'], ['100', '100'], ['200', '200']].map(([v, l]) => `<button class="btn btn-secondary btn-sm" data-tender="${v}">${l}</button>`).join('')}</div>
          <div class="change ${change < 0 ? 'short' : ''}"><b>${change < 0 ? L('Il manque', 'ناقص') : L('À rendre', 'الباقي')}</b><span class="big">${money(Math.abs(change))}</span></div>`
        : method === 'credit' ? `
          <div class="field">${icon('search')}<span class="ph">${L('Chercher un client', 'ابحث عن زبون')}</span></div>
          <div class="chips" style="flex-wrap:wrap">${cust.map((c, i) => `<button class="chip ${i === 1 ? 'on' : ''}">${bdi(c.name)}</button>`).join('')}<button class="chip">${icon('plus', 'ic-sm')}${L('Nouveau', 'جديد')}</button></div>
          <div class="banner info">${icon('info')}<span>${bdi('Fatima Zahra B.')} ${L('doit déjà', 'مدينة بـ')} ${money(24550)}</span></div>`
        : `<div class="banner info">${icon('card')}<span>${L('Passez la carte sur le terminal, puis confirmez.', 'مرر البطاقة على الجهاز ثم أكد.')}</span></div>`}
      </div>
      <div class="pay-right">
        ${method === 'cash' ? padKeys('pay') : `<div class="state" style="flex:1;justify-content:center"><div class="state-ic">${icon(method === 'card' ? 'card' : 'book', 'ic-lg')}</div><p>${method === 'card' ? L('Aucune saisie nécessaire.', 'لا حاجة للإدخال.') : L('Le montant sera ajouté au carnet du client.', 'سيضاف المبلغ إلى كارني الزبون.')}</p></div>`}
        <span class="grow"></span>
        <button class="btn btn-pay btn-block" id="pay-ok" ${method === 'cash' && change < 0 ? 'disabled' : ''}>${icon('check')}${L('Valider', 'تأكيد')} ${money(due)}</button>
        <button class="btn btn-secondary btn-block" data-close>${L('Retour au panier', 'العودة إلى السلة')}</button>
      </div>`;
  }

  /* ---- tickets panel ---- */
  let ticket = Q.get('open')?.startsWith('ticket') ? '0185' : null;
  function renderTickets() {
    const el = $('#tickets');
    const name = (id) => ({ salma: L('Salma', 'سلمى'), youssef: L('Youssef', 'يوسف'), mouad: L('Mouad', 'مُعاذ') }[id]);
    const methodTag = (t) => t.voided ? `<span class="status neutral">${L('Annulé', 'ملغى')}</span>` : t.method === 'credit' ? `<span class="status info">${icon('book')}${L('Crédit', 'كريدي')}</span>` : t.method === 'card' ? `<span class="status neutral">${icon('card')}${L('Carte', 'بطاقة')}</span>` : `<span class="status neutral">${icon('banknote')}${L('Espèces', 'نقدًا')}</span>`;
    const list = ROLE === 'cashier' ? TICKETS.filter((t) => t.cashier === 'salma') : TICKETS;
    if (!ticket) {
      el.innerHTML = `<div class="panel-head"><div class="panel-title">${L('Tickets du jour', 'تذاكر اليوم')}</div><button class="btn btn-quiet btn-icon" data-close aria-label="${L('Fermer', 'إغلاق')}">${icon('x')}</button></div>
        <div style="padding:10px 16px" class="chips" data-chips="one"><button class="chip on">${ROLE === 'owner' ? L('Tous', 'الكل') : L('Mes tickets', 'تذاكري')}</button><button class="chip owner-only">${L('Salma', 'سلمى')}</button><button class="chip owner-only">${L('Youssef', 'يوسف')}</button><button class="chip owner-only">${icon('calendar', 'ic-sm')}${L('Autre jour', 'يوم آخر')}</button></div>
        <div class="panel-body" style="padding:0">${list.map((t) => `<div class="row click ${t.voided ? 'void' : ''}" data-ticket="${t.no}" style="padding-inline:16px 12px">
          <div class="r-main"><div class="c-main"><span class="num">#${t.no}</span> · <span class="num">${t.time}</span></div><div class="c-sub">${t.items} ${L('articles', 'منتجات')} · ${name(t.cashier)}${t.customer ? ` · ${bdi(t.customer)}` : ''}</div></div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px"><b style="${t.voided ? 'text-decoration:line-through;color:var(--ink-600)' : ''}">${money(t.total)}</b>${methodTag(t)}</div></div>`).join('')}</div>
        <div class="panel-foot"><span class="muted">${list.length} ${L('tickets', 'تذاكر')}</span><span class="grow"></span><b>${money(list.filter((t) => !t.voided).reduce((s, t) => s + t.total, 0))}</b></div>`;
      return;
    }
    const t = TICKETS.find((x) => x.no === ticket);
    el.innerHTML = `<div class="panel-head"><button class="btn btn-quiet btn-icon" data-back aria-label="${L('Retour', 'رجوع')}">${icon('back')}</button><div class="panel-title">${L('Ticket', 'التذكرة')} <span class="num">#${t.no}</span></div><button class="btn btn-quiet btn-icon" data-close>${icon('x')}</button></div>
      <div class="panel-body">
        <div class="muted" style="margin-bottom:12px">${L('Aujourd’hui', 'اليوم')} <span class="num">${t.time}</span> · ${name(t.cashier)} · ${methodTag(t)}</div>
        ${[['Raïbi Jamila', 2, 250], ['Pain rond', 6, 120], ['Thé Sultan 200g', 1, 1650], ['Lait Centrale 1L', 1, 700]].map(([n, q, p]) => `<div style="display:flex;gap:12px;min-height:44px;align-items:center;border-bottom:1px solid var(--divider)"><span class="grow">${bdi(n)} <span class="muted num">× ${q}</span></span><span>${money(q * p)}</span></div>`).join('')}
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:14px"><b>${L('Total', 'المجموع')}</b><span class="total" style="font-size:var(--fs-kpi)">${money(t.total)}</span></div>
        ${t.customer ? `<div class="banner info" style="margin-top:14px">${icon('book')}<span>${L('Ajouté au carnet de', 'أضيف إلى كارني')} ${bdi(t.customer)}</span></div>` : ''}
        <p class="cashier-only muted" style="margin-top:16px;font-size:var(--fs-caption)">${L('Seul le propriétaire peut annuler une vente.', 'المالك وحده يمكنه إلغاء البيع.')}</p>
      </div>
      <div class="panel-foot"><button class="btn btn-secondary btn-sm">${icon('message', 'ic-sm')}WhatsApp</button><button class="btn btn-secondary btn-sm">${icon('printer', 'ic-sm')}${L('Imprimer', 'طباعة')}</button><span class="grow"></span><button class="btn btn-danger-soft btn-sm owner-only" data-open="dlg-void">${icon('undo', 'ic-sm')}${L('Annuler la vente', 'إلغاء البيع')}</button></div>`;
  }

  /* ---- in-app keyboard (touch-only laptop, SELL-GRID-DESIGN 2.7.2) ---- */
  function renderKbd() {
    const fr = [['a', 'z', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['q', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm'], ['w', 'x', 'c', 'v', 'b', 'n', '-', "'"]];
    const ar = [['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج'], ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'], ['ئ', 'ء', 'ؤ', 'ر', 'ى', 'ة', 'و', 'ز', 'ظ', 'د']];
    const rows = LANG === 'ar' ? ar : fr;
    const k = $('#kbd');
    k.setAttribute('dir', LANG === 'ar' ? 'rtl' : 'ltr');
    k.innerHTML = rows.map((r, i) => `<div class="kbd-row">${r.map((c) => `<button class="key">${c}</button>`).join('')}${i === 2 ? `<button class="key fn" aria-label="${L('Effacer', 'حذف')}">${icon('backspace')}</button>` : ''}</div>`).join('')
      + `<div class="kbd-row"><button class="key fn">123</button><button class="key fn">${LANG === 'ar' ? 'FR' : 'ع'}</button><button class="key wide">${L('espace', 'مسافة')}</button><button class="key fn" data-close>${icon('down', 'ic-sm')}${L('Fermer', 'إغلاق')}</button></div>`;
  }

  /* ---- events ---- */
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) { tab = c.dataset.cat; query = ''; renderCats(); renderTiles(); return; }
    const t = e.target.closest('.tile');
    if (t) {
      const p = P[t.dataset.pid];
      if (p.misc) { pads.divers = ''; renderPads(); openLayer('dlg-divers'); return; }
      if (p.kg) { weighing = p.id; pads.weight = ''; renderPads(); openLayer('dlg-weight'); return; }
      add(p.id, mult || 1);
      return;
    }
    const inc = e.target.closest('[data-inc]');
    if (inc) { add(inc.dataset.inc, 1); return; }
    const dec = e.target.closest('[data-dec]');
    if (dec) {
      const l = inCart(dec.dataset.dec);
      l.qty -= 1;
      if (l.qty <= 0) { cart = cart.filter((x) => x !== l); toast(`${L('Retiré :', 'أزيل:')} ${bdi(P[l.id].name)}`, `<button class="btn btn-quiet btn-sm">${L('Annuler', 'تراجع')}</button>`); }
      renderCart(); renderTiles(); return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { cart = cart.filter((x) => x.id !== rm.dataset.remove); selected = null; toast(`${L('Retiré :', 'أزيل:')} ${bdi(P[rm.dataset.remove].name)}`, `<button class="btn btn-quiet btn-sm">${L('Annuler', 'تراجع')}</button>`); renderCart(); renderTiles(); return; }
    const sel = e.target.closest('[data-select]');
    if (sel) { selected = selected === sel.dataset.select ? null : sel.dataset.select; renderCart(); return; }
    const w = e.target.closest('[data-weigh]');
    if (w) { weighing = w.dataset.weigh; pads.weight = qtyText(inCart(weighing).qty, false).replace('.', ','); renderPads(); openLayer('dlg-weight'); return; }
    if (e.target.closest('#undo')) {
      const last = undo.pop();
      if (!last) return;
      const l = inCart(last.id);
      if (l && !last.kg && last.existed) l.qty -= last.qty; else cart = cart.filter((x) => x.id !== last.id);
      toast(`${L('Annulé :', 'تم التراجع:')} ${bdi(P[last.id].name)}${last.kg ? '' : ` ×${last.qty}`}`);
      renderCart(); renderTiles(); return;
    }
    const pr = e.target.closest('[data-preset]');
    if (pr) { add(weighing || 'tomates', parseFloat(pr.dataset.preset)); closeLayer(pr); return; }
    if (e.target.closest('#weigh-ok')) { add(weighing || 'tomates', num(pads.weight)); closeLayer(e.target); return; }
    const qp = e.target.closest('[data-qpreset]');
    if (qp) { pads.qty = qp.dataset.qpreset; renderPads(); return; }
    if (e.target.closest('#qty-ok')) { mult = parseInt(pads.qty, 10); renderMult(); closeLayer(e.target); toast(L(`Le prochain article sera ajouté ${mult} fois`, `سيضاف المنتج التالي ${mult} مرات`)); return; }
    const m = e.target.closest('[data-method]');
    if (m) { method = m.dataset.method; renderPay(); return; }
    const td = e.target.closest('[data-tender]');
    if (td) { pads.pay = td.dataset.tender === 'exact' ? String(Math.ceil(total() / 100)) : td.dataset.tender; renderPay(); return; }
    if (e.target.closest('#pay-ok')) {
      const due = total();
      lastTicket = { no: '0188', total: due, change: num(pads.pay) * 100 - due };
      cart = []; undo = []; selected = null;
      closeLayer(e.target); renderCart(); renderTiles();
      toast(`${L('Vente enregistrée', 'تم تسجيل البيع')} · ${money(due)}`, `<button class="btn btn-quiet btn-sm">${icon('message', 'ic-sm')}WhatsApp</button><button class="btn btn-quiet btn-sm">${icon('printer', 'ic-sm')}${L('Imprimer', 'طباعة')}</button>`);
      return;
    }
    const tk = e.target.closest('[data-ticket]');
    if (tk) { ticket = tk.dataset.ticket; renderTickets(); return; }
    if (e.target.closest('[data-back]')) { ticket = null; renderTickets(); return; }
    if (e.target.closest('[data-close-search]')) { query = ''; closeLayer($('#kbd')); renderSearch(); renderCats(); renderTiles(); return; }
    if (e.target.closest('#search')) { query = 'coca'; renderSearch(); renderCats(); renderTiles(); }
    if (e.target.closest('#kbd [data-close]')) { query = ''; renderSearch(); renderCats(); renderTiles(); }
  });
  $('#dlg-void').addEventListener('click', (e) => {
    if (e.target.closest('.btn-danger')) { closeLayer(e.target); toast(L('Vente #0185 annulée · stock remis en rayon', 'أُلغي البيع ‎#0185 · أعيد المخزون'), ''); }
  });

  function renderSearch() {
    $('#search').innerHTML = query
      ? `${icon('search')}<span class="val">${LANG === 'ar' ? 'كوكا' : 'coca'}</span><span class="caret"></span><span class="grow"></span><button class="btn btn-quiet btn-sm" data-close-search>${icon('x', 'ic-sm')}</button>`
      : `${icon('search')}<span class="ph">${L('Scanner ou chercher un produit', 'امسح أو ابحث عن منتج')}</span>`;
  }

  renderSearch(); renderCats(); renderTiles(); renderCart(); renderPads(); renderTickets(); renderKbd(); renderMult();

  /* deep-link states for screenshots */
  const open = Q.get('open') || '';
  if (open === 'pay') openLayer('dlg-pay');
  if (open === 'pay-credit') { method = 'credit'; renderPay(); openLayer('dlg-pay'); }
  if (open === 'weight') { weighing = 'tomates'; pads.weight = '0,750'; renderPads(); openLayer('dlg-weight'); }
  if (open === 'divers') openLayer('dlg-divers');
  if (open === 'qty') openLayer('dlg-qty');
  if (open === 'price') openLayer('dlg-price');
  if (open.startsWith('tickets') || open.startsWith('ticket')) openLayer('tickets');
  if (open === 'void') { ticket = '0185'; renderTickets(); openLayer('tickets'); openLayer('dlg-void'); }
  if (open === 'kbd') { query = 'coca'; renderSearch(); renderCats(); renderTiles(); openLayer('kbd'); }
  if (open === 'line') { selected = 'coca33'; renderCart(); }
  if (open === 'mult') { mult = 6; renderMult(); }
  if (open === 'sold') { const due = total(); lastTicket = { no: '0188', total: due, change: 5000 - due }; cart = []; undo = []; renderCart(); renderTiles(); toast(`${L('Vente enregistrée', 'تم تسجيل البيع')} · ${money(due)}`, `<button class="btn btn-quiet btn-sm">${icon('message', 'ic-sm')}WhatsApp</button><button class="btn btn-quiet btn-sm">${icon('printer', 'ic-sm')}${L('Imprimer', 'طباعة')}</button>`); }
  if (open === 'account') openLayer('pop-account');
  if (open === 'sync') openLayer('pop-sync');
  if (open === 'undo') { add('coca33', 1); toast(`${L('Ajouté :', 'أضيف:')} ${bdi('Coca-Cola 33cl')} · ×3`, `<button class="btn btn-quiet btn-sm">${icon('undo', 'ic-sm')}${L('Annuler', 'تراجع')}</button>`); }
}
