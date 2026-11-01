/* Clients, Products, Stock (receive + purchases), Reports, Settings, Lock. */

const catLabel = (id) => LO(CATEGORIES.find((c) => c.id === id));
const statusBadge = (s) => ({
  paid: `<span class="status ok">${icon('check')}${L('Payée', 'مدفوعة')}</span>`,
  partial: `<span class="status warn">${icon('clock')}${L('Partielle', 'جزئية')}</span>`,
  unpaid: `<span class="status bad">${icon('alert')}${L('Impayée', 'غير مدفوعة')}</span>`,
  voided: `<span class="status neutral">${icon('x')}${L('Annulée', 'ملغاة')}</span>`,
}[s]);

/* ------------------------------------------------------------------ */
function clientsScreen() {
  let filter = 'owing';
  let sel = Q.get('c') || 'c1';
  const initials = (n) => n.replace(/[^\p{L} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const ago = (d) => d === 0 ? L('aujourd’hui', 'اليوم') : d === 1 ? L('hier', 'أمس') : L(`il y a ${d} j`, `منذ ${d} أيام`);
  const totalOwed = CUSTOMERS.reduce((s, c) => s + c.owed, 0);
  $('#owed-total').innerHTML = money(totalOwed);

  function renderList() {
    const list = CUSTOMERS.filter((c) => filter === 'all' || (filter === 'owing' ? c.owed > 0 : c.owed <= 0));
    $('#c-list').innerHTML = list.map((c) => `<div class="row click ${c.id === sel ? 'sel' : ''}" data-c="${c.id}">
      <span class="c-avatar ${c.owed ? '' : 'settled'}">${initials(c.name)}</span>
      <div class="r-main"><div class="c-main">${bdi(c.name)}</div><div class="c-sub"><span class="num">${c.phone || L('pas de téléphone', 'بدون هاتف')}</span> · ${L('dernière opération', 'آخر عملية')} ${ago(c.last)}</div></div>
      ${c.owed ? (c.last >= 5 && c.paid === 0 ? `<span class="status warn">${L('Jamais payé', 'لم يدفع أبدًا')}</span>` : '') : `<span class="status ok">${icon('check')}${L('Soldé', 'مسوّى')}</span>`}
      ${c.owed ? `<span class="owed" style="min-width:110px;text-align:end;font-size:var(--fs-subtitle)">${money(c.owed)}</span>` : ''}
      ${icon('chevron', 'ic-sm muted')}</div>`).join('');
    $('#c-count-owing').textContent = CUSTOMERS.filter((c) => c.owed > 0).length;
    $('#c-count-settled').textContent = CUSTOMERS.filter((c) => c.owed <= 0).length;
    $('#c-count-all').textContent = CUSTOMERS.length;
  }
  function renderPanel() {
    const c = CUSTOMERS.find((x) => x.id === sel);
    $('#c-panel').innerHTML = `
      <div class="panel-head"><div class="panel-title">${bdi(c.name)}</div><button class="btn btn-quiet btn-icon owner-only" aria-label="${L('Modifier', 'تعديل')}">${icon('pencil')}</button><button class="btn btn-quiet btn-icon" data-close-panel aria-label="${L('Fermer', 'إغلاق')}">${icon('x')}</button></div>
      <div class="panel-body">
        <div style="display:flex;gap:8px;margin-bottom:16px">${c.phone ? `<button class="btn btn-secondary btn-sm">${icon('phone', 'ic-sm')}<span class="num">${c.phone}</span></button><button class="btn btn-secondary btn-sm">${icon('message', 'ic-sm')}WhatsApp</button>` : `<button class="btn btn-quiet btn-sm">${icon('plus', 'ic-sm')}${L('Ajouter un téléphone', 'إضافة هاتف')}</button>`}</div>
        <div class="card" style="box-shadow:none;background:var(--sunken)">
          <div class="muted" style="font-weight:600">${L('Doit au magasin', 'مدين للمحل')}</div>
          <div class="big-balance">${money(c.owed)}</div>
          <div class="muted" style="font-size:var(--fs-caption);margin-top:4px">${L('A pris', 'أخذ')} ${money(c.took)} · ${L('a payé', 'دفع')} ${money(c.paid)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;margin:14px 0 18px">
          <button class="btn btn-pay btn-block" style="height:var(--touch-lg);font-size:var(--fs-body)" data-open="dlg-cpay">${icon('banknote')}${L('Encaisser un paiement', 'تسجيل دفعة')}</button>
          <button class="btn btn-secondary btn-block">${icon('message')}${L('Envoyer le solde sur WhatsApp', 'إرسال الرصيد عبر واتساب')}</button>
        </div>
        <div class="card-title">${L('Historique', 'السجل')}</div>
        <div class="hist">${CUSTOMER_HISTORY.map((h) => `<div class="hist-row"><span class="hist-ic ${h.kind}">${icon(h.kind === 'paid' ? 'banknote' : 'cart', 'ic-sm')}</span>
          <div style="min-width:0"><div style="font-weight:600">${h.kind === 'paid' ? L('Paiement', 'دفعة') : L('Achat à crédit', 'شراء بالكريدي')}</div><div class="c-sub">${LO(h.d)} · ${LO(h.note)}</div></div>
          <b class="${h.kind === 'paid' ? 'up' : ''}">${h.kind === 'paid' ? money(-h.amount) : money(h.amount, true)}</b></div>`).join('')}</div>
      </div>`;
    $('#cpay-name').innerHTML = bdi(c.name);
    $('#cpay-all').innerHTML = `${L('Tout', 'الكل')} ${money(c.owed)}`;
  }
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-c]');
    if (r) { sel = r.dataset.c; $('.md').classList.add('with-panel'); renderList(); renderPanel(); }
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; renderList(); }
    if (e.target.closest('[data-close-panel]')) { $('.md').classList.remove('with-panel'); sel = null; renderList(); }
    if (e.target.closest('#cpay-ok')) { closeLayer(e.target); toast(`${L('Paiement enregistré', 'تم تسجيل الدفعة')} · 200.00 DH · ${L('reste', 'الباقي')} ${money(92000)}`, `<button class="btn btn-quiet btn-sm">${icon('message', 'ic-sm')}WhatsApp</button>`); }
  });
  renderList(); renderPanel();
  if (Q.get('open') === 'pay') openLayer('dlg-cpay');
  if (Q.get('open') === 'none') { $('.md').classList.remove('with-panel'); sel = null; renderList(); }
}

