/**
 * Demo Market catalogue: a mid-size Tashkent mini-market with a pharmacy corner and a building
 * materials section. ~300 SKUs across nested categories, realistic 2026 UZS prices.
 */

export interface ProductTemplate {
  /** Category path from the root. */
  cat: string[];
  name: string;
  unit: 'dona' | 'kg' | 'l' | 'm' | 'quti' | 'paket' | 'qop';
  /** Purchase cost per base unit (UZS). */
  cost: number;
  /** Relative sales popularity; 0 = never sells (dead stock). */
  pop: number;
  /** Shelf life in days for expiry-tracked goods. */
  shelf?: number;
  /** Extra units: [unit code, base units per unit]. */
  alt?: [string, number][];
  variants?: string[];
  supplier: number;
  markup?: number;
}

const T = (t: Omit<ProductTemplate, 'pop'> & { pop?: number }): ProductTemplate => ({ pop: 1, ...t });

const FOOD = 'Oziq-ovqat';
const DRINKS = [FOOD, 'Ichimliklar'];
const DAIRY = [FOOD, 'Sut mahsulotlari'];
const GROCERY = [FOOD, 'Bakaleya'];
const SWEETS = [FOOD, 'Shirinliklar'];
const CHEM = 'Maishiy kimyo';
const HYG = 'Shaxsiy gigiyena';
const PHARMA = 'Dorixona';
const BUILD = 'Qurilish mollari';
const HOME = "Uy-ro'zg'or";

export const SUPPLIERS = [
  { name: 'Coca-Cola Ichimligi Uzbekistan', phone: '+998 71 120 00 01', contact: 'Sardor Nazarov', inn: '200512345' },
  { name: 'Global Food Trade MChJ', phone: '+998 71 205 44 10', contact: 'Ulug‘bek Hamidov', inn: '301442817' },
  { name: 'Sut Olami MChJ', phone: '+998 90 318 22 45', contact: 'Nodira Saidova', inn: '305118904' },
  { name: 'Toza Uy Kimyo', phone: '+998 93 555 70 12', contact: 'Rustam Qodirov', inn: '303902551' },
  { name: 'Farm Lux Distribyutor', phone: '+998 71 233 90 90', contact: 'Gulnora Ergasheva', inn: '207766120' },
  { name: 'Qurilish Savdo Markazi', phone: '+998 97 711 30 30', contact: 'Botir Yo‘ldoshev', inn: '306654210' },
  { name: 'Asia Trade Distribution', phone: '+998 71 150 15 15', contact: 'Timur Ahmedov', inn: '302281776' },
  { name: 'Shirin Dunyo Savdo', phone: '+998 99 840 61 61', contact: 'Malika Usmonova', inn: '304419058' },
];

function sizes(cat: string[], brands: string[], kind: string, list: [string, number][], supplier: number, extra: Partial<ProductTemplate> = {}) {
  const out: ProductTemplate[] = [];
  brands.forEach((b, bi) =>
    list.forEach(([size, cost], si) =>
      out.push(T({ cat, name: `${b} ${kind}${size ? ` ${size}` : ''}`.replace(/\s+/g, ' ').trim(), unit: 'dona', cost: Math.round(cost * (1 + bi * 0.03)), pop: 1.6 - bi * 0.15 - si * 0.12, supplier, ...extra })),
    ),
  );
  return out;
}

