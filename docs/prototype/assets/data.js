/* Sample data for the prototype. Product, category, customer and supplier
   names are store data: they are shown as the owner typed them, whatever
   the UI language (a few are typed in Arabic on purpose, to show mixed
   right-to-left/left-to-right rows). Money is integer centimes, as in the app. */

const CATEGORIES = [
  { id: 'fav', fr: 'Favoris', ar: 'المفضلة', star: true },
  { id: 'drinks', fr: 'Boissons', ar: 'مشروبات' },
  { id: 'bakery', fr: 'Boulangerie', ar: 'مخبزة' },
  { id: 'dairy', fr: 'Laitier', ar: 'ألبان' },
  { id: 'grocery', fr: 'Épicerie', ar: 'بقالة' },
  { id: 'produce', fr: 'Fruits & légumes', ar: 'خضر وفواكه' },
  { id: 'hygiene', fr: 'Hygiène', ar: 'نظافة' },
  { id: 'snacks', fr: 'Snacks', ar: 'وجبات خفيفة' },
];

// stock: units or kg on hand; low: low-stock threshold; cost: average cost (owner only)
const PRODUCTS = [
  { id: 'divers', name: 'Divers', misc: true, color: 'grey' },
  { id: 'pain', name: 'Pain rond', cat: 'bakery', price: 120, cost: 85, stock: 24, low: 10, color: 'amber', bc: '' },
  { id: 'baguette', name: 'Baguette', cat: 'bakery', price: 150, cost: 80, stock: 36, low: 10, color: 'amber', bc: '6111000000027' },
  { id: 'harcha', name: 'حرشة', cat: 'bakery', price: 200, cost: 120, stock: 15, low: 5, color: 'amber', bc: '' },
  { id: 'msemen', name: 'Msemen', cat: 'bakery', price: 250, cost: 150, stock: 0, low: 5, color: 'amber', bc: '' },
  { id: 'lait', name: 'Lait Centrale 1L', cat: 'dairy', price: 700, cost: 610, stock: 18, low: 12, color: 'blue', bc: '6111245520015' },
  { id: 'yaourt', name: 'Yaourt nature', cat: 'dairy', price: 250, cost: 190, stock: 40, low: 12, color: 'blue', bc: '6111245520107' },
  { id: 'jben', name: 'Jben frais', cat: 'dairy', price: 600, cost: 420, stock: 6, low: 6, color: 'blue', bc: '' },
  { id: 'raibi', name: 'Raïbi Jamila', cat: 'dairy', price: 250, cost: 195, stock: 30, low: 12, color: 'blue', bc: '6111245521012' },
  { id: 'coca33', name: 'Coca-Cola 33cl', cat: 'drinks', price: 700, cost: 520, stock: 9, low: 12, color: 'red', bc: '5449000000996' },
  { id: 'coca15', name: 'Coca-Cola 1.5L', cat: 'drinks', price: 1500, cost: 1150, stock: 14, low: 6, color: 'red', bc: '5449000054227' },
  { id: 'eau', name: 'Eau Sidi Ali 1.5L', cat: 'drinks', price: 600, cost: 430, stock: 48, low: 24, color: 'teal', bc: '6111252421018' },
  { id: 'hawai', name: 'Hawaï tropical 1L', cat: 'drinks', price: 1200, cost: 900, stock: 7, low: 4, color: 'purple', bc: '6111069000417' },
  { id: 'the', name: 'Thé Sultan 200g', cat: 'grocery', price: 1650, cost: 1320, stock: 11, low: 6, color: 'green', bc: '6111162000135' },
  { id: 'sucre', name: 'Sucre morceaux 1kg', cat: 'grocery', price: 950, cost: 820, stock: 20, low: 8, color: 'grey', bc: '6111035000014' },
  { id: 'huile', name: 'Huile de table 1L', cat: 'grocery', price: 2100, cost: 1780, stock: -2, low: 6, color: 'amber', bc: '6111128000213' },
  { id: 'pates', name: 'Pâtes 500g', cat: 'grocery', price: 650, cost: 480, stock: 26, low: 10, color: 'amber', bc: '6111099001214' },
  { id: 'sardines', name: 'Sardines à l’huile', cat: 'grocery', price: 600, cost: 430, stock: 31, low: 10, color: 'teal', bc: '6111041000318' },
  { id: 'oeufs', name: 'Œufs (pièce)', cat: 'grocery', price: 130, cost: 100, stock: 120, low: 30, color: 'amber', bc: '' },
  { id: 'tomates', name: 'Tomates', cat: 'produce', price: 900, cost: 600, stock: 12.4, low: 5, kg: true, color: 'red', bc: '' },
  { id: 'bananes', name: 'Bananes', cat: 'produce', price: 1200, cost: 850, stock: 9.9, low: 5, kg: true, color: 'amber', bc: '' },
  { id: 'oignons', name: 'Oignons', cat: 'produce', price: 600, cost: 380, stock: 18, low: 5, kg: true, color: 'purple', bc: '' },
  { id: 'menthe', name: 'نعناع (ربطة)', cat: 'produce', price: 200, cost: 100, stock: 22, low: 8, color: 'green', bc: '' },
  { id: 'savon', name: 'Savon Dove', cat: 'hygiene', price: 1100, cost: 820, stock: 8, low: 4, color: 'indigo', bc: '8711600000000' },
  { id: 'dentifrice', name: 'Dentifrice Signal', cat: 'hygiene', price: 1800, cost: 1350, stock: 5, low: 4, color: 'indigo', bc: '8714100000000' },
  { id: 'chips', name: 'Chips sel 45g', cat: 'snacks', price: 500, cost: 360, stock: 33, low: 12, color: 'amber', bc: '6111250000012' },
  { id: 'gaufrette', name: 'Gaufrette chocolat', cat: 'snacks', price: 200, cost: 140, stock: 60, low: 20, color: 'purple', bc: '6111250000210' },
  { id: 'biscuit', name: 'Biscuits 1 DH', cat: 'snacks', price: 100, cost: 70, stock: 140, low: 40, color: 'amber', bc: '6111250000418' },
  { id: 'recharge', name: 'Recharge 20 DH', cat: 'grocery', price: 2000, cost: 1900, stock: 50, low: 10, color: 'teal', bc: '' },
];

