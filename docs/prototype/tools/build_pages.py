"""Writes the prototype's HTML pages (except sell*.html) from one template,
so the <head>, the shell and the script order stay identical everywhere.
Run from docs/prototype:  python3 tools/build_pages.py"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
HEAD = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Corniche Market</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/tokens.css">
<link rel="stylesheet" href="assets/app.css">
</head>
"""
SCRIPTS = """<script src="assets/icons.js"></script>
<script src="assets/data.js"></script>
<script src="assets/proto.js"></script>
<script src="assets/screens.js"></script>
"""

def page(name, title, section, main, dialogs="", init="", states=None, shell=True, device="laptop"):
    st = ""
    if states:
        st = "window.STATES = [" + ",".join(f"['{k}','{v}']" for k, v in states) + "];"
    body = f'<body data-page="{name}" data-section="{section}" data-device="{device}">\n<div class="stage"><div class="device" data-device="{device}">\n'
    if shell:
        body += '<div class="app">\n  <header class="topbar" id="topbar"></header>\n  <nav class="rail" id="rail"></nav>\n'
        body += f'  <main class="main">\n{main}\n  </main>\n</div>\n'
    else:
        body += main + "\n"
    body += dialogs + "\n</div></div>\n" + SCRIPTS
    body += f"<script>\n  {st}\n  bootShell(); {init}\n</script>\n</body>\n</html>\n"
    (ROOT / f"{name}.html").write_text(HEAD.format(title=title) + body, encoding="utf-8")

OWNER_ONLY_STATE = """<div class="cashier-only state" style="margin:auto">
  <div class="state-ic"><i data-icon="lock" class="ic-lg"></i></div>
  <h3 data-ar="خاص بالمالك">Réservé au propriétaire</h3>
  <p data-ar="وضع البيع يعرض فقط البيع والزبائن. هذه الصفحة لا تظهر في قائمة أمين الصندوق.">Le mode caisse ne montre que Vente et Clients. Cette page n’apparaît pas dans le menu d’un caissier.</p>
  <a class="btn btn-primary" href="sell.html"><i data-icon="cart"></i><span data-ar="العودة إلى البيع">Retour à la vente</span></a>
</div>"""

STOCK_TABS = """<div class="page-head"><h1 class="page-title" data-ar="المخزون">Stock</h1><span class="grow"></span>{actions}</div>
<nav class="tabs">
  <a href="stock.html" class="{r}"><i data-icon="truck"></i><span data-ar="الاستلام">Réception</span></a>
  <a href="stock-history.html" class="{h}"><i data-icon="file"></i><span data-ar="المشتريات">Achats</span></a>
  <a href="#"><i data-icon="cart"></i><span data-ar="للطلب">À commander</span><span class="badge warn">5</span></a>
  <a href="#"><i data-icon="clipboard"></i><span data-ar="الجرد">Inventaire</span><span class="badge bad">1</span></a>
  <a href="#"><i data-icon="hourglass"></i><span data-ar="الصلاحية">Péremption</span><span class="badge warn">2</span></a>
</nav>"""

# ---------------------------------------------------------------- clients
page("clients", "Clients", "clients", """
<div class="md with-panel">
  <div class="md-list">
    <div class="page-head"><h1 class="page-title" data-ar="الزبائن">Clients</h1><span class="page-sub" data-ar="كارني الكريدي">Carnet de crédit</span><span class="grow"></span>
      <div class="kpi-inline"><span class="c-sub" data-ar="المجموع المستحق للمحل">Total dû au magasin</span><b id="owed-total"></b></div>
      <button class="btn btn-primary"><i data-icon="userplus"></i><span data-ar="زبون جديد">Nouveau client</span></button></div>
    <div style="display:flex;gap:10px;padding:0 24px 12px;align-items:center">
      <div class="field grow"><i data-icon="search"></i><span class="ph" data-ar="ابحث بالاسم أو الهاتف">Chercher un nom ou un téléphone</span></div>
      <div class="chips" data-chips="one"><button class="chip on" data-filter="owing"><span data-ar="مدينون">Doivent</span> <span class="n" id="c-count-owing"></span></button><button class="chip" data-filter="settled"><span data-ar="مسوّون">Soldés</span> <span class="n" id="c-count-settled"></span></button><button class="chip" data-filter="all"><span data-ar="الكل">Tous</span> <span class="n" id="c-count-all"></span></button></div>
    </div>
    <div class="scroll" style="flex:1;border-top:1px solid var(--divider)" id="c-list"></div>
  </div>
  <aside class="panel" id="c-panel"></aside>
</div>""", dialogs="""
<div class="dialog-wrap" id="dlg-cpay"><div class="dialog" style="width:760px;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px">
  <div style="display:flex;flex-direction:column;gap:12px">
    <h2><span class="d-icon ok"><i data-icon="banknote"></i></span><span><span data-ar="دفعة من">Paiement de</span> <span id="cpay-name"></span></span></h2>
    <div class="readout"><span class="big">200.00 DH</span></div>
    <div class="presets" style="flex-wrap:wrap"><button class="btn btn-secondary btn-sm" id="cpay-all"></button><button class="btn btn-secondary btn-sm">50</button><button class="btn btn-secondary btn-sm">100</button><button class="btn btn-secondary btn-sm">200</button></div>
    <div class="seg"><button class="on" data-ar="نقدًا">Espèces</button><button data-ar="بطاقة">Carte</button></div>
    <div class="readout" style="background:var(--surface);box-shadow:inset 0 0 0 1px var(--border)"><b style="font-size:var(--fs-body)" data-ar="الباقي بعد الدفع">Reste dû après paiement</b><span style="font-size:var(--fs-subtitle);font-weight:700" class="num">920.00 DH</span></div>
  </div>
  <div style="display:flex;flex-direction:column;gap:10px">
    <div class="keypad"><button class="key">7</button><button class="key">8</button><button class="key">9</button><button class="key">4</button><button class="key">5</button><button class="key">6</button><button class="key">1</button><button class="key">2</button><button class="key">3</button><button class="key fn">,</button><button class="key">0</button><button class="key fn"><i data-icon="backspace"></i></button></div>
    <button class="btn btn-pay btn-block" id="cpay-ok"><i data-icon="check"></i><span data-ar="تسجيل 200.00 DH">Encaisser 200.00 DH</span></button>
    <button class="btn btn-secondary btn-block" data-close data-ar="إلغاء">Annuler</button>
  </div>
</div></div>""", init="clientsScreen();", states=[("pay", "Encaisser un paiement"), ("none", "Sans panneau")])

