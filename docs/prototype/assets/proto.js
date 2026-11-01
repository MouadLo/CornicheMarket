/* Prototype runtime: language + role from the URL, the POS shell (top bar,
   awning, rail), layers (dialogs, panels, popovers), toasts and links.
   URL parameters:
     lang=fr|ar   role=owner|cashier   user=salma|youssef|mouad
     net=online|offline|stuck          open=<layer id>[:<arg>]
     shot         (hide the prototype bar, for screenshots) */
const Q = new URLSearchParams(location.search);
const LANG = Q.get('lang') === 'ar' ? 'ar' : 'fr';
const ROLE = Q.get('role') === 'cashier' ? 'cashier' : 'owner';
const NET = Q.get('net') || 'online';
const SHOT = Q.has('shot');
const PAGE = document.body.dataset.page;
const SECTION = document.body.dataset.section;
const USER = TEAM.find((p) => p.id === Q.get('user')) || (ROLE === 'owner' ? TEAM[0] : TEAM[1]);

const html = document.documentElement;
html.lang = LANG;
html.dir = LANG === 'ar' ? 'rtl' : 'ltr';
html.dataset.role = ROLE;
if (SHOT) document.body.classList.add('shot');

function L(fr, ar) { return LANG === 'ar' ? ar : fr; }
function LO(o) { return o ? o[LANG] : ''; }
function money(c, sign = false) {
  const a = Math.abs(Math.round(c));
  const [i, d] = (a / 100).toFixed(2).split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const s = c < 0 ? '−' : sign && c > 0 ? '+' : '';
  return `<span class="money">${s}${grouped}.${d} DH</span>`;
}
function moneyText(c) { return money(c).replace(/<[^>]+>/g, ''); }
function qtyText(q, kg) { return kg ? `${q.toFixed(3)} kg` : String(q); }
function esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
function bdi(s) { return `<bdi>${esc(s)}</bdi>`; }
function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function withParams(href, extra = {}) {
  if (!href || /^(https?:|#|mailto:)/.test(href)) return href;
  const [path, qs] = href.split('?');
  const p = new URLSearchParams(qs || '');
  if (!p.has('lang')) p.set('lang', LANG);
  if (!p.has('role')) p.set('role', ROLE);
  if (Q.get('user') && !p.has('user')) p.set('user', Q.get('user'));
  if (Q.get('net') && !p.has('net')) p.set('net', Q.get('net'));
  for (const [k, v] of Object.entries(extra)) v == null ? p.delete(k) : p.set(k, v);
  return `${path}?${p.toString()}`;
}

/* ---------------------------------------------------------------- */
/* Shell                                                             */
/* ---------------------------------------------------------------- */
const SECTIONS = [
  { id: 'sell', href: 'sell.html', icon: 'cart', fr: 'Vente', ar: 'بيع' },
  { id: 'clients', href: 'clients.html', icon: 'book', fr: 'Clients', ar: 'الزبائن' },
  { id: 'products', href: 'products.html', icon: 'package', fr: 'Produits', ar: 'المنتجات', owner: true },
  { id: 'stock', href: 'stock.html', icon: 'truck', fr: 'Stock', ar: 'المخزون', owner: true, badge: '8', tone: 'warn' },
  { id: 'reports', href: 'reports.html', icon: 'chart', fr: 'Rapports', ar: 'التقارير', owner: true },
  { id: 'settings', href: 'settings.html', icon: 'sliders', fr: 'Réglages', ar: 'الإعدادات', owner: true },
];

function syncPill() {
  if (NET === 'offline') return `<button class="pill warn" data-open="pop-sync">${icon('wifioff', 'ic-sm')}<span>${L('Hors ligne · 3 en attente', 'غير متصل · 3 في الانتظار')}</span></button>`;
  if (NET === 'stuck') return `<button class="pill bad" data-open="pop-sync">${icon('alert', 'ic-sm')}<span>${L('1 vente bloquée', 'بيع واحد عالق')}</span></button>`;
  return `<button class="pill ok" data-open="pop-sync"><span class="dot"></span><span>${L('En ligne', 'متصل')}</span></button>`;
}

function renderShell() {
  const top = $('#topbar');
  if (top) {
    const roleLabel = USER.role === 'owner' ? L('Propriétaire', 'المالك') : L('Caissière', 'أمينة الصندوق');
    const name = USER.id === 'mouad' ? L('Mouad', 'مُعاذ') : USER.id === 'salma' ? L('Salma', 'سلمى') : L('Youssef', 'يوسف');
    top.innerHTML = `
      <div class="brand">${brandMark(36)}<div><div class="brand-name">Corniche Market</div><div class="brand-sub">${L('Aïn Diab · Casablanca', 'عين الذئاب · الدار البيضاء')}</div></div></div>
      <div class="spacer"></div>
      ${document.body.dataset.device !== 'tablet' ? `<span class="pill scanner-pill">${icon('scan', 'ic-sm')}<span>${L('Scanner prêt', 'الماسح جاهز')}</span></span>` : ''}
      ${syncPill()}
      <button class="tb-btn who" data-open="pop-account"><span class="avatar ${USER.hue}">${USER.id === 'mouad' ? L('M', 'م') : USER.id === 'salma' ? L('S', 'س') : L('Y', 'ي')}</span><span class="who-txt"><span>${name}</span><small>${roleLabel}</small></span>${icon('down', 'ic-sm')}</button>
      <div class="clock"><b class="num">14:32</b><small>${L('dim. 1 nov.', 'الأحد 1 نونبر')}</small></div>`;
  }
  const rail = $('#rail');
  if (rail) {
    const items = SECTIONS.filter((s) => !s.owner || ROLE === 'owner').map((s) => {
      const on = s.id === SECTION ? ' on' : '';
      let badge = '';
      if (s.id === 'sell' && SECTION !== 'sell') badge = `<span class="badge brand rb">4</span>`;
      else if (s.badge) badge = `<span class="badge ${s.tone} rb">${s.badge}</span>`;
      return `<a class="${on.trim()}" href="${withParams(s.href)}"><span class="ri">${icon(s.icon)}</span><span>${L(s.fr, s.ar)}</span>${badge}</a>`;
    }).join('');
    rail.innerHTML = `${items}<div class="fill"></div>
      <a href="${withParams('lock.html')}"><span class="ri">${icon('lock')}</span><span>${L('Verrouiller', 'قفل')}</span></a>`;
  }
  const dev = $('.device');
  if (dev && !$('#pop-account')) dev.insertAdjacentHTML('beforeend', popovers());
}

function popovers() {
  const langLink = (code, label) => `<a class="chip ${LANG === code ? 'on' : ''}" href="${withParams(location.pathname.split('/').pop(), { lang: code })}">${label}</a>`;
  return `
  <div class="click-catcher" data-close></div>
  <div class="popover" id="pop-account" role="dialog">
    <div class="pop-head"><span class="avatar ${USER.hue}" style="width:48px;height:48px;font-size:20px">${USER.id === 'mouad' ? L('M', 'م') : L('S', 'س')}</span>
      <div><b>${USER.id === 'mouad' ? L('Mouad', 'مُعاذ') : L('Salma', 'سلمى')}</b><div class="muted" style="font-size:var(--fs-caption)">${USER.role === 'owner' ? L('Propriétaire · depuis 08:02', 'المالك · منذ 08:02') : L('Caissière · depuis 08:02', 'أمينة الصندوق · منذ 08:02')}</div></div></div>
    <div class="pop-sec"><div class="lbl">${L('Langue de l’appareil', 'لغة الجهاز')}</div><div class="chips">${langLink('fr', 'Français')}${langLink('ar', 'العربية')}<span class="chip">English</span></div></div>
    <a class="pop-item" href="${withParams('lock.html', { open: 'who' })}">${icon('users')}<span>${L('Changer de caissier', 'تغيير أمين الصندوق')}</span></a>
    <a class="pop-item" href="${withParams('lock.html')}">${icon('lock')}<span>${L('Verrouiller maintenant', 'قفل الآن')}</span></a>
    <a class="pop-item cashier-only" href="#" data-close>${icon('receipt')}<span>${L('Mes ventes du jour', 'مبيعاتي اليوم')}</span><span class="grow"></span><span class="muted money">1 284.50 DH</span></a>
    <a class="pop-item owner-only" href="${withParams('settings.html')}">${icon('sliders')}<span>${L('Réglages', 'الإعدادات')}</span></a>
    <a class="pop-item owner-only" href="#" data-close style="color:var(--danger-700)">${icon('logout')}<span>${L('Déconnecter cet appareil', 'تسجيل خروج هذا الجهاز')}</span></a>
  </div>
  <div class="popover" id="pop-sync" role="dialog" style="inset-inline-end:200px">
    <div class="pop-head">${NET === 'online' ? `<span class="d-icon ok">${icon('check')}</span>` : NET === 'offline' ? `<span class="d-icon" style="background:var(--warning-100);color:var(--warning-700)">${icon('wifioff')}</span>` : `<span class="d-icon bad">${icon('alert')}</span>`}
      <div><b>${NET === 'online' ? L('Tout est synchronisé', 'كل شيء متزامن') : NET === 'offline' ? L('Hors ligne', 'غير متصل') : L('Une vente refusée par le serveur', 'بيع رفضه الخادم')}</b>
      <div class="muted" style="font-size:var(--fs-caption)">${NET === 'online' ? L('Dernier envoi 14:31 · prix à jour 14:20', 'آخر إرسال 14:31 · الأسعار محدثة 14:20') : NET === 'offline' ? L('Les ventes sont gardées sur l’appareil et partiront au retour du réseau.', 'المبيعات محفوظة في الجهاز وسترسل عند عودة الشبكة.') : L('Elle est gardée sur l’appareil. Rien n’est perdu.', 'محفوظ في الجهاز. لم يضِع شيء.')}</div></div></div>
    ${NET === 'online' ? '' : `<div class="pop-sec"><div class="row" style="padding:0;min-height:56px;border:0;background:none"><div class="r-main"><div class="c-main">${L('Ticket #0188 · 14:29', 'التذكرة ‎#0188 · 14:29')}</div><div class="c-sub">${NET === 'offline' ? L('En attente du réseau', 'في انتظار الشبكة') : L('Prix Divers au-dessus du maximum', 'مبلغ متفرقات فوق الحد')}</div></div>${money(3255)}</div></div>`}
    <div class="pop-sec" style="display:flex;gap:8px;border:0">
      ${NET === 'stuck' ? `<button class="btn btn-primary btn-sm owner-only">${icon('refresh', 'ic-sm')}${L('Réessayer', 'إعادة المحاولة')}</button><button class="btn btn-secondary btn-sm owner-only">${icon('download', 'ic-sm')}${L('Exporter', 'تصدير')}</button><span class="cashier-only muted" style="font-size:var(--fs-caption)">${L('Le propriétaire est prévenu.', 'تم إخطار المالك.')}</span>` : `<button class="btn btn-secondary btn-sm">${icon('refresh', 'ic-sm')}${L('Synchroniser maintenant', 'زامن الآن')}</button>`}
    </div>
  </div>
  <div class="toast-zone" id="toasts"></div>`;
}

/* ---------------------------------------------------------------- */
/* Layers                                                            */
/* ---------------------------------------------------------------- */
const LAYER_SEL = '.dialog-wrap, .popover, .over-panel, .kbd, .camera';
function openLayer(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.classList.contains('popover')) { $$('.popover.open').forEach((p) => p.classList.remove('open')); $('.click-catcher')?.classList.add('open'); }
  el.classList.add('open');
  el.dispatchEvent(new CustomEvent('layer:open'));
}
function closeLayer(el) {
  const layer = el.closest ? el.closest(LAYER_SEL) : null;
  if (layer) { layer.classList.remove('open'); layer.dispatchEvent(new CustomEvent('layer:close')); }
  if (!layer || layer.classList.contains('popover') || el.classList.contains('click-catcher')) {
    $$('.popover.open').forEach((p) => p.classList.remove('open'));
    $('.click-catcher')?.classList.remove('open');
  }
}
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  if (opener) { e.preventDefault(); openLayer(opener.dataset.open); return; }
  const closer = e.target.closest('[data-close]');
  if (closer) { e.preventDefault(); closeLayer(closer); }
  const wrap = e.target.classList?.contains('dialog-wrap') ? e.target : null;
  if (wrap && !wrap.dataset.modal) closeLayer(wrap);
});