// Favoris: hand-picked by the owner, in the owner's order (grid decision 1).
const FAVORITES = ['pain', 'baguette', 'lait', 'coca33', 'eau', 'oeufs', 'tomates', 'bananes', 'menthe', 'the', 'sucre', 'yaourt', 'raibi', 'harcha', 'chips', 'recharge', 'sardines', 'jben', 'coca15', 'huile', 'pates', 'biscuit', 'oignons'];

const START_CART = [
  { id: 'pain', qty: 4 },
  { id: 'lait', qty: 1 },
  { id: 'tomates', qty: 0.75 },
  { id: 'coca33', qty: 2 },
];

const TEAM = [
  { id: 'mouad', name: 'Mouad', role: 'owner', initials: 'M', hue: 'brand' },
  { id: 'salma', name: 'Salma', role: 'cashier', initials: 'S', hue: 'purple' },
  { id: 'youssef', name: 'Youssef', role: 'cashier', initials: 'Y', hue: 'teal' },
];

const CUSTOMERS = [
  { id: 'c1', name: 'Hassan El Idrissi', phone: '0661 23 45 67', owed: 112000, took: 238000, paid: 126000, last: 2 },
  { id: 'c2', name: 'Fatima Zahra B.', phone: '0662 98 10 44', owed: 24550, took: 61550, paid: 37000, last: 0 },
  { id: 'c3', name: 'Omar (café d’en face)', phone: '0670 11 22 33', owed: 41000, took: 41000, paid: 0, last: 5 },
  { id: 'c4', name: 'خديجة الجارة', phone: '0655 40 30 20', owed: 8600, took: 30600, paid: 22000, last: 1 },
  { id: 'c5', name: 'Mme Benali', phone: '', owed: 5250, took: 15250, paid: 10000, last: 9 },
  { id: 'c6', name: 'Rachid T.', phone: '0661 77 88 99', owed: 0, took: 18000, paid: 18000, last: 12 },
  { id: 'c7', name: 'Youssef Amrani', phone: '', owed: 0, took: 4500, paid: 4500, last: 20 },
];