/* ------------------------------------------------------------------ */
function productsScreen() {
  let cat = 'all';
  let sel = Q.get('p') || (Q.get('open') === 'panel' ? 'jben' : null);
  const P = PRODUCTS.filter((p) => !p.misc);
  $('#p-count').textContent = P.length;
  $('#p-cats').innerHTML = `<button class="chip ${cat === 'all' ? 'on' : ''}" data-pcat="all">${L('Toutes', 'الكل')}</button>` + CATEGORIES.filter((c) => !c.star).map((c) => `<button class="chip" data-pcat="${c.id}">${LO(c)}</button>`).join('');
  function renderTable() {
    const rows = P.filter((p) => cat === 'all' || p.cat === cat).sort((a, b) => a.name.localeCompare(b.name));
    $('#p-rows').innerHTML = rows.map((p) => {
      const marginC = p.price - p.cost;
      const pct = ((marginC / p.price) * 100).toFixed(1);
      const st = p.kg ? p.stock.toFixed(1) : p.stock;
      const stCls = p.stock <= 0 ? 'bad' : p.stock <= p.low ? 'warn' : 'neutral';
      return `<tr class="click ${p.id === sel ? 'sel' : ''}" data-p="${p.id}">
        <td style="max-width:260px"><div class="c-main">${bdi(p.name)}</div><div class="c-sub"><span class="num">${p.bc || L('sans code-barres', 'بدون باركود')}</span></div></td>
        <td class="c-sub hide-narrow" style="color:var(--ink-700)">${catLabel(p.cat)}</td>
        <td class="num"><span class="badge ${stCls}" style="height:28px;font-size:14px">${st}${p.kg ? ' kg' : ''}</span></td>
        <td class="num owner-only muted">${money(p.cost)}</td>
        <td class="num"><b>${money(p.price)}</b>${p.kg ? '<span class="muted" style="font-size:13px">/kg</span>' : ''}</td>
        <td class="num owner-only"><span class="${marginC >= 0 ? 'up' : 'down'}" style="font-weight:600">${money(marginC, true)}</span><div class="c-sub num">${pct} %</div></td>
        <td style="width:40px">${icon('chevron', 'ic-sm muted')}</td></tr>`;
    }).join('');
  }
  function renderPanel() {
    const p = PRODUCTS.find((x) => x.id === sel);
    if (!p) { $('.md').classList.remove('with-panel'); return; }
    $('.md').classList.add('with-panel');
    const newPrice = 650;
    const m = newPrice - p.cost;
    $('#p-panel').innerHTML = `
      <div class="panel-head"><div class="panel-title">${bdi(p.name)}</div><button class="btn btn-quiet btn-icon" data-close-panel aria-label="${L('Fermer', 'إغلاق')}">${icon('x')}</button></div>
      <div class="tabs" data-tabs="p-panes" style="padding-inline:12px"><button data-tab="fiche" class="on">${L('Fiche', 'البطاقة')}</button><button data-tab="hist">${L('Prix d’achat', 'سعر الشراء')}</button><button data-tab="moves">${L('Mouvements', 'الحركات')}</button></div>
      <div class="panel-body" id="p-panes">
        <div data-pane="fiche">
          <div class="form-row"><span class="lbl">${L('Nom', 'الاسم')}</span><div class="field"><span class="val">${bdi(p.name)}</span></div></div>
          <div class="form-row"><span class="lbl">${L('Code-barres', 'الباركود')}</span><div style="display:flex;gap:8px"><div class="field grow"><span class="${p.bc ? 'val num' : 'ph'}">${p.bc || L('Aucun : scannez ou générez-en un', 'لا يوجد: امسح أو أنشئ واحدًا')}</span></div><button class="btn btn-secondary btn-icon" aria-label="${L('Scanner', 'مسح')}">${icon('scan')}</button><button class="btn btn-secondary">${icon('printer', 'ic-sm')}${L('Étiquette', 'ملصق')}</button></div></div>
          <div class="form-2 form-row">
            <div><span class="lbl">${L('Catégorie', 'الفئة')}</span><div class="field"><span class="val">${catLabel(p.cat)}</span>${icon('down', 'ic-sm muted')}</div></div>
            <div><span class="lbl">${L('Vendu à', 'يباع بـ')}</span><div class="seg"><button class="${p.kg ? '' : 'on'}">${L('la pièce', 'القطعة')}</button><button class="${p.kg ? 'on' : ''}">${L('au kg', 'الكيلو')}</button></div></div>
          </div>
          <div class="form-2 form-row">
            <div><span class="lbl">${L('Prix de vente', 'ثمن البيع')}</span><div class="field focus" style="direction:ltr;justify-content:flex-end"><span class="val num" style="text-align:end">6.50</span><span class="caret"></span><span class="muted">DH</span></div></div>
            <div><span class="lbl">${L('Alerte stock bas à', 'تنبيه المخزون المنخفض عند')}</span><div class="field" style="direction:ltr;justify-content:flex-end"><span class="val num" style="text-align:end">${p.low}</span></div></div>
          </div>
          <div class="banner ok" style="margin-bottom:16px">${icon('up')}<span>${L('Marge', 'الهامش')} <b>${money(m, true)}</b> · <span class="num">${((m / newPrice) * 100).toFixed(1)} %</span> ${L('sur le coût moyen', 'على متوسط التكلفة')} ${money(p.cost)}</span></div>
          <div class="banner info">${icon('info')}<span>${L('Le stock et le prix d’achat changent dans Stock (réception, inventaire), pas ici.', 'المخزون وسعر الشراء يتغيران في المخزون (الاستلام، الجرد)، وليس هنا.')}</span></div>
        </div>
        <div data-pane="hist" class="hidden"><div class="state"><div class="state-ic">${icon('chart', 'ic-lg')}</div><h3>${L('Historique des prix d’achat', 'تاريخ أسعار الشراء')}</h3><p>${L('Écran existant (products/history), déplacé ici en onglet.', 'الشاشة الحالية، منقولة هنا كتبويب.')}</p></div></div>
        <div data-pane="moves" class="hidden"><div class="state"><div class="state-ic">${icon('clipboard', 'ic-lg')}</div><h3>${L('Livraisons, ventes et ajustements', 'التسليمات والمبيعات والتعديلات')}</h3><p>${L('Plus tard (voir le plan).', 'لاحقًا (انظر الخطة).')}</p></div></div>
      </div>
      <div class="panel-foot"><button class="btn btn-quiet" style="color:var(--danger-700)">${L('Désactiver', 'تعطيل')}</button><span class="grow"></span><button class="btn btn-secondary" data-close-panel>${L('Annuler', 'إلغاء')}</button><button class="btn btn-primary">${icon('check')}${L('Enregistrer', 'حفظ')}</button></div>`;
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-pcat]');
    if (c) { cat = c.dataset.pcat; $$('[data-pcat]').forEach((x) => x.classList.toggle('on', x === c)); renderTable(); }
    const r = e.target.closest('[data-p]');
    if (r) { sel = r.dataset.p; renderTable(); renderPanel(); }
    if (e.target.closest('[data-close-panel]')) { sel = null; renderTable(); renderPanel(); }
  });
  renderTable(); renderPanel();
}