function toast(text, actions = '', ms = 5000) {
  const zone = $('#toasts');
  if (!zone) return;
  zone.innerHTML = `<div class="toast" role="status">${icon('check')}<span>${text}</span>${actions}</div>`;
  clearTimeout(toast.t);
  if (!SHOT) toast.t = setTimeout(() => { zone.innerHTML = ''; }, ms);
}

/* Tabs and single-choice chip groups */
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    const group = tab.closest('[data-tabs]');
    $$('[data-tab]', group).forEach((t) => t.classList.toggle('on', t === tab));
    const scope = group.dataset.tabs ? document.getElementById(group.dataset.tabs) : document;
    $$('[data-pane]', scope).forEach((p) => p.classList.toggle('on', p.dataset.pane === tab.dataset.tab));
    $$('[data-pane]', scope).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab.dataset.tab && !p.classList.contains('set-pane')));
  }
  const chip = e.target.closest('[data-chips="one"] .chip');
  if (chip) $$('.chip', chip.parentElement).forEach((c) => c.classList.toggle('on', c === chip));
  const seg = e.target.closest('.seg button');
  if (seg) $$('button', seg.parentElement).forEach((b) => b.classList.toggle('on', b === seg));
  const tog = e.target.closest('.toggle');
  if (tog) tog.classList.toggle('on');
});