# ---------------------------------------------------------------- products
page("products", "Produits", "products", f"""
{OWNER_ONLY_STATE}
<div class="md owner-only">
  <div class="md-list">
    <div class="page-head"><h1 class="page-title" data-ar="المنتجات">Produits</h1><span class="page-sub"><span id="p-count"></span> <span data-ar="منتج نشط">actifs</span></span><span class="grow"></span>
      <button class="btn btn-secondary" data-open="pop-pmore"><span data-ar="المزيد">Plus</span><i data-icon="down" class="ic-sm"></i></button>
      <button class="btn btn-primary"><i data-icon="plus"></i><span data-ar="منتج جديد">Nouveau produit</span></button></div>
    <div style="display:flex;gap:10px;padding:0 24px 10px;align-items:center">
      <div class="field grow"><i data-icon="search"></i><span class="ph" data-ar="الاسم أو الباركود أو «coca»">Nom, code-barres ou « كوكا »</span></div>
      <div class="seg" style="width:280px"><button class="on" data-ar="نشطة">Actifs</button><button data-ar="معطلة">Inactifs</button><button data-ar="الكل">Tous</button></div>
      <button class="chip"><i data-icon="alert" class="ic-sm"></i><span data-ar="مخزون منخفض">Stock bas</span></button>
    </div>
    <div class="chips" id="p-cats" style="padding:0 24px 12px" data-chips="one"></div>
    <div class="table-wrap"><table class="table"><thead><tr><th data-ar="المنتج">Produit</th><th class="hide-narrow" data-ar="الفئة">Catégorie</th><th class="num" data-ar="المخزون">Stock</th><th class="num owner-only" data-ar="متوسط التكلفة">Coût moyen</th><th class="num" data-ar="ثمن البيع">Prix de vente</th><th class="num owner-only" data-ar="الهامش">Marge</th><th></th></tr></thead><tbody id="p-rows"></tbody></table></div>
  </div>
  <aside class="panel" id="p-panel"></aside>
</div>
<div class="popover" id="pop-pmore" style="top:64px;inset-inline-end:200px;width:300px">
  <button class="pop-item"><i data-icon="upload"></i><span data-ar="استيراد CSV">Importer un fichier CSV</span></button>
  <button class="pop-item"><i data-icon="download"></i><span data-ar="تصدير CSV">Exporter en CSV</span></button>
  <button class="pop-item"><i data-icon="percent"></i><span data-ar="تغيير الأسعار دفعة واحدة">Changer les prix en masse</span></button>
  <button class="pop-item"><i data-icon="printer"></i><span data-ar="طباعة ملصقات الباركود">Imprimer des étiquettes</span></button>
</div>""", init="productsScreen();", states=[("panel", "Fiche produit ouverte")])

