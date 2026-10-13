// Generates src/seed-data.json: items, cases and drop chances.
// Chances follow a power law (cheaper items drop more often); the exponent is
// solved per case so the expected value hits the target return (RTP).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// name, value (coins), emoji
const ITEMS = [
  // existing brainrots: order fixes their ids, append new ones at the end
  ['Noobini Pizzanini', 1, '🍕'],
  ['Lirilì Larilà', 2, '🌵'],
  ['Tim Cheese', 2, '🧀'],
  ['Fluriflura', 3, '🌸'],
  ['Talpa Di Fero', 3, '⛏️'],
  ['Svinina Bombardino', 4, '🐷'],
  ['Pipi Kiwi', 4, '🥝'],
  ['Trippi Troppi', 5, '🦐'],
  ['Tung Tung Tung Sahur', 6, '🪵'],
  ['Gangster Footera', 6, '🕶️'],
  ['Bandito Bobritto', 7, '🦫'],
  ['Boneca Ambalabu', 8, '🐸'],
  ['Cacto Hipopotamo', 8, '🦛'],
  ['Ta Ta Ta Ta Sahur', 9, '🫖'],
  ['Tric Trac Baraboom', 10, '💥'],
  ['Cappuccino Assassino', 12, '☕'],
  ['Brr Brr Patapim', 14, '🌳'],
  ['Trulimero Trulicina', 15, '🐟'],
  ['Bambini Crostini', 16, '🥖'],
  ['Bananita Dolphinita', 18, '🐬'],
  ['Perochello Lemonchello', 20, '🍋'],
  ['Brri Brri Bicus Dicus Bombicus', 22, '🐦'],
  ['Avocadini Guffo', 24, '🥑'],
  ['Salamino Penguino', 25, '🐧'],
  ['Burbaloni Loliloli', 28, '🍭'],
  ['Chimpanzini Bananini', 30, '🍌'],
  ['Ballerina Cappuccina', 32, '🩰'],
  ['Chef Crabracadabra', 35, '🦀'],
  ['Lionel Cactuseli', 38, '🦁'],
  ['Glorbo Fruttodrillo', 40, '🍉'],
  ['Blueberrinni Octopusini', 42, '🐙'],
  ['Strawberelli Flamingelli', 45, '🦩'],
  ['Cocosini Mama', 48, '🥥'],
  ['Frigo Camelo', 50, '🐫'],
  ['Orangutini Ananassini', 52, '🍍'],
  ['Rhino Toasterino', 55, '🦏'],
  ['Garama and Madundung', 65, '🍲'],
  ['Wave Rider', 61, '🏄'],
  ["Cupid's Wings", 61, '💘'],
  ['La Secret Combinasion', 60, '🔐'],
  ["Witch's Broom", 61, '🧹'],
  ['Cash or Card', 65, '💳'],
  ['Bombardiro Crocodilo', 75, '🐊'],
  ["Santa's Sleigh", 80, '🛷'],
  ['Bombombini Gusini', 85, '🪿'],
  ['Burguro and Fryuro', 100, '🍔'],
  ['Cavallo Virtuoso', 100, '🐴'],
  ['Gorillo Watermelondrillo', 110, '🦍'],
  ['Tigrilini Watermelini', 120, '🐯'],
  ['Capitano Moby', 140, '🚢'],
  ['Cocofanto Elefanto', 140, '🐘'],
  ['Boppin Bunny', 130, '🐰'],
  ['Orcalero Orcala', 160, '🐋'],
  ['Cooki and Milki', 190, '🍪'],
  ['Spooky and Pumpky', 200, '🎃'],
  ['Tralalero Tralala', 15, '🦈'],
  ['Odin Din Din Dun', 220, '🗿'],
  ['Girafa Celestre', 240, '🦒'],
  ['Matteo', 250, '🎩'],
  ['Gattatino Neonino', 280, '🐱'],
  ['La Vacca Saturno Saturnita', 300, '🐄'],
  ['Chimpanzini Spiderini', 350, '🕷️'],
  ['Los Tralaleritos', 400, '🌊'],
  ['Graipuss Medussi', 450, '🪼'],
  ['Trenostruzzo Turbo 3000', 500, '🚂'],
  ['Pot Hotspot', 600, '📶'],
  ['Esok Sekolah', 700, '🏫'],
  ['La Grande Combinasion', 900, '🧩'],
  ['Dragon Cannelloni', 1100, '🐉'],
  ['Hydra Dragon Cannelloni', 1350, '🐲'],
  ['Nuclearo Dinossauro', 1600, '🦖'],
  ['Los Combinasionas', 2500, '💠'],
  ['Griffin', 5000, '🦅'],
  ['Strawberry Elephant', 50000, '🍓'],
  ['Skibidi Toilet', 16500, '🚽'],
  // added 01.10.2026 from the price list
  ['Lavaka', 5, '🌋'],
  ['Candy Slap', 7, '🍬'],
  ['Divane Slap', 9, '🛋️'],
  ['Spaghetti Tualetti', 10, '🍝'],
  ['Ketupat Kepat', 20, '🍙'],
  ['Ketchuru and Musturu', 22, '🌭'],
  ['Ventoliero Pavonero', 30, '🦚'],
  ['Lava Blaster', 31, '🔥'],
  ['Los Planitos', 32, '✈️'],
  ['Los Bros', 35, '👬'],
  ['Los Mariachis', 39, '🎺'],
  ['W or L', 40, '🎲'],
  ['Eviledon', 42, '😈'],
  ['Gold Gold Gold', 46, '🪙'],
  ['La Ginger Sekolah', 47, '🫚'],
  ['Los Primos', 55, '👯'],
  ['Pizza and Ranch', 57, '🫙'],
  ['Los Tacoritas', 95, '🌮'],
  ['La Food Combinasion', 103, '🍱'],
  ['Pop Pop Petalini', 105, '🌺'],
  ['Lovin Rose', 110, '🌹'],
  ['La Taco Combinasion', 125, '🌯'],
  ['Popcuru and Fizzuru', 140, '🍿'],
  ['Celestial Pegasus', 140, '🦄'],
  ['Cerberus', 150, '🐕'],
  ['Fragola La La La', 160, '🍰'],
  ['Globa Steppa', 234, '🌍'],
  ['Reinito Sleighito', 280, '🦌'],
  ['Los Amigos', 320, '🤝'],
  ['Bearito Cabinito', 350, '🐻'],
  ['Examen Bros', 400, '📝'],
  ['La Breakfast Combinasion', 450, '🍳'],
  ['Rico Dinero', 500, '💰'],
  ['Dug Dug Dug', 500, '🕳️'],
  ['Rainbow Hammer', 520, '🌈'],
  ['Foxini Lanternini', 540, '🦊'],
  ['Venuspino', 555, '🪐'],
  ['Los Chillis', 600, '🌶️'],
  ['Bumbatron', 625, '🤖'],
  ['Rosey and Teddy', 680, '🧸'],
  ['La Casa Boo', 721, '👻'],
  ['Ketupat Bros', 810, '🧺'],
  ['Bloodmoon Hammer', 1170, '🔨'],
  ['Grabatron', 1300, '🦾'],
  ['Jelly Moby', 1482, '🍮'],
  ['Bunny and Eggy', 1606, '🐣'],
  ['Pancake and Syrup', 1850, '🥞'],
  ['Tirillikalika Tirillikalako', 1850, '🎵'],
  ['Hydra Bunny', 2400, '🐇'],
  ['La Supreme Combinasion', 2450, '👑'],
  ['Kraken', 2500, '🦑'],
  ['Moby Bros', 2600, '🐳'],
  ['Digi Narwhal', 2700, '💾'],
  ['Fishino Clownino', 3000, '🐠'],
  ['Kalika Bros', 4000, '🎭'],
  ['Orchidox', 6000, '🪻'],
  ['Love Love Bear', 8500, '💕'],
  ['Arcadragon', 12500, '🕹️'],
  ['Elefanto Frigo', 13500, '🧊'],
  ['John Pork', 18500, '🐖'],
  ['Meowl', 20000, '🦉'],
];