export const CATALOG: ProductTemplate[] = [
  // ── Drinks ──
  ...sizes([...DRINKS, 'Gazli ichimliklar'], ['Coca-Cola', 'Pepsi', 'Fanta', 'Sprite', '7Up', 'Mirinda'], '', [['0.5 l', 5200], ['1 l', 8300], ['1.5 l', 10600]], 0, { alt: [['quti', 12]] }),
  ...sizes([...DRINKS, 'Suv'], ['Hydrolife', 'Nestle Pure Life', 'Bonaqua', 'Chortoq'], 'suv', [['0.5 l', 2100], ['1.5 l', 3300], ['5 l', 7800]], 0, { alt: [['quti', 6]] }),
  ...sizes([...DRINKS, 'Sharbatlar'], ['Dena', 'Rich', 'Bliss'], 'sharbat', [['olma 1 l', 11800], ['apelsin 1 l', 12500], ['shaftoli 1 l', 12200]], 1),
  ...sizes([...DRINKS, 'Energetiklar'], ['Red Bull', 'Flash Up', 'Adrenaline Rush'], '', [['0.25 l', 9500], ['0.45 l', 13800]], 6),
  T({ cat: [...DRINKS, 'Choy va qahva'], name: 'Ahmad Tea qora choy 100 paket', unit: 'dona', cost: 33500, supplier: 6 }),
  T({ cat: [...DRINKS, 'Choy va qahva'], name: 'Greenfield Golden Ceylon 100 paket', unit: 'dona', cost: 36800, supplier: 6 }),
  T({ cat: [...DRINKS, 'Choy va qahva'], name: 'Lipton Yellow Label 50 paket', unit: 'dona', cost: 19800, supplier: 6 }),
  T({ cat: [...DRINKS, 'Choy va qahva'], name: 'Ko‘k choy №95 200 g', unit: 'dona', cost: 14200, supplier: 6, pop: 1.8 }),
  T({ cat: [...DRINKS, 'Choy va qahva'], name: 'Nescafe Gold 95 g', unit: 'dona', cost: 48500, supplier: 1 }),
  T({ cat: [...DRINKS, 'Choy va qahva'], name: 'Jacobs Monarch 95 g', unit: 'dona', cost: 45200, supplier: 1 }),
  T({ cat: [...DRINKS, 'Choy va qahva'], name: 'Nescafe Classic 3in1 (20 dona)', unit: 'dona', cost: 31800, supplier: 1, alt: [['quti', 10]] }),
  T({ cat: [...DRINKS, 'Choy va qahva'], name: 'Tess Pleasure 25 paket', unit: 'dona', cost: 15400, supplier: 6, pop: 0 }),

  // ── Dairy (expiry-tracked) ──
  ...sizes(DAIRY, ['Musaffo', 'Lactel', 'Nestle'], 'sut 3.2%', [['1 l', 11200]], 2, { shelf: 12 }),
  ...sizes(DAIRY, ['Musaffo', 'Bio Balance'], 'qatiq', [['0.5 l', 6900], ['1 l', 12400]], 2, { shelf: 10 }),
  ...sizes(DAIRY, ['Musaffo', 'Prostokvashino'], 'smetana 20%', [['400 g', 15800]], 2, { shelf: 14 }),
  ...sizes(DAIRY, ['Lactel', 'Musaffo'], 'tvorog 9%', [['200 g', 10800]], 2, { shelf: 9 }),
  ...sizes(DAIRY, ['Danone', 'Activia'], 'yogurt', [['shaftoli 290 g', 8900], ['qulupnay 290 g', 8900]], 2, { shelf: 21 }),
  T({ cat: DAIRY, name: 'Sariyog‘ 82.5% 200 g', unit: 'dona', cost: 23800, supplier: 2, shelf: 45, pop: 1.3 }),
  T({ cat: DAIRY, name: 'Pishloq Gollandskiy', unit: 'kg', cost: 96000, supplier: 2, shelf: 60, pop: 0.9 }),
  T({ cat: DAIRY, name: 'Pishloq Rossiyskiy', unit: 'kg', cost: 89000, supplier: 2, shelf: 60, pop: 0.7 }),
  T({ cat: DAIRY, name: 'Tuxum C1 (10 dona)', unit: 'dona', cost: 15500, supplier: 1, shelf: 25, pop: 2.2, alt: [['quti', 36]] }),

  // ── Bread ──
  T({ cat: [FOOD, 'Non mahsulotlari'], name: 'Obi non', unit: 'dona', cost: 3200, supplier: 1, pop: 3.2 }),
  T({ cat: [FOOD, 'Non mahsulotlari'], name: 'Patir non', unit: 'dona', cost: 5200, supplier: 1, pop: 1.6 }),
  T({ cat: [FOOD, 'Non mahsulotlari'], name: 'Buxanka (oq non)', unit: 'dona', cost: 4100, supplier: 1, pop: 1.8 }),
  T({ cat: [FOOD, 'Non mahsulotlari'], name: 'Lavash', unit: 'dona', cost: 2900, supplier: 1, pop: 0.9 }),
  T({ cat: [FOOD, 'Non mahsulotlari'], name: 'Baton kesilgan', unit: 'dona', cost: 4800, supplier: 1, pop: 1 }),

  // ── Grocery ──
  T({ cat: [...GROCERY, 'Guruch va yormalar'], name: 'Guruch Lazer', unit: 'kg', cost: 21500, supplier: 1, pop: 2.1, alt: [['qop', 25]] }),
  T({ cat: [...GROCERY, 'Guruch va yormalar'], name: 'Guruch Devzira', unit: 'kg', cost: 33800, supplier: 1, pop: 1.4, alt: [['qop', 25]] }),
  T({ cat: [...GROCERY, 'Guruch va yormalar'], name: 'Guruch Alanga', unit: 'kg', cost: 18900, supplier: 1, pop: 1.1 }),
  T({ cat: [...GROCERY, 'Guruch va yormalar'], name: 'Grechka', unit: 'kg', cost: 16500, supplier: 6 }),
  T({ cat: [...GROCERY, 'Guruch va yormalar'], name: 'Mosh', unit: 'kg', cost: 19800, supplier: 6, pop: 0.8 }),
  T({ cat: [...GROCERY, 'Guruch va yormalar'], name: 'No‘xat', unit: 'kg', cost: 17200, supplier: 6, pop: 0.9 }),
  T({ cat: [...GROCERY, 'Guruch va yormalar'], name: 'Gerkules suli yormasi 500 g', unit: 'dona', cost: 9800, supplier: 6 }),
  T({ cat: [...GROCERY, 'Un va shakar'], name: 'Un oliy nav', unit: 'kg', cost: 6400, supplier: 1, pop: 1.9, alt: [['qop', 50]] }),
  T({ cat: [...GROCERY, 'Un va shakar'], name: 'Shakar', unit: 'kg', cost: 12800, supplier: 1, pop: 2.4, alt: [['qop', 50]] }),
  T({ cat: [...GROCERY, 'Un va shakar'], name: 'Tuz yodlangan 1 kg', unit: 'dona', cost: 2600, supplier: 1, pop: 1.2 }),
  T({ cat: [...GROCERY, 'Un va shakar'], name: 'Qand (rafinad) 1 kg', unit: 'dona', cost: 17900, supplier: 1 }),
  ...sizes([...GROCERY, 'O‘simlik yog‘i'], ['Oltin Vodiy', 'Sof', 'Zolotaya Semechka'], 'kungaboqar yog‘i', [['1 l', 21500], ['5 l', 101000]], 1),
  T({ cat: [...GROCERY, 'O‘simlik yog‘i'], name: 'Paxta yog‘i 1 l', unit: 'dona', cost: 22800, supplier: 1, pop: 1.5 }),
  ...sizes([...GROCERY, 'Makaron'], ['Makfa', 'Barilla', 'Shebekinskiye'], 'makaron', [['spirali 400 g', 9200], ['spagetti 450 g', 10400]], 6),
  ...sizes([...GROCERY, 'Konservalar'], ['Pomidor pastasi', 'Yashil no‘xat', 'Makkajo‘xori'], '', [['380 g', 11200]], 6),
  T({ cat: [...GROCERY, 'Konservalar'], name: 'Mol go‘shti tushonka 325 g', unit: 'dona', cost: 32500, supplier: 6 }),
  T({ cat: [...GROCERY, 'Konservalar'], name: 'Sardina yog‘da 240 g', unit: 'dona', cost: 15800, supplier: 6, pop: 0 }),
  T({ cat: [...GROCERY, 'Ziravorlar'], name: 'Zira 100 g', unit: 'dona', cost: 8900, supplier: 6 }),
  T({ cat: [...GROCERY, 'Ziravorlar'], name: 'Qora murch 50 g', unit: 'dona', cost: 5400, supplier: 6 }),
  T({ cat: [...GROCERY, 'Ziravorlar'], name: 'Kashnich urug‘i 100 g', unit: 'dona', cost: 4800, supplier: 6, pop: 0.4 }),
  T({ cat: [...GROCERY, 'Ziravorlar'], name: 'Mayonez Provansal 400 g', unit: 'dona', cost: 14600, supplier: 6, pop: 1.5 }),
  T({ cat: [...GROCERY, 'Ziravorlar'], name: 'Ketchup Heinz 350 g', unit: 'dona', cost: 18900, supplier: 6 }),

  // ── Meat (expiry) ──
  T({ cat: [FOOD, 'Go‘sht mahsulotlari'], name: 'Kolbasa Doktorskaya', unit: 'kg', cost: 78000, supplier: 6, shelf: 20, pop: 1.1 }),
  T({ cat: [FOOD, 'Go‘sht mahsulotlari'], name: 'Sosiska Molochnaya', unit: 'kg', cost: 64000, supplier: 6, shelf: 15, pop: 1.2 }),
  T({ cat: [FOOD, 'Go‘sht mahsulotlari'], name: 'Tovuq son qismi (muzlatilgan)', unit: 'kg', cost: 36500, supplier: 6, shelf: 90, pop: 1.4 }),
  T({ cat: [FOOD, 'Go‘sht mahsulotlari'], name: 'Qazi', unit: 'kg', cost: 210000, supplier: 6, shelf: 60, pop: 0.4 }),

  // ── Sweets ──
  ...sizes([...SWEETS, 'Shokoladlar'], ['Snickers', 'Mars', 'Twix', 'KitKat', 'Bounty'], 'batonchik', [['', 7400]], 7, { alt: [['quti', 32]] }),
  ...sizes([...SWEETS, 'Shokoladlar'], ['Alpen Gold', 'Milka', 'Kommunarka'], 'shokolad', [['90 g', 13800]], 7),
  T({ cat: [...SWEETS, 'Pechenye'], name: 'Yubileynoye pechenye 112 g', unit: 'dona', cost: 6200, supplier: 7 }),
  T({ cat: [...SWEETS, 'Pechenye'], name: 'Oreo 95 g', unit: 'dona', cost: 9800, supplier: 7 }),
  T({ cat: [...SWEETS, 'Pechenye'], name: 'Pechenye Bayram (tortli)', unit: 'kg', cost: 38000, supplier: 7, pop: 0.8 }),
  T({ cat: [...SWEETS, 'Pechenye'], name: 'Vafli Artek 250 g', unit: 'dona', cost: 11600, supplier: 7 }),
  T({ cat: [...SWEETS, 'Konfetlar'], name: 'Konfet Alyonka (assorti)', unit: 'kg', cost: 72000, supplier: 7, pop: 0.9 }),
  T({ cat: [...SWEETS, 'Konfetlar'], name: 'Navvot', unit: 'kg', cost: 42000, supplier: 7, pop: 0.6 }),
  T({ cat: [...SWEETS, 'Konfetlar'], name: 'Holva kunjutli', unit: 'kg', cost: 46000, supplier: 7, pop: 0.5 }),
  T({ cat: [...SWEETS, 'Konfetlar'], name: 'Chupa Chups', unit: 'dona', cost: 1900, supplier: 7, pop: 1.4, alt: [['quti', 100]] }),
  T({ cat: [...SWEETS, 'Konfetlar'], name: 'Mentos yalpizli', unit: 'dona', cost: 4300, supplier: 7 }),
  T({ cat: [...SWEETS, 'Konfetlar'], name: 'Orbit saqich', unit: 'dona', cost: 4100, supplier: 7, pop: 1.3 }),

  // ── Fruit & veg (sold by weight) ──
  ...(
    [
      ['Kartoshka', 5200, 3], ['Piyoz', 3900, 2.6], ['Sabzi (sariq)', 4600, 2], ['Pomidor', 14500, 2.2], ['Bodring', 11800, 1.8],
      ['Karam', 3600, 1], ['Bulg‘or qalampiri', 16800, 0.8], ['Sarimsoq', 21000, 0.7], ['Olma Golden', 13500, 1.6], ['Banan', 19800, 1.7],
      ['Limon', 26000, 0.9], ['Uzum (Kishmish)', 24000, 0.8], ['Anor', 22000, 0.7], ['Mandarin', 21500, 1.1],
    ] as [string, number, number][]
  ).map(([name, cost, pop]) => T({ cat: [FOOD, 'Meva va sabzavotlar'], name, unit: 'kg', cost, pop, supplier: 1, markup: 1.3 })),
  T({ cat: [FOOD, 'Meva va sabzavotlar'], name: 'Ko‘kat (shivit, kashnich)', unit: 'dona', cost: 2200, supplier: 1, pop: 1.2 }),
  // ── Snacks ──
  ...sizes([FOOD, 'Gazaklar'], ['Lay’s pishloqli', 'Lay’s smetana-ko‘kat', 'Lay’s qisqichbaqa'], 'chips', [['90 g', 11200], ['150 g', 16800]], 7),
  ...sizes([FOOD, 'Gazaklar'], ['Pringles Original', 'Pringles Sour Cream'], '', [['165 g', 33500]], 7),
  ...sizes([FOOD, 'Gazaklar'], ['Kirieshki', 'Xrusteam'], 'suxarik', [['40 g', 3600]], 7),
  T({ cat: [FOOD, 'Gazaklar'], name: 'Pista qovurilgan 100 g', unit: 'dona', cost: 24000, supplier: 7, pop: 0.6 }),
  T({ cat: [FOOD, 'Gazaklar'], name: 'Pista (semechka) Babkiny 200 g', unit: 'dona', cost: 9200, supplier: 7, pop: 1.1 }),
  T({ cat: [FOOD, 'Gazaklar'], name: 'Bodom mag‘zi', unit: 'kg', cost: 142000, supplier: 7, pop: 0.3 }),
  // ── Frozen ──
  ...sizes([FOOD, 'Muzlatilgan mahsulotlar'], ['Muzqaymoq Plombir', 'Muzqaymoq Eskimo', 'Muzqaymoq Rozhok'], '', [['', 5600]], 2, { shelf: 180 }),
  T({ cat: [FOOD, 'Muzlatilgan mahsulotlar'], name: 'Chuchvara (muzlatilgan) 1 kg', unit: 'dona', cost: 38000, supplier: 6, pop: 1.1, shelf: 90 }),
  T({ cat: [FOOD, 'Muzlatilgan mahsulotlar'], name: 'Pelmen “Sibirskiye” 800 g', unit: 'dona', cost: 34000, supplier: 6, pop: 0.7, shelf: 90 }),
  // ── Baby ──
  T({ cat: [FOOD, 'Bolalar ovqati'], name: 'Nutrilon 1 aralashma 350 g', unit: 'dona', cost: 118000, supplier: 4, pop: 0.4, shelf: 365 }),
  T({ cat: [FOOD, 'Bolalar ovqati'], name: 'Agusha olma pyuresi 90 g', unit: 'dona', cost: 7600, supplier: 2, pop: 0.6, shelf: 180 }),
  T({ cat: [FOOD, 'Bolalar ovqati'], name: 'Fruto Nyanya sharbat 0.2 l', unit: 'dona', cost: 4900, supplier: 2, pop: 0.8, shelf: 180 }),
  // ── Stationery ──
  ...sizes([HOME, 'Kanselyariya'], ['Daftar'], '', [['12 varaq', 1400], ['48 varaq', 5200], ['96 varaq', 9800]], 6),
  T({ cat: [HOME, 'Kanselyariya'], name: 'Sharikli ruchka', unit: 'dona', cost: 1700, supplier: 6, variants: ['Ko‘k', 'Qora'], pop: 1, alt: [['quti', 50]] }),
  T({ cat: [HOME, 'Kanselyariya'], name: 'Qalam HB', unit: 'dona', cost: 1300, supplier: 6, pop: 0.5 }),
  T({ cat: [HOME, 'Kanselyariya'], name: 'A4 qog‘oz Svetocopy 500 varaq', unit: 'paket', cost: 52000, supplier: 6, pop: 0.4 }),

  // ── Household chemicals ──
  ...sizes([CHEM, 'Kir yuvish vositalari'], ['Ariel', 'Tide', 'Persil', 'Myth'], 'kir yuvish kukuni', [['450 g', 18200], ['3 kg', 92000]], 3),
  T({ cat: [CHEM, 'Kir yuvish vositalari'], name: 'Lenor kondisioner 1 l', unit: 'dona', cost: 31800, supplier: 3 }),
  ...sizes([CHEM, 'Idish yuvish'], ['Fairy', 'Pril', 'AOS'], 'idish yuvish vositasi', [['500 ml', 12900], ['1 l', 22500]], 3),
  T({ cat: [CHEM, 'Tozalash vositalari'], name: 'Domestos 1 l', unit: 'dona', cost: 27800, supplier: 3 }),
  T({ cat: [CHEM, 'Tozalash vositalari'], name: 'Mr. Proper 1 l', unit: 'dona', cost: 26500, supplier: 3 }),
  T({ cat: [CHEM, 'Tozalash vositalari'], name: 'Comet kukuni 475 g', unit: 'dona', cost: 11200, supplier: 3 }),
  T({ cat: [CHEM, 'Tozalash vositalari'], name: 'Oqartiruvchi Belizna 1 l', unit: 'dona', cost: 7800, supplier: 3, pop: 1.3 }),
  T({ cat: [CHEM, 'Tozalash vositalari'], name: 'Oyna tozalagich Mr. Muscle 500 ml', unit: 'dona', cost: 21900, supplier: 3, pop: 0.6 }),

  // ── Hygiene ──
  ...sizes([HYG, 'Sovun'], ['Dove', 'Palmolive', 'Safeguard'], 'sovun 90 g', [['', 8600]], 3, { alt: [['quti', 48]] }),
  ...sizes([HYG, 'Shampunlar'], ['Head & Shoulders', 'Pantene', 'Clear', 'Shamtu'], 'shampun', [['400 ml', 46000], ['200 ml', 27000]], 3),
  ...sizes([HYG, 'Tish parvarishi'], ['Colgate', 'Blend-a-med', 'Splat'], 'tish pastasi 100 ml', [['', 17800]], 3),
  T({ cat: [HYG, 'Tish parvarishi'], name: 'Oral-B tish cho‘tkasi', unit: 'dona', cost: 15900, supplier: 3 }),
  T({ cat: [HYG, 'Qog‘oz mahsulotlari'], name: 'Hojatxona qog‘ozi Zewa (4 dona)', unit: 'paket', cost: 15800, supplier: 3, pop: 2, alt: [['quti', 12]] }),
  T({ cat: [HYG, 'Qog‘oz mahsulotlari'], name: 'Qog‘oz salfetka 100 dona', unit: 'dona', cost: 6200, supplier: 3, pop: 1.2 }),
  T({ cat: [HYG, 'Qog‘oz mahsulotlari'], name: 'Ho‘l salfetka 120 dona', unit: 'dona', cost: 13900, supplier: 3 }),
  T({ cat: [HYG, 'Qog‘oz mahsulotlari'], name: 'Pampers Active Baby 4 (46 dona)', unit: 'dona', cost: 158000, supplier: 3, pop: 0.6 }),

  // ── Pharmacy (expiry) ──
  ...(
    [
      ['Paratsetamol 500 mg №10', 4200, 1.8],
      ['Ibuprofen 200 mg №20', 9800, 1.2],
      ['Analgin 500 mg №10', 3800, 1],
      ['Sitramon P №10', 4900, 1.1],
      ['Nurofen 200 mg №10', 28900, 0.7],
      ['Aspirin 500 mg №10', 6200, 0.6],
      ['Askorbin kislotasi (Vitamin C) №50', 5600, 0.9],
      ['Validol 60 mg №10', 6800, 0.5],
      ['Faringosept №20', 26500, 0.6],
      ['Mezim forte №20', 29800, 0.6],
      ['No-shpa 40 mg №24', 34600, 0.7],
      ['Smekta 3 g №10', 41200, 0.5],
      ['Loperamid 2 mg №20', 8900, 0.5],
      ['Aktivlangan ko‘mir №10', 2400, 0.8],
      ['Teraflu limonli №10', 79800, 0.4],
      ['Strepsils №24', 46800, 0.5],
      ['Aqualor burun spreyi', 92000, 0.2],
      ['Pentalgin №12', 32400, 0],
    ] as [string, number, number][]
  ).map(([name, cost, pop]) => T({ cat: [PHARMA, 'Dori-darmonlar'], name, unit: 'quti', cost, pop, supplier: 4, shelf: 540, markup: 1.22 })),
  T({ cat: [PHARMA, 'Tibbiy buyumlar'], name: 'Tibbiy niqob (50 dona)', unit: 'paket', cost: 21000, supplier: 4, pop: 0.6 }),
  T({ cat: [PHARMA, 'Tibbiy buyumlar'], name: 'Shpris 5 ml', unit: 'dona', cost: 950, supplier: 4, pop: 1, alt: [['quti', 100]] }),
  T({ cat: [PHARMA, 'Tibbiy buyumlar'], name: 'Bint steril 7x14', unit: 'dona', cost: 3600, supplier: 4, pop: 0.6 }),
  T({ cat: [PHARMA, 'Tibbiy buyumlar'], name: 'Raqamli termometr', unit: 'dona', cost: 38000, supplier: 4, pop: 0.2 }),
  T({ cat: [PHARMA, 'Tibbiy buyumlar'], name: 'Leykoplastir 2x500', unit: 'dona', cost: 7200, supplier: 4, pop: 0.4 }),
  T({ cat: [PHARMA, 'Tibbiy buyumlar'], name: 'Yod spirtli 5% 10 ml', unit: 'dona', cost: 3900, supplier: 4, pop: 0.5, shelf: 720 }),

  // ── Building materials ──
  T({ cat: [BUILD, 'Bo‘yoqlar'], name: 'Emal PF-115 2.8 kg', unit: 'dona', cost: 74000, supplier: 5, variants: ['Oq', 'Qora', 'Ko‘k', 'Yashil', 'Qizil', 'Sariq'], pop: 0.6 }),
  T({ cat: [BUILD, 'Bo‘yoqlar'], name: 'Suv emulsion bo‘yoq 14 kg', unit: 'dona', cost: 168000, supplier: 5, variants: ['Oq', 'Krem'], pop: 0.4 }),
  T({ cat: [BUILD, 'Bo‘yoqlar'], name: 'Lak PF-283 0.8 kg', unit: 'dona', cost: 34000, supplier: 5, pop: 0.3 }),
  T({ cat: [BUILD, 'Bo‘yoqlar'], name: 'Mo‘yqalam 50 mm', unit: 'dona', cost: 9500, supplier: 5, pop: 0.6 }),
  T({ cat: [BUILD, 'Bo‘yoqlar'], name: 'Valik 180 mm', unit: 'dona', cost: 22000, supplier: 5, pop: 0.4 }),
  T({ cat: [BUILD, 'Mahkamlagichlar'], name: 'Mix 50 mm', unit: 'kg', cost: 19000, supplier: 5, pop: 0.8 }),
  T({ cat: [BUILD, 'Mahkamlagichlar'], name: 'Mix 100 mm', unit: 'kg', cost: 18200, supplier: 5, pop: 0.6 }),
  T({ cat: [BUILD, 'Mahkamlagichlar'], name: 'Shurup 3.5x35 (yog‘och)', unit: 'quti', cost: 39000, supplier: 5, pop: 0.5 }),
  T({ cat: [BUILD, 'Mahkamlagichlar'], name: 'Dyubel 6x40 (100 dona)', unit: 'paket', cost: 14500, supplier: 5, pop: 0.6 }),
  T({ cat: [BUILD, 'Mahkamlagichlar'], name: 'Ankerbolt 10x100', unit: 'dona', cost: 4200, supplier: 5, pop: 0.3 }),
  T({ cat: [BUILD, 'Elektr', 'Kabellar'], name: 'Kabel VVG 2x1.5', unit: 'm', cost: 6100, supplier: 5, pop: 0.9 }),
  T({ cat: [BUILD, 'Elektr', 'Kabellar'], name: 'Kabel VVG 3x2.5', unit: 'm', cost: 13400, supplier: 5, pop: 0.7 }),
  T({ cat: [BUILD, 'Elektr', 'Kabellar'], name: 'Sim PVS 2x0.75', unit: 'm', cost: 4200, supplier: 5, pop: 0.6 }),
  T({ cat: [BUILD, 'Elektr', 'Yoritish'], name: 'LED lampa E27', unit: 'dona', cost: 11500, supplier: 5, variants: ['9 W', '12 W', '15 W'], pop: 1, alt: [['quti', 50]] }),
  T({ cat: [BUILD, 'Elektr', 'Yoritish'], name: 'Prozhektor LED 50 W', unit: 'dona', cost: 89000, supplier: 5, pop: 0.2 }),
  T({ cat: [BUILD, 'Elektr', 'Rozetka va viklyuchatellar'], name: 'Rozetka ikki o‘rinli', unit: 'dona', cost: 23500, supplier: 5, pop: 0.5 }),
  T({ cat: [BUILD, 'Elektr', 'Rozetka va viklyuchatellar'], name: 'Viklyuchatel bir klavishli', unit: 'dona', cost: 17800, supplier: 5, pop: 0.4 }),
  T({ cat: [BUILD, 'Elektr', 'Rozetka va viklyuchatellar'], name: 'Uzaytirgich 5 m (4 rozetka)', unit: 'dona', cost: 64000, supplier: 5, pop: 0.4 }),
  T({ cat: [BUILD, 'Quruq aralashmalar'], name: 'Sement M400 50 kg', unit: 'qop', cost: 69000, supplier: 5, pop: 0.7 }),
  T({ cat: [BUILD, 'Quruq aralashmalar'], name: 'Knauf Rotband gips 30 kg', unit: 'qop', cost: 98000, supplier: 5, pop: 0.4 }),
  T({ cat: [BUILD, 'Quruq aralashmalar'], name: 'Ceresit CM11 plitka yelimi 25 kg', unit: 'qop', cost: 112000, supplier: 5, pop: 0.3 }),
  T({ cat: [BUILD, 'Quruq aralashmalar'], name: 'Shpaklyovka finish 20 kg', unit: 'qop', cost: 86000, supplier: 5, pop: 0 }),
  T({ cat: [BUILD, 'Asboblar'], name: 'Bolg‘a 500 g', unit: 'dona', cost: 42000, supplier: 5, pop: 0.2 }),
  T({ cat: [BUILD, 'Asboblar'], name: 'Ruletka 5 m', unit: 'dona', cost: 28000, supplier: 5, pop: 0.3 }),
  T({ cat: [BUILD, 'Asboblar'], name: 'Otvyortka to‘plami (6 dona)', unit: 'dona', cost: 56000, supplier: 5, pop: 0.2 }),
  T({ cat: [BUILD, 'Asboblar'], name: 'Ish qo‘lqopi', unit: 'dona', cost: 6500, supplier: 5, variants: ['M', 'L', 'XL'], pop: 0.7 }),
  T({ cat: [BUILD, 'Asboblar'], name: 'Silikon germetik 280 ml', unit: 'dona', cost: 31000, supplier: 5, pop: 0.4 }),
  T({ cat: [BUILD, 'Asboblar'], name: 'Montaj ko‘pigi 750 ml', unit: 'dona', cost: 54000, supplier: 5, pop: 0 }),
  T({ cat: [BUILD, 'Asboblar'], name: 'Elektr drel Bosch 650 W', unit: 'dona', cost: 890000, supplier: 5, pop: 0 }),

  // ── Home ──
  T({ cat: [HOME, 'Oshxona'], name: 'Musor paketi 60 l (20 dona)', unit: 'dona', cost: 9800, supplier: 3, pop: 1.3 }),
  T({ cat: [HOME, 'Oshxona'], name: 'Folga 10 m', unit: 'dona', cost: 16200, supplier: 3, pop: 0.5 }),
  T({ cat: [HOME, 'Oshxona'], name: 'Oziq-ovqat plyonkasi 20 m', unit: 'dona', cost: 14800, supplier: 3, pop: 0.4 }),
  T({ cat: [HOME, 'Oshxona'], name: 'Idish yuvish gubkasi (5 dona)', unit: 'paket', cost: 7900, supplier: 3, pop: 0.9 }),
  T({ cat: [HOME, 'Oshxona'], name: 'Gugurt (10 quti)', unit: 'paket', cost: 3800, supplier: 6, pop: 0.6 }),
  T({ cat: [HOME, 'Elementlar'], name: 'Duracell batareyka', unit: 'dona', cost: 11800, supplier: 6, variants: ['AA', 'AAA'], pop: 0.7 }),
  T({ cat: [HOME, 'Elementlar'], name: 'Zajigalka Cricket', unit: 'dona', cost: 4200, supplier: 6, pop: 0.8 }),
  T({ cat: [HOME, 'Elementlar'], name: 'Sham (10 dona)', unit: 'paket', cost: 12500, supplier: 6, pop: 0 }),
];