# ---------------------------------------------------------------- stock: receive
page("stock", "Stock · réception", "stock", f"""
{OWNER_ONLY_STATE}
<div class="owner-only" style="display:flex;flex-direction:column;flex:1;min-height:0">
{STOCK_TABS.format(r='on', h='', actions='<button class="btn btn-secondary btn-sm"><i data-icon="copy" class="ic-sm"></i><span data-ar="نسخ آخر تسليم">Reprendre la dernière livraison</span></button>')}
<div class="recv">
  <div class="recv-side">
    <div class="card">
      <span class="lbl" data-ar="المورد">Fournisseur</span>
      <div class="chips" style="flex-wrap:wrap" data-chips="one"><button class="chip on"><bdi>Laiterie Atlas</bdi></button><button class="chip"><bdi>Grossiste Derb Omar</bdi></button><button class="chip"><i data-icon="search" class="ic-sm"></i><span data-ar="مورد آخر…">Autre…</span></button></div>
    </div>
    <div class="card">
      <div class="form-row"><span class="lbl" data-ar="تاريخ التسليم">Date de livraison</span><div class="chips" data-chips="one"><button class="chip on" data-ar="اليوم">Aujourd’hui</button><button class="chip" data-ar="أمس">Hier</button><button class="chip"><i data-icon="calendar" class="ic-sm"></i><span data-ar="تاريخ آخر">Autre…</span></button></div></div>
      <div class="form-row"><span class="lbl" data-ar="رقم الفاتورة (اختياري)">N° de facture (facultatif)</span><div class="field"><span class="val num">LA-88305</span></div></div>
      <div class="photo-slot"><i data-icon="camera"></i><span data-ar="صورة الفاتورة">Photo de la facture</span></div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:14px"><span class="grow" style="font-weight:600" data-ar="مدفوعة عند التسليم">Payée à la livraison</span><span class="toggle on"></span></div>
    </div>
  </div>
  <div class="recv-lines">
    <div style="display:flex;align-items:center;padding:10px 16px;gap:12px;flex:none"><b style="font-size:var(--fs-subtitle)" data-ar="المنتجات المستلمة">Produits reçus</b><span class="muted"><span class="num">5</span> <span data-ar="أسطر">lignes</span></span><span class="grow"></span><span class="muted" style="font-size:var(--fs-caption)" data-ar="أدخل الكمية ومجموع السطر كما في الفاتورة">Saisissez la quantité et le total de la ligne comme sur la facture</span></div>
    <div class="scroll" style="flex:1"><table class="table"><thead><tr><th data-ar="المنتج">Produit</th><th data-ar="الكمية">Quantité</th><th data-ar="مجموع السطر">Total ligne</th><th data-ar="ثمن البيع">Prix de vente</th><th data-ar="الصلاحية">Péremption</th><th></th></tr></thead><tbody id="r-rows"></tbody></table></div>
    <div class="add-line"><div class="field"><i data-icon="scan"></i><span class="ph" data-ar="امسح أو ابحث لإضافة منتج">Scannez ou cherchez pour ajouter un produit</span></div><button class="btn btn-secondary"><i data-icon="plus"></i><span data-ar="إضافة">Ajouter</span></button></div>
  </div>
</div>
<div class="sticky-foot">
  <span class="status warn"><i data-icon="alert"></i><span data-ar="سطر واحد غير مكتمل لن يُحفظ">1 ligne incomplète, non enregistrée</span></span>
  <span class="muted" style="font-size:var(--fs-caption)"><span data-ar="المسودة محفوظة في الجهاز">Brouillon gardé sur l’appareil</span> · <span class="num">14:30</span></span>
  <span class="grow"></span>
  <span class="muted" style="font-weight:600" data-ar="مجموع الفاتورة">Total facture</span><b class="total" style="font-size:var(--fs-kpi)">647.40 DH</b>
  <button class="btn btn-primary"><i data-icon="check"></i><span data-ar="حفظ 4 أسطر">Enregistrer 4 lignes</span></button>
</div>
</div>""", init="receiveScreen();")

# ---------------------------------------------------------------- stock: purchases
page("stock-history", "Stock · achats", "stock", f"""
{OWNER_ONLY_STATE}
<div class="owner-only" style="display:flex;flex-direction:column;flex:1;min-height:0">
{STOCK_TABS.format(r='', h='on', actions='')}
<div class="md with-panel" style="flex:1;min-height:0">
  <div class="md-list">
    <div style="display:flex;gap:10px;padding:12px 24px 10px;align-items:center">
      <div class="seg" style="width:390px"><button class="on" data-ar="التسليمات">Livraisons</button><button data-ar="الموردون">Fournisseurs</button><button data-ar="حسب الشهر">Par mois</button></div>
      <span class="grow"></span><button class="btn btn-secondary btn-sm"><i data-icon="download" class="ic-sm"></i><span data-ar="تصدير">Exporter</span></button>
    </div>
    <div class="chips" style="padding:0 24px 12px"><button class="chip on" data-ar="أكتوبر">Octobre</button><button class="chip" data-ar="شتنبر">Septembre</button><button class="chip"><i data-icon="calendar" class="ic-sm"></i><span data-ar="فترة أخرى">Autre…</span></button><button class="chip"><span data-ar="كل الموردين">Tous les fournisseurs</span><i data-icon="down" class="ic-sm"></i></button><button class="chip"><span data-ar="غير مدفوعة">Impayées</span> <span class="n">2</span></button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th data-ar="التاريخ">Date</th><th data-ar="المورد">Fournisseur</th><th data-ar="الفاتورة">Facture</th><th class="num" data-ar="أسطر">Lignes</th><th class="num" data-ar="المجموع">Total</th><th data-ar="الحالة">Statut</th><th></th></tr></thead><tbody id="h-rows"></tbody></table></div>
    <div class="table-foot" id="h-foot"></div>
  </div>
  <aside class="panel" id="d-panel"></aside>
</div>
</div>""", dialogs="""
<div class="dialog-wrap" id="dlg-dvoid" data-modal="1"><div class="dialog" style="width:580px" role="alertdialog">
  <h2><span class="d-icon bad"><i data-icon="undo"></i></span><span data-ar="إلغاء التسليم BA-2026-1187؟">Annuler la livraison BA-2026-1187 ?</span></h2>
  <p><bdi>Boissons Atlantique</bdi> · <span data-ar="30 أكتوبر">30 oct.</span> · <span class="money">2 460.00 DH</span></p>
  <div class="consequence">
    <div class="cr" style="grid-template-columns:minmax(0,1fr) 90px 20px 110px"><b data-ar="المنتج">Produit</b><b class="muted" style="text-align:end" data-ar="الآن">Maintenant</b><span></span><b style="text-align:end" data-ar="بعد الإلغاء">Après</b></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) 90px 20px 110px"><span><bdi>Coca-Cola 33cl</bdi><div class="c-sub" data-ar="متوسط التكلفة">coût moyen</div></span><span class="num" style="text-align:end">57<div class="c-sub">5.24</div></span><i data-icon="chevron" class="ic-sm arrow"></i><b class="num" style="text-align:end">9<div class="c-sub">5.45</div></b></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) 90px 20px 110px"><span><bdi>Coca-Cola 1.5L</bdi><div class="c-sub" data-ar="متوسط التكلفة">coût moyen</div></span><span class="num" style="text-align:end">14<div class="c-sub">11.40</div></span><i data-icon="chevron" class="ic-sm arrow"></i><b class="num down" style="text-align:end">−10<div class="c-sub" style="color:var(--ink-600)">11.20</div></b></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span class="muted" data-ar="+ 3 منتجات أخرى">+ 3 autres produits</span><span></span></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) 90px 20px 110px"><span data-ar="الباقي للمورد">Reste dû au fournisseur</span><span class="money" style="text-align:end">960.00</span><i data-icon="chevron" class="ic-sm arrow"></i><b class="money" style="text-align:end">0.00 DH</b></div>
  </div>
  <p class="help" data-ar="المبيعات السابقة تحتفظ بتكلفتها. المخزون السالب يظهر في الجرد حتى إعادة الإدخال.">Les ventes passées gardent leur coût. Le stock négatif apparaît dans Inventaire jusqu’à la nouvelle saisie.</p>
  <div style="margin-top:14px"><span class="lbl" data-ar="السبب (إلزامي)">Raison (obligatoire)</span><div class="chips" data-chips="one"><button class="chip on" data-ar="خطأ في الإدخال">Erreur de saisie</button><button class="chip" data-ar="تسليم مرفوض">Livraison refusée</button><button class="chip" data-ar="سبب آخر">Autre…</button></div></div>
  <div style="display:flex;align-items:center;gap:12px;margin-top:14px"><span class="toggle on"></span><span data-ar="نسخها كتسليم جديد بعد الإلغاء">La dupliquer en nouvelle livraison après l’annulation</span></div>
  <div class="actions"><button class="btn btn-secondary" data-close data-ar="الاحتفاظ بالتسليم">Garder la livraison</button><button class="btn btn-danger" data-close data-ar="إلغاء التسليم">Annuler la livraison</button></div>
</div></div>""", init="purchasesScreen();", states=[("none", "Sans panneau"), ("void", "Confirmer l’annulation")])

