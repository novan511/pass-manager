/** Client-side password & passphrase generator. */

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/";

const EFF_WORDS = [
  "correct","horse","battery","staple","anchor","amber","arrow","autumn",
  "beacon","bishop","breeze","canyon","cedar","cipher","clover","compass",
  "coral","crater","crystal","dancer","delta","desert","diamond","dolphin",
  "eagle","ember","equinox","falcon","fjord","galaxy","garden","glacier",
  "granite","harbor","harvest","horizon","indigo","ivory","jaguar","jungle",
  "krypton","lantern","lemon","lunar","lyric","magnet","maple","meadow",
  "meteor","mirage","mocha","nebula","nickel","nomad","north","octave",
  "onyx","orbit","orbit","orchid","otter","panda","pebble","pepper",
  "phoenix","planet","plasma","plume","prairie","quartz","rabbit","radar",
  "raven","river","rocket","saffron","sailor","scarlet","shadow","silver",
  "sonar","sparrow","summit","sunset","tempest","thunder","timber","topaz",
  "tornado","trail","tulip","umbrella","valley","velvet","violet","walnut",
  "whisper","willow","winter","wonder","xenon","yonder","zebra","zephyr",
];

function randInt(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n = 0;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return n % max;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(arr.length)];
}

function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

export type GeneratorOptions = {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
};

export function generatePassword(opts: GeneratorOptions): string {
  let pool = "";
  if (opts.lower) pool += LOWER;
  if (opts.upper) pool += UPPER;
  if (opts.digits) pool += DIGITS;
  if (opts.symbols) pool += SYMBOLS;
  if (!pool) pool = LOWER;

  const chars: string[] = [];
  // Guarantee at least one of each selected class when length allows.
  const classes: string[] = [];
  if (opts.lower) classes.push(LOWER);
  if (opts.upper) classes.push(UPPER);
  if (opts.digits) classes.push(DIGITS);
  if (opts.symbols) classes.push(SYMBOLS);
  for (const cls of classes) {
    if (chars.length < opts.length) chars.push(pick(cls.split("")));
  }
  while (chars.length < opts.length) chars.push(pick(pool.split("")));
  return shuffle(chars).join("");
}

export type PassphraseOptions = {
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
};

export function generatePassphrase(opts: PassphraseOptions): string {
  const picked: string[] = [];
  for (let i = 0; i < opts.words; i++) {
    let w = pick(EFF_WORDS);
    if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1);
    picked.push(w);
  }
  let phrase = picked.join(opts.separator);
  if (opts.includeNumber) {
    phrase += opts.separator + randInt(90) + 10;
  }
  return phrase;
}