const CUSTOMER_HISTORY = [
  { d: { fr: "Aujourd'hui 09:12", ar: 'اليوم 09:12' }, kind: 'took', amount: 3450, note: { fr: 'Ticket #0187 · Salma', ar: 'التذكرة ‎#0187 · سلمى' } },
  { d: { fr: 'Hier 19:40', ar: 'أمس 19:40' }, kind: 'paid', amount: 20000, note: { fr: 'Espèces · Mouad', ar: 'نقدًا · مُعاذ' } },
  { d: { fr: '29 oct. 18:05', ar: '29 أكتوبر 18:05' }, kind: 'took', amount: 12100, note: { fr: 'Ticket #0142 · Youssef', ar: 'التذكرة ‎#0142 · يوسف' } },
  { d: { fr: '27 oct. 08:30', ar: '27 أكتوبر 08:30' }, kind: 'took', amount: 5600, note: { fr: 'Ticket #0098 · Salma', ar: 'التذكرة ‎#0098 · سلمى' } },
  { d: { fr: '25 oct. 20:10', ar: '25 أكتوبر 20:10' }, kind: 'paid', amount: 50000, note: { fr: 'Espèces · Mouad', ar: 'نقدًا · مُعاذ' } },
];

const TICKETS = [
  { no: '0187', time: '14:31', total: 3255, items: 8, method: 'cash', cashier: 'salma' },
  { no: '0186', time: '14:22', total: 1200, items: 2, method: 'cash', cashier: 'salma' },
  { no: '0185', time: '14:09', total: 3450, items: 5, method: 'credit', cashier: 'salma', customer: 'Fatima Zahra B.' },
  { no: '0184', time: '13:57', total: 650, items: 1, method: 'cash', cashier: 'youssef' },
  { no: '0183', time: '13:41', total: 8900, items: 11, method: 'card', cashier: 'youssef' },
  { no: '0182', time: '13:30', total: 240, items: 2, method: 'cash', cashier: 'youssef', voided: true },
  { no: '0181', time: '13:12', total: 1550, items: 3, method: 'cash', cashier: 'mouad' },
];

const SUPPLIERS = [
  { id: 's1', name: 'Grossiste Derb Omar', phone: '0522 30 40 50', owed: 184000 },
  { id: 's2', name: 'Laiterie Atlas', phone: '0522 61 00 00', owed: 0 },
  { id: 's3', name: 'Boissons Atlantique', phone: '0522 99 12 12', owed: 96000 },
  { id: 's4', name: 'Boulangerie Al Baraka', phone: '0661 50 50 50', owed: 0 },
  { id: 's5', name: 'Hygiène Plus', phone: '0522 44 55 66', owed: 0 },
];

const PURCHASES = [
  { id: 'p9', date: { fr: '31 oct.', ar: '31 أكتوبر' }, supplier: 'Laiterie Atlas', inv: 'LA-88231', lines: 6, total: 128400, status: 'paid', photo: true },
  { id: 'p8', date: { fr: '30 oct.', ar: '30 أكتوبر' }, supplier: 'Boissons Atlantique', inv: 'BA-2026-1187', lines: 9, total: 246000, status: 'partial', paid: 150000, photo: true },
  { id: 'p7', date: { fr: '29 oct.', ar: '29 أكتوبر' }, supplier: 'Grossiste Derb Omar', inv: 'F-5521', lines: 23, total: 184000, status: 'unpaid', photo: false },
  { id: 'p6', date: { fr: '28 oct.', ar: '28 أكتوبر' }, supplier: 'Boulangerie Al Baraka', inv: '', lines: 4, total: 21600, status: 'paid', photo: false },
  { id: 'p5', date: { fr: '27 oct.', ar: '27 أكتوبر' }, supplier: 'Grossiste Derb Omar', inv: 'F-5502', lines: 2, total: 64000, status: 'voided', photo: false },
  { id: 'p4', date: { fr: '24 oct.', ar: '24 أكتوبر' }, supplier: 'Hygiène Plus', inv: 'HP-0412', lines: 7, total: 93550, status: 'paid', photo: true },
  { id: 'p3', date: { fr: '22 oct.', ar: '22 أكتوبر' }, supplier: 'Laiterie Atlas', inv: 'LA-88102', lines: 6, total: 119800, status: 'paid', photo: true },
  { id: 'p2', date: { fr: '20 oct.', ar: '20 أكتوبر' }, supplier: 'Boissons Atlantique', inv: 'BA-2026-1120', lines: 8, total: 201500, status: 'paid', photo: false },
];