# ---------------------------------------------------------------- reports
page("reports", "Rapports", "reports", f"""
{OWNER_ONLY_STATE}
<div class="owner-only" style="display:flex;flex-direction:column;flex:1;min-height:0">
<div class="page-head"><h1 class="page-title" data-ar="التقارير">Rapports</h1>
  <div class="chips" data-chips="one" style="margin-inline-start:12px"><button class="chip on" data-ar="اليوم">Aujourd’hui</button><button class="chip" data-ar="أمس">Hier</button><button class="chip" data-ar="7 أيام">7 jours</button><button class="chip" data-ar="هذا الشهر">Ce mois</button><button class="chip"><i data-icon="calendar" class="ic-sm"></i><span data-ar="فترة أخرى">Autre…</span></button></div>
  <span class="grow"></span><button class="btn btn-secondary btn-sm"><i data-icon="download" class="ic-sm"></i><span data-ar="تصدير">Exporter</span></button><button class="btn btn-primary btn-sm" data-open="dlg-close"><i data-icon="receipt" class="ic-sm"></i><span data-ar="إغلاق اليوم">Clôture du jour</span></button></div>
<div class="rep">
  <div class="card kpi hero" id="k-profit"></div>
  <div class="card kpi" id="k-rev"></div>
  <div class="card kpi" id="k-tix"></div>
  <div class="card kpi" id="k-margin"></div>
  <div class="card span-8"><div style="display:flex;align-items:center;gap:12px"><div class="card-title" style="margin:0" data-ar="آخر 7 أيام">7 derniers jours</div><span class="grow"></span><div class="legend"><span><i style="background:var(--brand-100)"></i><span data-ar="رقم المعاملات">Chiffre d’affaires</span></span><span><i style="background:var(--brand-700)"></i><span data-ar="الربح">Bénéfice</span></span><span><i style="background:var(--success-600)"></i><span data-ar="اليوم">Aujourd’hui</span></span></div></div><div class="bars" id="bars"></div></div>
  <div class="card span-4"><div class="card-title"><i data-icon="alert" class="ic-sm"></i><span data-ar="للقيام به">À faire</span></div><div class="todo">
    <a href="stock.html"><span class="t-ic" style="background:var(--warning-100);color:var(--warning-700)"><i data-icon="cart" class="ic-sm"></i></span><span class="grow"><b class="num">5</b> <span data-ar="منتجات للطلب">produits à commander</span></span><i data-icon="chevron" class="ic-sm"></i></a>
    <a href="stock.html"><span class="t-ic" style="background:var(--warning-100);color:var(--warning-700)"><i data-icon="hourglass" class="ic-sm"></i></span><span class="grow"><b class="num">2</b> <span data-ar="دفعات تنتهي خلال 7 أيام">lots expirent sous 7 jours</span></span><i data-icon="chevron" class="ic-sm"></i></a>
    <a href="stock.html"><span class="t-ic" style="background:var(--danger-100);color:var(--danger-700)"><i data-icon="alert" class="ic-sm"></i></span><span class="grow"><bdi>Huile de table 1L</bdi> <span data-ar="مخزون سالب">en stock négatif</span> <b class="num">(−2)</b></span><i data-icon="chevron" class="ic-sm"></i></a>
    <a href="settings.html?pane=backup"><span class="t-ic" style="background:var(--brand-100);color:var(--brand-700)"><i data-icon="shield" class="ic-sm"></i></span><span class="grow" data-ar="آخر نسخة احتياطية منذ 3 أيام">Dernière sauvegarde il y a 3 jours</span><i data-icon="chevron" class="ic-sm"></i></a>
  </div></div>
  <div class="card span-5"><div class="card-title" data-ar="أفضل الأرباح">Meilleurs bénéfices</div><table class="table" style="margin-inline:-16px;width:calc(100% + 32px)"><tbody id="top"></tbody></table></div>
  <div class="card span-4"><div class="card-title" data-ar="حسب الفئة (حصة من رقم المعاملات)">Par catégorie (part du CA)</div><div id="cats"></div></div>
  <div class="card span-3"><div class="card-title" data-ar="حسب الساعة">Par heure</div><div class="mini-hours" id="hours"></div><div class="c-sub" style="margin-top:8px"><span data-ar="الذروة">Pic</span> <span class="num">19:00–20:00</span></div><div class="c-sub"><span data-ar="متفرقات (تقديري):">Divers (estimé) :</span> <span class="num">9</span> · <span class="money">86.00 DH</span></div></div>
</div>
</div>""", dialogs="""
<div class="dialog-wrap" id="dlg-close"><div class="dialog" style="width:640px">
  <h2><span class="d-icon info"><i data-icon="receipt"></i></span><span data-ar="إغلاق يوم الأحد 1 نونبر">Clôture du dimanche 1 novembre</span></h2>
  <p class="muted" data-ar="من 08:00 إلى الآن · 187 تذكرة">De 08:00 à maintenant · 187 tickets</p>
  <div class="consequence" style="margin-top:14px">
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span><i data-icon="banknote" class="ic-sm"></i> <span data-ar="مبيعات نقدًا">Ventes en espèces</span></span><b class="money">2 640.00 DH</b></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span><i data-icon="book" class="ic-sm"></i> <span data-ar="دفعات الكريدي نقدًا">Remboursements de crédit (espèces)</span></span><b class="money up">+200.00 DH</b></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span><i data-icon="undo" class="ic-sm"></i> <span data-ar="إلغاءات (1)">Annulations (1)</span></span><b class="money down">−2.40 DH</b></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto;min-height:52px"><b data-ar="النقود المتوقعة في الصندوق">Espèces attendues dans la caisse</b><b class="money" style="font-size:var(--fs-subtitle)">2 837.60 DH</b></div>
  </div>
  <div class="consequence">
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span data-ar="بطاقة">Carte</span><span class="money">412.50 DH</span></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span data-ar="كريدي جديد">Nouveau crédit accordé</span><span class="money">430.00 DH</span></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span data-ar="سلمى · 68 تذكرة">Salma · 68 tickets</span><span class="money">1 284.50 DH</span></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span data-ar="يوسف · 94 تذكرة">Youssef · 94 tickets</span><span class="money">1 790.00 DH</span></div>
    <div class="cr" style="grid-template-columns:minmax(0,1fr) auto"><span data-ar="مُعاذ · 25 تذكرة">Mouad · 25 tickets</span><span class="money">408.00 DH</span></div>
  </div>
  <div class="actions"><button class="btn btn-secondary" data-close data-ar="إغلاق">Fermer</button><button class="btn btn-secondary"><i data-icon="message"></i>WhatsApp</button><button class="btn btn-primary"><i data-icon="printer"></i><span data-ar="طباعة">Imprimer</span></button></div>
</div></div>""", init="reportsScreen(); if (Q.get('open')==='close') openLayer('dlg-close');", states=[("close", "Clôture du jour")])

