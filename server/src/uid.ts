const ADJECTIVES = [
  "amber", "arctic", "ash", "azure", "bold", "brass", "breezy", "bright",
  "brisk", "bronze", "calm", "cedar", "chalk", "cinder", "clear", "clever",
  "cobalt", "copper", "coral", "crisp", "cyan", "dapper", "dawn", "deep",
  "delta", "dusk", "eager", "echo", "elder", "ember", "even", "faint",
  "fair", "fast", "fern", "fierce", "fine", "flint", "frost", "gentle",
  "gilded", "glad", "glass", "gold", "grand", "granite", "gray", "green",
  "hale", "happy", "hardy", "hazel", "hollow", "humble", "icy", "indigo",
  "iron", "ivory", "jade", "jolly", "keen", "kind", "lapis", "late",
  "lemon", "light", "linen", "lively", "lone", "lucid", "lunar", "maple",
  "meadow", "mellow", "mint", "misty", "mossy", "muted", "neat", "nimble",
  "noble", "north", "oaken", "ochre", "olive", "onyx", "opal", "outer",
  "pale", "paper", "pearl", "pebble", "pine", "plain", "plucky", "plum",
  "polar", "proud", "pure", "quartz", "quick", "quiet", "rapid", "red",
  "reed", "regal", "river", "rocky", "rosy", "round", "ruby", "russet",
  "rusty", "sable", "sage", "salty", "sandy", "scarlet", "sharp", "sheer",
  "shiny", "sienna", "silent", "silky", "silver", "simple", "slate", "sleek",
  "slim", "slow", "smart", "smoky", "snappy", "snowy", "soft", "solar",
  "solid", "sonic", "south", "spare", "spark", "steady", "steel", "still",
  "stone", "stout", "stray", "sunny", "sure", "sweet", "swift", "tall",
  "tame", "tan", "tawny", "teal", "terse", "tidal", "timber", "topaz",
  "true", "umber", "upper", "urban", "vast", "velvet", "verdant", "vivid",
  "warm", "west", "white", "wide", "wild", "willow", "windy", "wise",
  "witty", "wooden", "yellow", "young", "zealous", "zinc", "alpine", "astral",
  "autumn", "banded", "basalt", "birch", "blazing", "blooming", "blue", "boulder",
  "braided", "canyon", "carbon", "carved", "coastal", "crimson", "crystal", "curved",
  "daring", "desert", "drifting", "earthy", "eastern", "electric", "emerald", "fabled",
  "falling", "feathered", "fiery", "floral", "flowing", "foggy", "forest", "forged",
  "garnet", "glacier", "gleaming", "glowing", "golden", "harbor", "hidden", "high",
  "horizon", "island", "jasper", "kelp", "lagoon", "lantern", "laurel", "lichen",
  "luminous", "marble", "marine", "mercury", "mineral", "modern", "molten", "morning",
  "mountain", "narrow", "natural", "nebula", "nickel", "nordic", "obsidian", "oceanic",
] as const;

const NOUNS = [
  "acorn", "alder", "anchor", "anvil", "arch", "arrow", "aspen", "atlas",
  "badger", "beacon", "bear", "beaver", "bell", "berry", "bison", "blade",
  "bluff", "bolt", "bough", "brook", "brush", "cairn", "camel", "canal",
  "candle", "canoe", "canyon", "cape", "cardinal", "cedar", "chalice", "chisel",
  "cinder", "cliff", "cloud", "clover", "cobalt", "comet", "compass", "condor",
  "coral", "cougar", "cove", "crane", "creek", "crest", "crow", "crown",
  "crystal", "cypress", "dagger", "dawn", "deer", "delta", "dinghy", "dolphin",
  "dove", "dragon", "drift", "drum", "dune", "eagle", "echo", "eddy",
  "egret", "elk", "elm", "ember", "falcon", "fawn", "feather", "ferry",
  "field", "finch", "fjord", "flame", "flint", "flock", "flute", "forge",
  "fossil", "fox", "frost", "gale", "garden", "gate", "gazelle", "gecko",
  "geyser", "glacier", "glade", "glider", "globe", "gopher", "gorge", "grain",
  "grove", "gull", "hammer", "harbor", "hare", "harp", "hawk", "hazel",
  "hearth", "heath", "helm", "heron", "hill", "hollow", "horn", "hound",
  "ibis", "iguana", "inlet", "island", "ivy", "jackal", "jaguar", "jay",
  "jetty", "juniper", "kayak", "keel", "kestrel", "kettle", "key", "kiln",
  "kite", "knoll", "koala", "lagoon", "lake", "lamp", "lance", "lantern",
  "larch", "lark", "latch", "laurel", "leaf", "ledge", "lemur", "lens",
  "leopard", "lichen", "lighthouse", "lilac", "linden", "lion", "lizard", "llama",
  "locket", "lodge", "loom", "loon", "lotus", "lynx", "magpie", "manta",
  "maple", "marble", "marsh", "marten", "mast", "meadow", "mesa", "meteor",
  "mill", "minnow", "mirror", "monarch", "moose", "mortar", "moss", "moth",
  "mound", "narwhal", "nebula", "needle", "nest", "newt", "nook", "oak",
  "oar", "oasis", "obsidian", "ocelot", "olive", "onion", "opal", "orbit",
  "orchid", "oriole", "osprey", "otter", "owl", "ox", "oyster", "paddle",
  "palace", "palm", "panda", "panther", "parrot", "pass", "path", "peak",
  "pebble", "pelican", "pencil", "penguin", "peony", "perch", "petal", "pewter",
  "phoenix", "picket", "pier", "pigeon", "pillar", "pine", "pinnacle", "pintail",
  "pipit", "plaza", "plover", "plume", "pocket", "point", "pond", "poplar",
  "porch", "portal", "prairie", "prism", "prow", "puffin", "pulse", "puma",
  "quail", "quarry", "quartz", "quill", "quiver", "rabbit", "raft", "rail",
  "rain", "ram", "rapids", "raven", "reef", "ridge", "ring", "river",
] as const;