// slug, [ru, uk, en], price, emoji, color, rtp (or fixed EV for free), items
const CASES = [
  ['free', ['FREE кейс', 'FREE кейс', 'FREE case'], 0, '🎁', '#22c55e', { ev: 8 }, [
    'Noobini Pizzanini', 'Lirilì Larilà', 'Tim Cheese', 'Fluriflura', 'Talpa Di Fero', 'Svinina Bombardino',
    'Pipi Kiwi', 'Trippi Troppi', 'Tung Tung Tung Sahur', 'Gangster Footera', 'Boneca Ambalabu', 'Tric Trac Baraboom',
    'Cappuccino Assassino', 'Bananita Dolphinita', 'Salamino Penguino', 'Chimpanzini Bananini',
    'Garama and Madundung', "Cupid's Wings", 'Cacto Hipopotamo', 'Lavaka', 'Candy Slap', 'Divane Slap',
    'Spaghetti Tualetti', 'Ketupat Kepat', 'Ketchuru and Musturu',
  ]],
  ['noob', ['Нуб кейс', 'Нуб кейс', 'Noob case'], 10, '🔰', '#94a3b8', { rtp: 0.9 }, [
    'Noobini Pizzanini', 'Lirilì Larilà', 'Fluriflura', 'Svinina Bombardino', 'Trippi Troppi', 'Tung Tung Tung Sahur',
    'Bandito Bobritto', 'Boneca Ambalabu', 'Ta Ta Ta Ta Sahur', 'Tric Trac Baraboom', 'Cappuccino Assassino',
    'Brr Brr Patapim', 'Trulimero Trulicina', 'Bananita Dolphinita', 'Perochello Lemonchello', 'Avocadini Guffo',
    'Salamino Penguino', 'Chimpanzini Bananini', 'Garama and Madundung', 'Wave Rider', 'Bombardiro Crocodilo',
    'Cacto Hipopotamo', 'Lavaka', 'Candy Slap', 'Divane Slap', 'Spaghetti Tualetti', 'Ketupat Kepat',
    'Ketchuru and Musturu', 'Los Bros', 'W or L',
  ]],
  ['pro', ['Про кейс', 'Про кейс', 'Pro case'], 25, '⭐', '#3b82f6', { rtp: 0.9 }, [
    'Tung Tung Tung Sahur', 'Boneca Ambalabu', 'Tric Trac Baraboom', 'Brr Brr Patapim', 'Bambini Crostini',
    'Perochello Lemonchello', 'Brri Brri Bicus Dicus Bombicus', 'Salamino Penguino', 'Burbaloni Loliloli',
    'Ballerina Cappuccina', 'Chef Crabracadabra', 'Glorbo Fruttodrillo', 'Strawberelli Flamingelli', 'Frigo Camelo',
    'La Secret Combinasion', "Witch's Broom", 'Cash or Card', "Santa's Sleigh", 'Burguro and Fryuro', 'Capitano Moby',
    'Tralalero Tralala', 'Lionel Cactuseli', 'Cocosini Mama', 'Rhino Toasterino', 'Spaghetti Tualetti',
    'Ketchuru and Musturu', 'Ventoliero Pavonero', 'Lava Blaster', 'Los Planitos', 'Los Bros', 'Los Mariachis',
    'W or L', 'Eviledon', 'Gold Gold Gold', 'La Ginger Sekolah', 'Los Primos', 'Pizza and Ranch', 'Los Tacoritas',
    'Pop Pop Petalini', 'Lovin Rose',
  ]],
  ['fish', ['Рыбный кейс', 'Рибний кейс', 'Fish case'], 65, '🐟', '#06b6d4', { rtp: 0.9 }, [
    'Trulimero Trulicina', 'Bananita Dolphinita', 'Salamino Penguino', 'Chef Crabracadabra',
    'Blueberrinni Octopusini', 'Strawberelli Flamingelli', 'Wave Rider', 'Bombardiro Crocodilo', 'Capitano Moby',
    'Orcalero Orcala', 'Tralalero Tralala', 'Los Tralaleritos', 'Graipuss Medussi', 'Jelly Moby', 'Kraken',
    'Moby Bros', 'Digi Narwhal', 'Fishino Clownino',
  ]],
  ['dlc', ['DLC кейс', 'DLC кейс', 'DLC case'], 200, '🎮', '#8b5cf6', { rtp: 0.9 }, [
    'Cash or Card', "Santa's Sleigh", 'Burguro and Fryuro', 'Cavallo Virtuoso', 'Gorillo Watermelondrillo',
    'Tigrilini Watermelini', 'Capitano Moby', 'Cocofanto Elefanto', 'Boppin Bunny', 'Cooki and Milki',
    'Girafa Celestre', 'Matteo', 'La Vacca Saturno Saturnita', 'Los Tralaleritos', 'Trenostruzzo Turbo 3000',
    'La Grande Combinasion', 'Dragon Cannelloni', 'Los Tacoritas', 'La Food Combinasion', 'Pop Pop Petalini',
    'Lovin Rose', 'La Taco Combinasion', 'Popcuru and Fizzuru', 'Celestial Pegasus', 'Globa Steppa',
    'Reinito Sleighito', 'Los Amigos', 'Bearito Cabinito', 'Examen Bros',
  ]],
  ['halloween', ['Хэллоуин кейс', 'Гелловін кейс', 'Halloween case'], 250, '🎃', '#f97316', { rtp: 0.9 }, [
    "Witch's Broom", 'Bombombini Gusini', 'Boppin Bunny', 'Cooki and Milki', 'Spooky and Pumpky', 'Odin Din Din Dun',
    'Matteo', 'Gattatino Neonino', 'La Vacca Saturno Saturnita', 'Chimpanzini Spiderini', 'Graipuss Medussi',
    'Pot Hotspot', 'Esok Sekolah', 'Dragon Cannelloni', 'Eviledon', 'Cerberus', 'Foxini Lanternini', 'La Casa Boo',
    'Bloodmoon Hammer',
  ]],
  ['summer', ['Летний кейс', 'Літній кейс', 'Summer case'], 350, '☀️', '#facc15', { rtp: 0.9 }, [
    'Orangutini Ananassini', 'Wave Rider', 'Cavallo Virtuoso', 'Gorillo Watermelondrillo', 'Tigrilini Watermelini',
    'Capitano Moby', 'Orcalero Orcala', 'Girafa Celestre', 'Gattatino Neonino', 'La Vacca Saturno Saturnita',
    'Los Tralaleritos', 'Graipuss Medussi', 'Trenostruzzo Turbo 3000', 'Esok Sekolah', 'La Grande Combinasion',
    'Hydra Dragon Cannelloni', 'Cocosini Mama', 'Pop Pop Petalini', 'Popcuru and Fizzuru', 'Fragola La La La',
    'Globa Steppa', 'Los Amigos', 'La Breakfast Combinasion', 'Rainbow Hammer', 'Venuspino', 'Los Chillis',
    'Orchidox',
  ]],
  ['dragon', ['Драгон кейс', 'Драгон кейс', 'Dragon case'], 450, '🐉', '#ef4444', { rtp: 0.9 }, [
    'Bombardiro Crocodilo', 'Odin Din Din Dun', 'Matteo', 'La Vacca Saturno Saturnita', 'Chimpanzini Spiderini',
    'Los Tralaleritos', 'Graipuss Medussi', 'Trenostruzzo Turbo 3000', 'Pot Hotspot', 'Esok Sekolah',
    'La Grande Combinasion', 'Dragon Cannelloni', 'Hydra Dragon Cannelloni', 'Nuclearo Dinossauro',
    'Los Combinasionas', 'Griffin', 'Cerberus', 'Examen Bros', 'Rico Dinero', 'Dug Dug Dug', 'Los Chillis',
    'Bumbatron', 'Ketupat Bros', 'Bloodmoon Hammer', 'Grabatron', 'Tirillikalika Tirillikalako', 'Hydra Bunny',
    'Arcadragon',
  ]],
  ['mushroom', ['Грибной кейс', 'Грибний кейс', 'Mushroom case'], 750, '🍄', '#d946ef', { rtp: 0.9 }, [
    'Matteo', 'La Vacca Saturno Saturnita', 'Chimpanzini Spiderini', 'Los Tralaleritos', 'Graipuss Medussi',
    'Trenostruzzo Turbo 3000', 'Pot Hotspot', 'Esok Sekolah', 'La Grande Combinasion', 'Dragon Cannelloni',
    'Hydra Dragon Cannelloni', 'Nuclearo Dinossauro', 'Los Combinasionas', 'Griffin', 'Strawberry Elephant',
    'Bearito Cabinito', 'La Breakfast Combinasion', 'Rico Dinero', 'Dug Dug Dug', 'Rainbow Hammer',
    'Foxini Lanternini', 'Venuspino', 'Bumbatron', 'Rosey and Teddy', 'Ketupat Bros', 'Grabatron', 'Jelly Moby',
    'Bunny and Eggy', 'Pancake and Syrup', 'La Supreme Combinasion', 'Kalika Bros',
  ]],
  ['griffin', ['Грифон кейс', 'Грифон кейс', 'Griffin case'], 2000, '🦅', '#f59e0b', { rtp: 0.9 }, [
    'Pot Hotspot', 'Esok Sekolah', 'La Grande Combinasion', 'Dragon Cannelloni', 'Hydra Dragon Cannelloni',
    'Nuclearo Dinossauro', 'Los Combinasionas', 'Griffin', 'Strawberry Elephant', 'Skibidi Toilet', 'Grabatron',
    'Jelly Moby', 'Bunny and Eggy', 'Pancake and Syrup', 'Tirillikalika Tirillikalako', 'Hydra Bunny',
    'La Supreme Combinasion', 'Kraken', 'Moby Bros', 'Digi Narwhal', 'Fishino Clownino', 'Kalika Bros', 'Orchidox',
    'Love Love Bear', 'Arcadragon', 'Elefanto Frigo', 'John Pork', 'Meowl',
  ]],
];