# ---------------------------------------------------------------- settings
def nav(tab, ic, fr, ar, owner=True):
    cls = ' class="owner-only"' if owner else ''
    return f'<button data-tab="{tab}"{cls}><i data-icon="{ic}"></i><span data-ar="{ar}">{fr}</span></button>'

page("settings", "Réglages", "settings", f"""
<div class="page-head"><h1 class="page-title" data-ar="الإعدادات">Réglages</h1></div>
<div class="settings" style="border-top:1px solid var(--divider)">
  <nav class="set-nav" data-tabs="set-panes">
    <div class="sec owner-only" data-ar="المحل">MAGASIN</div>
    {nav('store','store','Magasin','المحل')}
    {nav('team','users','Équipe et codes PIN','الفريق والرموز السرية')}
    {nav('sales','cart','Vente et Divers','البيع والمتفرقات')}
    {nav('receipts','receipt','Tickets et WhatsApp','التذاكر وواتساب')}
    <div class="sec" data-ar="هذا الجهاز">CET APPAREIL</div>
    {nav('device','monitor','Écran, scanner, imprimante','الشاشة والماسح والطابعة')}
    {nav('lang','languages','Langue','اللغة', owner=False)}
    <div class="sec owner-only" data-ar="البيانات">DONNÉES</div>
    {nav('backup','shield','Sauvegarde et export','النسخ الاحتياطي والتصدير')}
    {nav('account','user','Mon compte','حسابي', owner=False)}
  </nav>
  <div id="set-panes" style="min-height:0;display:flex;flex-direction:column">
    <section class="set-pane" data-pane="team">
      <div style="display:flex;align-items:center;gap:12px"><h2 style="font-size:var(--fs-subtitle)" class="grow" data-ar="الفريق">Équipe</h2><button class="btn btn-primary"><i data-icon="userplus"></i><span data-ar="دعوة أمين صندوق">Inviter un caissier</span></button></div>
      <div class="card" style="padding:0 16px">
        <div class="set-row"><span class="avatar brand" style="width:44px;height:44px">M</span><div class="r-main"><b data-ar="مُعاذ">Mouad</b><div class="c-sub" data-ar="المالك · رمز من 6 أرقام · هذا الجهاز">Propriétaire · PIN à 6 chiffres · cet appareil</div></div><button class="btn btn-secondary btn-sm" data-ar="تغيير الرمز">Changer le PIN</button></div>
        <div class="set-row"><span class="avatar purple" style="width:44px;height:44px">S</span><div class="r-main"><b data-ar="سلمى">Salma</b><div class="c-sub" data-ar="أمينة صندوق · نشطة منذ 08:02">Caissière · active depuis 08:02</div></div><span class="status ok"><i data-icon="check"></i><span data-ar="الرمز محدد">PIN défini</span></span><button class="btn btn-secondary btn-sm" data-ar="تغيير الرمز">Changer le PIN</button></div>
        <div class="set-row"><span class="avatar teal" style="width:44px;height:44px">Y</span><div class="r-main"><b data-ar="يوسف">Youssef</b><div class="c-sub" data-ar="أمين صندوق · آخر نشاط أمس 21:40">Caissier · vu hier 21:40</div></div><span class="status ok"><i data-icon="check"></i><span data-ar="الرمز محدد">PIN défini</span></span><button class="btn btn-secondary btn-sm" data-ar="تغيير الرمز">Changer le PIN</button></div>
      </div>
      <h2 style="font-size:var(--fs-subtitle);margin-top:8px" data-ar="القفل والتبديل">Verrouillage et changement de caissier</h2>
      <div class="card" style="padding:0 16px">
        <div class="set-row"><div class="r-main"><b data-ar="قفل تلقائي بعد عدم النشاط">Verrouiller après inactivité</b><div class="c-sub" data-ar="السلة الجارية تبقى محفوظة">Le panier en cours est gardé</div></div><div class="chips" data-chips="one"><button class="chip">1 min</button><button class="chip on">3 min</button><button class="chip">10 min</button><button class="chip" data-ar="أبدًا">Jamais</button></div></div>
        <div class="set-row"><div class="r-main"><b data-ar="طلب رمز المالك لـ">Demander le PIN du propriétaire pour</b><div class="c-sub" data-ar="إلغاء بيع · خصم فوق 10% · فتح الدرج بدون بيع">annuler une vente · remise de plus de 10 % · tiroir sans vente</div></div><span class="toggle on"></span></div>
      </div>
    </section>
    <section class="set-pane" data-pane="device">
      <h2 style="font-size:var(--fs-subtitle)" data-ar="هذا الجهاز: الصندوق 1 (حاسوب لمسي)">Cet appareil : Caisse 1 (PC tactile)</h2>
      <div class="card" style="padding:0 16px">
        <div class="set-row"><i data-icon="keyboard"></i><div class="r-main"><b data-ar="لوحة مفاتيح مدمجة (لمس فقط)">Clavier intégré (tactile seulement)</b><div class="c-sub" data-ar="مكتشف تلقائيًا: لا توجد لوحة مفاتيح">Détecté automatiquement : aucun clavier branché</div></div><span class="toggle on"></span></div>
        <div class="set-row"><i data-icon="grid"></i><div class="r-main"><b data-ar="حجم المربعات">Taille des tuiles</b></div><div class="seg" style="width:200px"><button>S</button><button class="on">M</button><button>L</button></div></div>
        <div class="set-row"><i data-icon="scan"></i><div class="r-main"><b data-ar="ماسح USB">Scanner USB</b><div class="c-sub" data-ar="جاهز · آخر مسح 14:31 · يستمع في كل الشاشات">Prêt · dernier scan 14:31 · écoute sur tous les écrans</div></div><button class="btn btn-secondary btn-sm" data-ar="اختبار">Tester</button></div>
        <div class="set-row"><i data-icon="printer"></i><div class="r-main"><b data-ar="طابعة التذاكر">Imprimante de tickets</b><div class="c-sub" data-ar="لا شيء · USB 80 مم عبر المتصفح (لاحقًا)">Aucune · USB 80 mm via le navigateur (plus tard)</div></div><button class="btn btn-secondary btn-sm" data-ar="إضافة">Ajouter</button></div>
        <div class="set-row"><i data-icon="monitor"></i><div class="r-main"><b data-ar="ملء الشاشة">Plein écran (kiosque)</b><div class="c-sub" data-ar="مثبت كتطبيق · يفتح على البيع">Installée comme application · s’ouvre sur Vente</div></div><span class="status ok"><i data-icon="check"></i>OK</span></div>
        <div class="set-row"><i data-icon="sun"></i><div class="r-main"><b data-ar="المظهر">Thème</b><div class="c-sub" data-ar="فاتح. الوضع الليلي ليس مخططًا قبل الإطلاق.">Clair. Le mode soir n’est pas prévu avant le lancement.</div></div></div>
      </div>
    </section>
    <section class="set-pane" data-pane="sales">
      <h2 style="font-size:var(--fs-subtitle)" data-ar="البيع والمتفرقات">Vente et Divers</h2>
      <div class="card" style="padding:0 16px">
        <div class="set-row"><div class="r-main"><b data-ar="الحد الأقصى لسطر متفرقات">Montant maximum d’une ligne Divers</b></div><span class="cell-input" style="min-width:120px">200.00 DH</span></div>
        <div class="set-row"><div class="r-main"><b data-ar="الهامش التقديري للمتفرقات">Marge estimée des Divers</b><div class="c-sub" data-ar="يستعمل لتقدير التكلفة في التقارير. لا يراه أمين الصندوق.">Sert à estimer le coût dans les rapports. Jamais visible par un caissier.</div></div><span class="cell-input">20 %</span></div>
        <div class="set-row"><div class="r-main"><b data-ar="أزرار الأوراق النقدية السريعة">Billets rapides au paiement</b></div><span class="num muted">50 · 100 · 200</span></div>
      </div>
    </section>
    <section class="set-pane" data-pane="store"><h2 style="font-size:var(--fs-subtitle)" data-ar="المحل">Magasin</h2><div class="card"><div class="form-row"><span class="lbl" data-ar="الاسم">Nom</span><div class="field"><span class="val">Corniche Market</span></div></div><div class="form-row"><span class="lbl" data-ar="العنوان (يظهر في التذاكر)">Adresse (sur les tickets)</span><div class="field"><span class="val">Bd de la Corniche, Aïn Diab</span></div></div><div class="form-2"><div><span class="lbl" data-ar="هاتف واتساب">Téléphone WhatsApp</span><div class="field"><span class="val num">0661 00 00 00</span></div></div><div><span class="lbl" data-ar="المنطقة الزمنية">Fuseau horaire</span><div class="field"><span class="val">Africa/Casablanca</span></div></div></div></div></section>
    <section class="set-pane" data-pane="receipts"><h2 style="font-size:var(--fs-subtitle)" data-ar="التذاكر وواتساب">Tickets et WhatsApp</h2><div class="card"><div class="lbl" data-ar="معاينة الرسالة">Aperçu du message</div><pre style="font-family:var(--font);background:var(--sunken);border-radius:var(--r-control);padding:14px;margin:0;white-space:pre-wrap">Corniche Market · 01/11 14:32
Ticket #0188
4 × Pain rond ........ 4.80
1 × Lait Centrale 1L . 7.00
0.750 kg Tomates ..... 6.75
2 × Coca-Cola 33cl .. 14.00
TOTAL ............... 32.55 DH
Merci ! شكرا</pre></div></section>
    <section class="set-pane" data-pane="backup"><h2 style="font-size:var(--fs-subtitle)" data-ar="النسخ الاحتياطي والتصدير">Sauvegarde et export</h2><div class="banner warn"><i data-icon="alert"></i><span data-ar="آخر نسخة احتياطية منذ 3 أيام">Dernière sauvegarde il y a 3 jours</span><button class="btn btn-primary btn-sm"><i data-icon="download" class="ic-sm"></i><span data-ar="تصدير الكل">Tout exporter</span></button></div></section>
    <section class="set-pane" data-pane="lang"><h2 style="font-size:var(--fs-subtitle)" data-ar="لغة هذا الجهاز">Langue de cet appareil</h2><div class="card"><div class="chips"><a class="chip" href="settings.html?pane=lang&amp;lang=fr" data-raw="1">Français</a><a class="chip" href="settings.html?pane=lang&amp;lang=ar" data-raw="1">العربية</a><span class="chip">English</span></div><p class="help" data-ar="يطبق فورًا، بدون إعادة تشغيل. الاتجاه من اليمين إلى اليسار للعربية.">Appliquée tout de suite, sans redémarrage. Droite à gauche pour l’arabe.</p></div></section>
    <section class="set-pane" data-pane="account"><h2 style="font-size:var(--fs-subtitle)" data-ar="حسابي">Mon compte</h2><div class="card" style="padding:0 16px"><div class="set-row"><div class="r-main"><b>owner@corniche.ma</b><div class="c-sub" data-ar="البريد الإلكتروني للدخول">E-mail de connexion</div></div></div><div class="set-row owner-only"><div class="r-main"><b data-ar="تسجيل خروج هذا الجهاز">Déconnecter cet appareil</b><div class="c-sub" data-ar="سيطلب كلمة سر المالك لإعادة تفعيله">Le mot de passe du propriétaire sera demandé pour le réactiver</div></div><button class="btn btn-danger-soft btn-sm" data-ar="تسجيل الخروج">Déconnecter</button></div></div></section>
  </div>
</div>""", init="settingsScreen();", states=[])