/* ------------------------------------------------------------------ */
function receiveScreen() {
  $('#r-rows').innerHTML = RECEIVE_LINES.map((l) => `<tr>
    <td style="max-width:220px"><div class="c-main">${bdi(l.name)}</div><div class="c-sub">${L('stock', 'المخزون')} <span class="num">${l.stock}</span> · ${L('dernier prix', 'آخر ثمن')} ${money(l.last)}</div></td>
    <td><span class="cell-input ${l.incomplete ? 'empty' : ''}">${l.qty || '&nbsp;'}</span>${l.packs ? `<div class="c-sub num" style="margin-top:2px">${l.packs}</div>` : l.free ? `<div class="c-sub">+<span class="num">${l.free}</span> ${L('gratuits', 'مجانًا')}</div>` : ''}</td>
    <td><span class="cell-input ${l.incomplete ? 'empty' : ''}" style="min-width:96px">${l.total || '&nbsp;'}</span>${l.unit ? `<div class="c-sub" style="margin-top:2px">≈ <span class="num">${l.unit}</span> / ${L('u', 'و')}</div>` : ''}</td>
    <td>${l.suggest ? `<span class="suggest">${icon('alert', 'ic-sm')}${LO(l.alert)}</span><div class="c-sub" style="margin-top:4px">${L('Vente', 'البيع')} 6.00 → <b class="num" style="color:var(--ink-900)">${l.suggest}</b> ?</div>` : `<span class="muted">${l.price ? money(l.price) : '—'}</span>`}</td>
    <td><span class="cell-input date ${l.incomplete ? '' : ''}">${LO(l.expiry) || icon('calendar', 'ic-sm muted')}</span></td>
    <td style="width:56px"><button class="btn btn-quiet btn-icon" aria-label="${L('Retirer', 'إزالة')}" style="color:var(--ink-600)">${icon('trash')}</button></td></tr>`).join('');
}