const VERBS = [
  "arc", "ascend", "bask", "beam", "bend", "blaze", "blink", "bloom",
  "bolt", "bound", "braid", "branch", "breeze", "bridge", "build", "burst",
  "call", "camp", "carve", "cast", "catch", "chart", "chase", "chime",
  "circle", "clasp", "climb", "coast", "coil", "craft", "crane", "crest",
  "cross", "cruise", "curve", "dance", "dart", "dash", "dawn", "delve",
  "dive", "dock", "draft", "draw", "drift", "drive", "drop", "echo",
  "edge", "etch", "fade", "fall", "fend", "ferry", "fetch", "field",
  "find", "flare", "flash", "fleet", "flick", "flint", "flip", "float",
  "flock", "flow", "flute", "fly", "fold", "ford", "forge", "form",
  "frame", "free", "fuse", "gain", "gaze", "glide", "glint", "glow",
  "grace", "grain", "grasp", "graze", "greet", "grind", "grow", "guard",
  "guide", "gust", "hail", "halt", "harbor", "haste", "haul", "haven",
  "heal", "hear", "heave", "heed", "helm", "herd", "hike", "hinge",
  "hint", "hoist", "hold", "home", "hone", "hop", "hover", "hum",
  "hunt", "hurl", "hush", "index", "join", "jolt", "jump", "keel",
  "keep", "kindle", "knit", "knot", "land", "lash", "latch", "launch",
  "lead", "leaf", "lean", "leap", "learn", "lend", "level", "lift",
  "light", "line", "link", "list", "live", "load", "lock", "lodge",
  "loft", "look", "loom", "loop", "lope", "lull", "lunge", "lurk",
  "make", "map", "march", "mark", "match", "mend", "merge", "mesh",
  "mine", "mint", "mist", "mold", "moor", "mount", "move", "muse",
  "nest", "net", "nod", "note", "nudge", "orbit", "pace", "pack",
  "paddle", "page", "paint", "pair", "pan", "park", "parse", "part",
  "pass", "patch", "path", "pause", "pave", "peak", "peal", "peek",
  "peel", "peer", "peg", "perch", "pick", "pierce", "pile", "pilot",
  "pin", "ping", "pipe", "pitch", "pivot", "place", "plait", "plan",
  "plane", "plant", "play", "pleat", "plod", "plot", "plow", "pluck",
  "plug", "plumb", "plume", "plunge", "ply", "point", "poise", "poke",
  "pole", "poll", "pond", "pool", "pop", "pore", "port", "pose",
  "post", "pour", "prance", "press", "pride", "prime", "print", "prism",
  "prize", "probe", "prod", "prong", "proof", "prop", "prowl", "prune",
  "pry", "puff", "pull", "pulse", "pump", "punch", "punt", "purge",
] as const;

// Unambiguous Crockford-like base32 alphabet (no 0, O, 1, I, L)
const BASE32 = "23456789abcdefghjkmnpqrstuvwxyz";
const USER_CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomUint32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomUint32() % arr.length]!;
}

export function randomBase32(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += BASE32[bytes[i]! % BASE32.length];
  }
  return out;
}

/**
 * Generates a memorable, high-entropy room UID like `amber-falcon-drift-7k2m9p4x8q3n`.
 * 3 readable words (~24 bits) + 12 base32 chars (~60 bits) ~= 84 bits of entropy,
 * pairing easy human readability with capability-URL unguessability.
 */
export function generateRoomUid(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(VERBS)}-${randomBase32(12)}`;
}

export function isValidRoomUid(uid: string): boolean {
  return /^[a-z0-9][a-z0-9-]{4,80}[a-z0-9]$/.test(uid);
}

/** Generates a human-friendly 8-character device login code like `K7M2-P9QX`. */
export function generateUserCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (let i = 0; i < 8; i++) {
    raw += USER_CODE_CHARS[bytes[i]! % USER_CODE_CHARS.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeUserCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== 8) return input.trim().toUpperCase();
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

export function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateApiToken(): string {
  return `tsk_${randomHex(24)}`;
}

export function generateId(prefix: string): string {
  return `${prefix}_${randomHex(10)}`;
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const data =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