# ---------------------------------------------------------------- lock
page("lock", "Verrouillage", "lock", """
<div class="lock">
  <div class="lock-body">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px" id="lock-brand"></div>
    <div class="big-clock">14:32</div>
    <div class="date" data-ar="الأحد 1 نونبر">dimanche 1 novembre</div>
    <div class="held"><i data-icon="cart" class="ic-sm"></i><span data-ar="السلة الجارية محفوظة: 4 منتجات · 32.55 DH">Panier en cours gardé : 4 articles · 32.55 DH</span></div>
    <p id="who-hint" style="margin-top:28px;font-size:var(--fs-subtitle);font-weight:600" data-ar="من يبيع؟">Qui encaisse ?</p>
    <div class="who-grid">
      <button class="who-card" data-who="salma"><span class="avatar purple">S</span><span data-ar="سلمى">Salma</span><small data-ar="أمينة صندوق">Caissière</small></button>
      <button class="who-card" data-who="youssef"><span class="avatar teal">Y</span><span data-ar="يوسف">Youssef</span><small data-ar="أمين صندوق">Caissier</small></button>
      <button class="who-card" data-who="mouad"><span class="avatar brand">M</span><span data-ar="مُعاذ">Mouad</span><small data-ar="المالك">Propriétaire</small></button>
    </div>
    <div class="pin-box" id="pin">
      <div style="font-size:var(--fs-subtitle);font-weight:600"><span data-ar="الرمز السري لـ">Code PIN de</span> <span id="pin-name"></span></div>
      <div class="pin-dots" id="pin-dots"></div>
      <div class="keypad"><button class="key" data-k="1">1</button><button class="key" data-k="2">2</button><button class="key" data-k="3">3</button><button class="key" data-k="4">4</button><button class="key" data-k="5">5</button><button class="key" data-k="6">6</button><button class="key" data-k="7">7</button><button class="key" data-k="8">8</button><button class="key" data-k="9">9</button><span></span><button class="key" data-k="0">0</button><button class="key fn" data-k="del"><i data-icon="backspace"></i></button></div>
    </div>
  </div>
</div>""", shell=False, init="document.getElementById('lock-brand').innerHTML = brandMark(44) + '<b style=\"font-size:22px\">Corniche Market</b>'; lockScreen();", states=[("pin", "Saisie du PIN"), ("who", "Choisir le caissier")])
print("pages written")