/* ------------------------------------------------------------------ */
function purchasesScreen() {
  let sel = Q.get('d') || (Q.get('open') === 'none' ? null : 'p8');
  if (Q.get('open') === 'void') sel = 'p8';
  function renderTable() {
    $('#h-rows').innerHTML = PURCHASES.map((p) => `<tr class="click ${p.status === 'voided' ? 'void' : ''} ${p.id === sel ? 'sel' : ''}" data-d="${p.id}">
      <td class="num" style="width:90px"><b>${LO(p.date)}</b></td>
      <td><div class="c-main strike">${bdi(p.supplier)}</div></td>
      <td class="c-sub num">${p.inv || '—'}</td>
      <td class="num muted">${p.lines}</td>
      <td class="num"><b class="strike">${money(p.total)}</b>${p.status === 'partial' ? `<div class="c-sub">${L('reste', 'الباقي')} ${money(p.total - p.paid)}</div>` : ''}</td>
      <td>${statusBadge(p.status)}</td>
      <td style="width:40px;color:var(--ink-600)">${p.photo ? icon('image', 'ic-sm') : ''}</td></tr>`).join('');
    const live = PURCHASES.filter((p) => p.status !== 'voided');
    $('#h-foot').innerHTML = `<span>${live.length} ${L('livraisons', 'تسليمات')}</span><span class="muted" style="font-weight:500">· ${L('1 annulée exclue', 'واحدة ملغاة مستثناة')}</span><span class="grow"></span><span class="muted" style="font-weight:500">${L('Reste à payer', 'الباقي للدفع')}</span><b style="color:var(--danger-700)">${money(PURCHASES.filter((p) => p.status === 'unpaid').reduce((s, p) => s + p.total, 0) + 96000)}</b><span class="muted" style="font-weight:500;margin-inline-start:12px">${L('Total', 'المجموع')}</span><b>${money(live.reduce((s, p) => s + p.total, 0))}</b>`;
  }
  function renderPanel() {
    const p = PURCHASES.find((x) => x.id === sel);
    if (!p) { $('.md').classList.remove('with-panel'); return; }
    $('.md').classList.add('with-panel');
    $('#d-panel').innerHTML = `
      <div class="panel-head"><div class="panel-title">${bdi(p.supplier)}</div>${statusBadge(p.status)}<button class="btn btn-quiet btn-icon" data-close-panel aria-label="${L('Fermer', 'إغلاق')}">${icon('x')}</button></div>
      <div class="panel-body">
        <div style="display:grid;grid-template-columns:1fr 1fr 88px;gap:6px 16px;align-items:start;margin-bottom:14px">
          <div><div class="c-sub">${L('Facture', 'الفاتورة')}</div><b class="num">${p.inv}</b></div>
          <div><div class="c-sub">${L('Livrée le', 'سُلّمت في')}</div><b>${LO(p.date)}</b></div>
          <div style="grid-row:span 2;height:88px;border-radius:var(--r-control);background:repeating-linear-gradient(0deg,#fff 0 8px,#eef1f3 8px 10px);box-shadow:inset 0 0 0 1px var(--border);display:grid;place-items:center;color:var(--ink-600)">${icon('image')}</div>
          <div style="grid-column:span 2"><div class="c-sub">${L('Saisie', 'أُدخلت')} <span class="num">30/10 10:42</span> · ${L('Mouad', 'مُعاذ')}</div></div>
        </div>
        <table class="table" style="margin-inline:-20px;width:calc(100% + 40px)"><thead><tr><th>${L('Produit', 'المنتج')}</th><th class="num">${L('Qté', 'الكمية')}</th><th class="num">${L('Total', 'المجموع')}</th></tr></thead>
        <tbody>${DELIVERY_LINES.map((l) => `<tr><td style="height:54px"><div class="c-main">${bdi(l.name)}</div><div class="c-sub">≈ ${money(l.unit)} / ${L('u', 'و')} · ${L('pér.', 'صلاحية')} <span class="num">${LO(l.expiry)}</span></div></td><td class="num"><b>${l.qty}</b>${l.free ? `<div class="c-sub">+${l.free} ${L('gratuits', 'مجانًا')}</div>` : l.packs ? `<div class="c-sub num">${l.packs}</div>` : ''}</td><td class="num"><b>${money(l.total)}</b></td></tr>`).join('')}</tbody></table>
        <div style="margin-top:12px;display:grid;grid-template-columns:1fr auto;gap:6px 12px">
          <span class="muted">${L('Total facture', 'مجموع الفاتورة')}</span><b>${money(p.total)}</b>
          <span class="muted">${L('Payé', 'المدفوع')}</span><span class="up" style="font-weight:600">${money(p.paid || 0)}</span>
          <b>${L('Reste à payer', 'الباقي للدفع')}</b><b style="color:var(--danger-700);font-size:var(--fs-subtitle)">${money(p.total - (p.paid || 0))}</b>
        </div>
      </div>
      <div class="panel-foot"><button class="btn btn-danger-soft btn-sm" data-open="dlg-dvoid">${icon('undo', 'ic-sm')}${L('Annuler', 'إلغاء')}</button><button class="btn btn-secondary btn-sm">${icon('copy', 'ic-sm')}${L('Dupliquer', 'نسخ')}</button><span class="grow"></span><button class="btn btn-primary">${icon('banknote')}${L('Payer le fournisseur', 'الدفع للمورد')}</button></div>`;
  }
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-d]');
    if (r) { sel = r.dataset.d; renderTable(); renderPanel(); }
    if (e.target.closest('[data-close-panel]')) { sel = null; renderTable(); renderPanel(); }
  });
  renderTable(); renderPanel();
  if (Q.get('open') === 'void') openLayer('dlg-dvoid');
}