const byName = new Map(ITEMS.map(([name, value, emoji], i) => [name, { id: i + 1, name, value, emoji }]));

function evFor(values, alpha) {
  let w = 0, ev = 0;
  for (const v of values) { const x = v ** -alpha; w += x; ev += x * v; }
  return ev / w;
}

function solveAlpha(values, target) {
  // EV decreases monotonically as alpha grows
  let lo = -5, hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (evFor(values, mid) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function roundChances(raw) {
  // 3 decimals in percent, every item keeps at least 0.001%
  const out = raw.map((p) => Math.max(0.001, Math.round(p * 1000) / 1000));
  const diff = Math.round((100 - out.reduce((a, b) => a + b, 0)) * 1000) / 1000;
  const iMax = out.indexOf(Math.max(...out));
  out[iMax] = Math.round((out[iMax] + diff) * 1000) / 1000;
  return out;
}

const cases = [];
let sort = 0;
for (const [slug, names, price, emoji, color, target, itemNames] of CASES) {
  const items = itemNames.map((n) => {
    const it = byName.get(n);
    if (!it) throw new Error(`Unknown item ${n} in ${slug}`);
    return it;
  });
  const values = items.map((i) => i.value);
  const targetEv = target.ev ?? price * target.rtp;
  const alpha = solveAlpha(values, targetEv);
  const weights = values.map((v) => v ** -alpha);
  const total = weights.reduce((a, b) => a + b, 0);
  const chances = roundChances(weights.map((w) => (w / total) * 100));
  const ev = items.reduce((s, it, i) => s + it.value * chances[i] / 100, 0);
  cases.push({
    slug, name_ru: names[0], name_uk: names[1], name_en: names[2], price, is_free: price === 0,
    emoji, color, sort: sort++,
    items: items.map((it, i) => ({ item: it.name, chance: chances[i] })),
  });
  const top = items.map((it, i) => `${it.name}=${chances[i]}%`);
  console.log(`${slug.padEnd(9)} price=${String(price).padStart(4)} alpha=${alpha.toFixed(3)} EV=${ev.toFixed(2)} RTP=${price ? (ev / price * 100).toFixed(2) + '%' : '-'} sum=${chances.reduce((a, b) => a + b, 0).toFixed(3)}`);
  console.log('   rarest:', top.slice(-3).join(', '), '| most common:', top.slice(0, 2).join(', '));
}

const seed = {
  items: ITEMS.map(([name, value, emoji]) => ({ name, value, emoji })),
  cases,
};
writeFileSync(path.join(here, '..', 'src', 'seed-data.json'), JSON.stringify(seed, null, 1) + '\n');
console.log(`\nWrote ${seed.items.length} items and ${cases.length} cases.`);