# ---------------------------------------------------------------- index (launcher + gallery)
SCREENS = [
    ("sell.html", "Vente · laptop 1366×768", "Grille + panier toujours visible, pavés, paiement, tickets, clavier intégré.",
     [("pay", "Paiement"), ("weight", "Pavé poids"), ("kbd", "Clavier intégré"), ("void", "Annuler une vente"), ("sold", "Après la vente")]),
    ("sell-tablet.html", "Vente · tablette Android 1280×800", "Caméra en panneau au-dessus du panier (décision 16 de la grille).", [("weight", "Pavé poids")]),
    ("clients.html", "Clients / crédit", "Le carnet : soldes, historique, encaisser un paiement, relance WhatsApp.", [("pay", "Encaisser un paiement")]),
    ("products.html", "Produits (propriétaire)", "Catalogue en tableau, fiche en panneau latéral.", [("panel", "Fiche ouverte")]),
    ("stock.html", "Stock · réception (propriétaire)", "Saisie d’une livraison : fournisseur, date, facture, lignes, total.", []),
    ("stock-history.html", "Stock · achats (propriétaire)", "Historique des livraisons + détail en panneau + annulation.", [("void", "Annuler la livraison")]),
    ("reports.html", "Rapports (propriétaire)", "Accueil du propriétaire : bénéfice d’abord, « À faire », clôture du jour.", [("close", "Clôture du jour")]),
    ("settings.html", "Réglages", "Équipe et PIN, appareil, ventes et Divers, langue, sauvegarde.", []),
    ("lock.html", "Verrouillage / changement de caissier", "Écran de veille, choix du caissier, PIN.", [("pin", "PIN")]),
]