/* ------------------------------------------------------------------ */
function reportsScreen() {
  const R = REPORT;
  const pct = (a, b) => (((a - b) / b) * 100).toFixed(1);
  const delta = (a, b, unit = '%') => { const v = unit === 'pt' ? (a - b).toFixed(1) : pct(a, b); const up = v >= 0; return `<span class="delta ${up ? 'up' : 'down'}">${icon(up ? 'up' : 'downtrend')}<span class="num">${up ? '+' : '−'}${Math.abs(v)} ${unit === 'pt' ? 'pt' : '%'}</span> <span class="muted" style="font-weight:500">${L('vs hier', 'مقارنة بالأمس')}</span></span>`; };
  $('#k-profit').innerHTML = `<div class="card-title">${icon('coins', 'ic-sm')}${L('Bénéfice brut', 'الربح الإجمالي')}</div><div class="v">${money(R.profit)}</div><span class="delta">${icon('up')}<span class="num">+${pct(R.profit, R.profitPrev)} %</span> ${L('vs hier', 'مقارنة بالأمس')}</span>`;
  $('#k-rev').innerHTML = `<div class="card-title">${L('Chiffre d’affaires', 'رقم المعاملات')}</div><div class="v">${money(R.revenue)}</div>${delta(R.revenue, R.revenuePrev)}`;
  $('#k-tix').innerHTML = `<div class="card-title">${L('Tickets', 'التذاكر')}</div><div class="v num">${R.tickets}</div><span class="delta muted">${L('Panier moyen', 'متوسط السلة')}&nbsp;<b style="color:var(--ink-900)">${money(R.basket)}</b></span>`;
  $('#k-margin').innerHTML = `<div class="card-title">${L('Marge', 'الهامش')}</div><div class="v num">${R.margin} %</div>${delta(R.margin, R.marginPrev, 'pt')}`;
  const max = Math.max(...R.days.map((d) => d.rev));
  $('#bars').innerHTML = R.days.map((d) => `<div class="bar ${d.today ? 'today' : ''}"><div class="stack" style="height:${(d.rev / max) * 100}%"><div class="prof" style="height:${(d.prof / d.rev) * 100}%"></div></div><span class="lab">${LANG === 'ar' ? d.ar : d.d}</span></div>`).join('');
  $('#top').innerHTML = R.top.map((t, i) => `<tr><td style="height:46px"><span class="muted num" style="display:inline-block;width:24px">${i + 1}</span> ${bdi(t.name)}</td><td class="num muted">${t.qty}</td><td class="num"><b class="up">${money(t.profit, true)}</b></td></tr>`).join('');
  $('#cats').innerHTML = R.cats.map((c) => `<div class="hbar"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${catLabel(c.id)}</span><div class="track"><div class="fillb" style="width:${c.share * 3}%"></div></div><span class="num" style="text-align:end;font-weight:600">${c.share} %</span></div>`).join('');
  const hmax = Math.max(...R.hours);
  $('#hours').innerHTML = R.hours.map((h, i) => `<i style="height:${(h / hmax) * 100}%;${i === 12 ? 'background:var(--success-600);opacity:1' : ''}"></i>`).join('');
}