/* ---------------------------------------------------------------- */
/* Language strings in markup: <span data-ar="...">French</span>     */
/* ---------------------------------------------------------------- */
function applyLang(root = document) {
  if (LANG !== 'ar') return;
  $$('[data-ar]', root).forEach((el) => { el.textContent = el.dataset.ar; });
  $$('[data-ar-title]', root).forEach((el) => { el.title = el.dataset.arTitle; });
}
function fixLinks(root = document) {
  $$('a[href]', root).forEach((a) => {
    const h = a.getAttribute('href');
    if (/\.html(\?|$)/.test(h) && !a.dataset.raw) a.setAttribute('href', withParams(h));
  });
}
function hydrateIcons(root = document) {
  $$('i[data-icon]', root).forEach((i) => { i.outerHTML = icon(i.dataset.icon, i.className); });
}

/* ---------------------------------------------------------------- */
/* Prototype bar (outside the device)                                */
/* ---------------------------------------------------------------- */
const SCREENS = [
  ['index.html', 'Index'], ['sell.html', 'Vente (laptop)'], ['sell-tablet.html', 'Vente (tablette)'],
  ['clients.html', 'Clients / crédit'], ['products.html', 'Produits'], ['stock.html', 'Stock · réception'],
  ['stock-history.html', 'Stock · achats'], ['reports.html', 'Rapports'], ['settings.html', 'Réglages'], ['lock.html', 'Verrouillage / PIN'],
];
function protoBar() {
  if (SHOT) return;
  const file = location.pathname.split('/').pop() || 'index.html';
  const keep = (extra) => withParams(file, extra);
  const dev = $('.device');
  const size = dev ? `${getComputedStyle(dev).getPropertyValue('--dw').trim()} × ${getComputedStyle(dev).getPropertyValue('--dh').trim()}` : '';
  const states = (window.STATES || []).map(([v, label]) => `<option value="${v}" ${Q.get('open') === v ? 'selected' : ''}>${label}</option>`).join('');
  const bar = document.createElement('div');
  bar.className = 'proto-bar';
  bar.innerHTML = `
    <b>Corniche Market · prototype</b>
    <span class="grp"><a class="${LANG === 'fr' ? 'on' : ''}" href="${keep({ lang: 'fr' })}">FR</a><a class="${LANG === 'ar' ? 'on' : ''}" href="${keep({ lang: 'ar' })}">AR</a></span>
    <span class="grp"><a class="${ROLE === 'owner' ? 'on' : ''}" href="${keep({ role: 'owner', user: null })}">Propriétaire</a><a class="${ROLE === 'cashier' ? 'on' : ''}" href="${keep({ role: 'cashier', user: null })}">Caissière</a></span>
    <span class="grp"><a class="${NET === 'online' ? 'on' : ''}" href="${keep({ net: null })}">En ligne</a><a class="${NET === 'offline' ? 'on' : ''}" href="${keep({ net: 'offline' })}">Hors ligne</a><a class="${NET === 'stuck' ? 'on' : ''}" href="${keep({ net: 'stuck' })}">Bloquée</a></span>
    <select onchange="location.href=this.value">${SCREENS.map(([f, l]) => `<option value="${withParams(f, { open: null })}" ${f === file ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${states ? `<select onchange="location.href=this.value"><option value="${keep({ open: null })}">État : normal</option>${(window.STATES || []).map(([v, label]) => `<option value="${keep({ open: v })}" ${Q.get('open') === v ? 'selected' : ''}>${label}</option>`).join('')}</select>` : ''}
    <span class="hint">${size} · tactile uniquement</span>`;
  document.body.prepend(bar);
}
function fitDevice() {
  const dev = $('.device');
  if (!dev || SHOT) return;
  const w = dev.offsetWidth + 60, h = dev.offsetHeight + 110;
  const s = Math.min(1, window.innerWidth / w, Math.max(0.5, window.innerHeight / h));
  dev.style.transform = s < 1 ? `scale(${s})` : '';
  dev.parentElement.style.height = s < 1 ? `${dev.offsetHeight * s + 40}px` : '';
}

function bootShell() {
  const dv = Q.get('device');
  if (dv && $('.device')) { $('.device').dataset.device = dv; document.body.dataset.device = dv === 'laptop-lg' ? 'laptop' : dv; }
  renderShell();
  hydrateIcons();
  applyLang();
  fixLinks();
  protoBar();
  fitDevice();
  window.addEventListener('resize', fitDevice);
}