const DELIVERY_LINES = [
  { name: 'Coca-Cola 33cl', qty: 48, packs: '2 × 24', total: 24960, unit: 520, expiry: { fr: '12/2026', ar: '12/2026' } },
  { name: 'Coca-Cola 1.5L', qty: 24, packs: '4 × 6', total: 27600, unit: 1150, expiry: { fr: '03/2027', ar: '03/2027' } },
  { name: 'Eau Sidi Ali 1.5L', qty: 72, packs: '12 × 6', total: 30960, unit: 430, expiry: { fr: '—', ar: '—' } },
  { name: 'Hawaï tropical 1L', qty: 12, packs: '2 × 6', total: 10800, unit: 900, expiry: { fr: '01/2027', ar: '01/2027' } },
  { name: 'Raïbi Jamila', qty: 60, packs: '', total: 11700, unit: 195, expiry: { fr: '15/11', ar: '15/11' }, free: 6 },
];

const RECEIVE_LINES = [
  { name: 'Lait Centrale 1L', price: 700, stock: 18, last: 610, qty: '48', packs: '2 × 24', total: '292.80', unit: '6.10', expiry: { fr: '08/11', ar: '08/11' } },
  { name: 'Yaourt nature', price: 250, stock: 40, last: 190, qty: '96', packs: '4 × 24', total: '182.40', unit: '1.90', expiry: { fr: '20/11', ar: '20/11' } },
  { name: 'Jben frais', stock: 6, last: 420, qty: '12', packs: '', total: '55.20', unit: '4.60', expiry: { fr: '06/11', ar: '06/11' }, alert: { fr: 'Prix d’achat +9.5 %', ar: 'سعر الشراء ‎+9.5%' }, suggest: '6.50' },
  { name: 'Raïbi Jamila', price: 250, stock: 30, last: 195, qty: '60', packs: '', total: '117.00', unit: '1.95', expiry: { fr: '15/11', ar: '15/11' }, free: '6' },
  { name: 'Beurre doux 250g', price: 1900, stock: 3, last: 1450, qty: '', packs: '', total: '', unit: '', expiry: { fr: '', ar: '' }, incomplete: true },
];

const REPORT = {
  profit: 74230, profitPrev: 68110, revenue: 348250, revenuePrev: 331900, tickets: 187, ticketsPrev: 179, basket: 1862, margin: 21.3, marginPrev: 20.5,
  divers: { count: 9, revenue: 8600 },
  days: [
    { d: 'L', ar: 'ن', rev: 301000, prof: 61000 }, { d: 'M', ar: 'ث', rev: 287500, prof: 58200 },
    { d: 'M', ar: 'ر', rev: 322000, prof: 67900 }, { d: 'J', ar: 'خ', rev: 298400, prof: 62500 },
    { d: 'V', ar: 'ج', rev: 412000, prof: 88400 }, { d: 'S', ar: 'س', rev: 331900, prof: 68110 },
    { d: 'D', ar: 'ح', rev: 348250, prof: 74230, today: true },
  ],
  top: [
    { name: 'Coca-Cola 33cl', qty: 64, profit: 11520 },
    { name: 'Pain rond', qty: 212, profit: 7420 },
    { name: 'Thé Sultan 200g', qty: 19, profit: 6270 },
    { name: 'Eau Sidi Ali 1.5L', qty: 31, profit: 5270 },
    { name: 'Lait Centrale 1L', qty: 52, profit: 4680 },
  ],
  cats: [
    { id: 'drinks', share: 31 }, { id: 'bakery', share: 22 }, { id: 'grocery', share: 19 },
    { id: 'dairy', share: 14 }, { id: 'produce', share: 9 }, { id: 'hygiene', share: 5 },
  ],
  hours: [3, 9, 14, 11, 8, 10, 12, 7, 6, 9, 13, 18, 22, 16, 9],
};