/* ------------------------------------------------------------------ */
function settingsScreen() {
  const pane = Q.get('pane') || (ROLE === 'owner' ? 'team' : 'lang');
  $$('.set-nav [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === pane));
  $$('.set-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === pane));
}

/* ------------------------------------------------------------------ */
function lockScreen() {
  let who = Q.get('open') === 'pin' ? 'salma' : null;
  let pin = Q.get('open') === 'pin' ? 2 : 0;
  function render() {
    $$('.who-card').forEach((c) => c.classList.toggle('on', c.dataset.who === who));
    $('#pin').classList.toggle('open', !!who);
    $('#who-hint').classList.toggle('hidden', !!who);
    $('#pin-dots').innerHTML = [0, 1, 2, 3].map((i) => `<i class="${i < pin ? 'f' : ''}"></i>`).join('');
    if (who) $('#pin-name').textContent = { salma: L('Salma', 'سلمى'), youssef: L('Youssef', 'يوسف'), mouad: L('Mouad', 'مُعاذ') }[who];
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.who-card');
    if (c) { who = c.dataset.who; pin = 0; render(); return; }
    const k = e.target.closest('.lock [data-k]');
    if (k) {
      if (k.dataset.k === 'del') pin = Math.max(0, pin - 1); else pin += 1;
      render();
      if (pin >= 4) {
        const role = who === 'mouad' ? 'owner' : 'cashier';
        setTimeout(() => { location.href = withParams('sell.html', { role, user: who }); }, 250);
      }
    }
  });
  render();
}