def links(f, states):
    out = []
    for lang, ln in (("fr", "FR"), ("ar", "AR")):
        for role, rn in (("owner", "propriétaire"), ("cashier", "caissière")):
            if f == "lock.html" and role == "cashier":
                continue
            out.append(f'<a href="{f}?lang={lang}&amp;role={role}">{ln} · {rn}</a>')
    for k, v in states:
        out.append(f'<a href="{f}?lang=fr&amp;role=owner&amp;open={k}" style="background:var(--sunken);color:var(--ink-700)">{v}</a>')
    return "".join(out)

cards = "".join(f'<div class="card"><h3>{t}</h3><p style="margin:0 0 10px;font-size:15px">{d}</p><div class="links">{links(f, st)}</div></div>' for f, t, d, st in SCREENS)
shots = sorted(p.name for p in (ROOT / "screenshots").glob("*.jpg"))
gallery = "".join(f'<figure><a href="screenshots/{n}" data-raw="1"><img loading="lazy" src="screenshots/{n}" alt="{n[3:-4]}"></a><figcaption>{n[:-4]}</figcaption></figure>' for n in shots)
(ROOT / "index.html").write_text(HEAD.format(title="Prototype") + f"""<body class="launch-body" data-page="index">
<div class="launch">
  <h1><span id="mark"></span>Corniche Market · prototype thème et structure</h1>
  <p>Prototype statique (HTML, CSS, un peu de JavaScript, aucun serveur) qui accompagne <a href="../THEME-STRUCTURE.md">docs/THEME-STRUCTURE.md</a>. Ouvrez un écran : la barre noire en haut (hors de l’appareil) change la langue, le rôle, l’état du réseau et l’état de l’écran. Tout se fait au toucher : tuiles, pavés, panneaux et dialogues sont cliquables. Les données sont fictives.</p>
  <p>Tailles : laptop tactile 1366×768 (référence), 1920×1080 à 125 % = 1536×864 (<code>device=laptop-lg</code>) ou à 150 % = 1280×720 (<code>device=laptop-sm</code>), tablette 1280×800. Ajoutez <code>&amp;shot</code> à l’URL pour masquer la barre du prototype (captures).</p>
  <h2>Écrans</h2>
  <div class="grid">{cards}</div>
  <h2>Captures ({len(shots)})</h2>
  <p>Régénérer : <code>tools/shoot_all.sh</code> (Chrome headless de Playwright, polices Google en ligne).</p>
  <div class="shots">{gallery}</div>
</div>
<script src="assets/icons.js"></script>
<script>document.getElementById('mark').innerHTML = brandMark(44);</script>
</body>
</html>
""", encoding="utf-8")
print("index written")