export const CUSTOMERS = [
  'Abdulla Karimov', 'Zarina Tursunova', 'Sherzod Mirzayev', 'Dildora Xasanova', 'Rustam Islomov', 'Feruza Normatova', 'Otabek Qodirov',
  'Nigora Ahmedova', 'Bahodir Ergashev', 'Shahnoza Yo‘ldosheva', 'Javlon Rahmonov', 'Gulchehra Sobirova', 'Azizbek Umarov', 'Malika Saidova',
  'Sanjar Abdullayev', 'Kamola Ibragimova', 'Doniyor Xolmatov', 'Laylo Qosimova', 'Ilhom Nazarov', 'Muxlisa Jo‘rayeva', 'Akbar Hamroyev',
  'Ozoda Rasulova', 'Farrux Tojiboyev', 'Sevara Aminova', 'Ulug‘bek Sultonov', 'Barno Ismoilova', 'Behruz Qurbonov', 'Nilufar Hakimova',
  '“Baraka” oshxonasi', '“Shirin” qandolat sexi', '“Usta Bobur” ta’mirlash', '“Navro‘z” to‘yxonasi', 'Mahalla qo‘mitasi (Qatortol)',
  '“Gulshan” choyxonasi', '“Ideal Qurilish” MChJ', '“Toshkent Remont” brigadasi', 'Xurshid aka (qo‘shni do‘kon)', 'Saida opa (bog‘cha)',
  'Anvar Po‘latov', 'Madina Ortiqova', 'Shoxrux Aliyev', 'Mohira Xudoyberdiyeva',
];
