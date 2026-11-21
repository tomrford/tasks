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
  "able", "active", "acute", "adept", "agile", "airy", "alert", "alive",
  "aloof", "amused", "ancient", "angled", "annual", "antique", "apricot", "aquatic",
  "arched", "ardent", "arid", "ashen", "atomic", "auburn", "august", "avid",
  "awake", "aware", "balmy", "bamboo", "bare", "barren", "basic", "beaming",
  "berry", "better", "big", "bitter", "black", "blank", "bleak", "blissful",
  "blond", "blunt", "blushing", "booming", "bouncy", "bound", "brave", "brief",
  "broad", "broken", "brown", "bubbly", "burly", "burning", "busy", "candid",
  "canny", "casual", "central", "ceramic", "charming", "cheery", "chief", "chilly",
  "chipper", "choice", "chrome", "civic", "civil", "classic", "clean", "close",
  "cloudy", "clover", "coarse", "cold", "comely", "comic", "common", "compact",
  "cool", "cosmic", "cotton", "cozy", "crafty", "craggy", "creamy", "crinkled",
  "crooked", "curious", "curly", "current", "custom", "cute", "dainty", "damp",
  "dark", "dashing", "dazzling", "dear", "decent", "deluxe", "dense", "dewy",
  "direct", "distant", "diverse", "dizzy", "double", "downy", "dreamy", "dry",
  "dual", "dull", "dusty", "dynamic", "early", "easy", "edgy", "eerie",
  "elated", "elegant", "elfin", "elite", "empty", "endless", "entire", "epic",
  "equal", "errant", "eternal", "ethereal", "exact", "exotic", "expert", "extra",
  "faded", "famous", "fancy", "far", "fawn", "feisty", "festive", "fickle",
  "firm", "first", "fit", "fixed", "flaky", "flashy", "flat", "fleecy",
  "fleet", "fluid", "fluffy", "fluent", "flushed", "flying", "foamy", "focal",
  "fond", "formal", "frank", "free", "fresh", "friendly", "frigid", "frisky",
  "frosted", "frothy", "frugal", "full", "funny", "furry", "fuzzy", "gallant",
  "game", "gaunt", "genial", "giant", "giddy", "gifted", "ginger", "glossy",
  "good", "graceful", "grainy", "grassy", "gravel", "great", "groovy", "grounded",
  "growing", "gusty", "handy", "hearty", "heavy", "hefty", "heroic", "hilly",
  "hoary", "honest", "honey", "hopeful", "hot", "huge", "humid", "hushed",
  "husky", "hybrid", "ideal", "idle", "immense", "inert", "inner", "intact",
  "intense", "jaunty", "jazzy", "jet", "jovial", "joyful", "joyous", "juicy",
  "jumbo", "junior", "just", "khaki", "kindly", "kinetic", "kingly", "knitted",
  "knowing", "lacquer", "lanky", "large", "lasting", "lavish", "lawful", "leafy",
  "lean", "leaping", "learned", "leather", "level", "lilac", "limber", "lime",
  "linear", "liquid", "lithe", "little", "living", "local", "lofty", "logical",
  "long", "loose", "loud", "lovely", "loving", "low", "loyal", "lucky",
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
  "abbey", "agate", "albatross", "alcove", "alley", "almond", "alpaca", "amber",
  "amulet", "antelope", "antler", "apple", "apricot", "arbor", "arcade", "arena",
  "armada", "armor", "arroyo", "ash", "aster", "atoll", "attic", "aurora",
  "autumn", "awning", "axle", "azalea", "badge", "bale", "ballad", "balloon",
  "bamboo", "bandit", "banjo", "bank", "banner", "banyan", "barge", "bark",
  "barn", "barrel", "barrow", "basalt", "basin", "basket", "bass", "bastion",
  "baton", "bay", "bayou", "beach", "bead", "beaker", "beam", "bean",
  "beetle", "belfry", "bench", "bight", "birch", "bird", "bistro", "blanket",
  "blaze", "blimp", "bloom", "blossom", "board", "boat", "bobcat", "boulder",
  "bow", "bowl", "box", "bramble", "branch", "brazier", "breeze", "briar",
  "brick", "bridge", "bridle", "brig", "brim", "brine", "brooch", "broth",
  "buck", "buckle", "bud", "buffalo", "bugle", "bulb", "bull", "bunker",
  "buoy", "burrow", "bush", "butte", "button", "cabin", "cable", "cactus",
  "cadence", "cage", "caldera", "calf", "calyx", "camber", "camera", "camp",
  "canary", "canopy", "canton", "canvas", "cap", "capstan", "caravan", "caribou",
  "carnation", "carp", "carriage", "carrot", "cart", "cascade", "case", "cask",
  "castle", "cat", "catamaran", "catch", "cathedral", "catkin", "cattle", "causeway",
  "cave", "cavern", "cellar", "chalet", "chalk", "chamber", "chamois", "channel",
  "chapel", "charger", "chariot", "charm", "chart", "chasm", "cheetah", "cherry",
  "chest", "chestnut", "chickadee", "chime", "chimney", "chipmunk", "chord", "chorus",
  "chute", "cicada", "cider", "circle", "circuit", "cistern", "citadel", "citrus",
  "clam", "clasp", "claw", "clay", "clearing", "cleft", "cleric", "clipper",
  "cloak", "clock", "cloister", "clove", "coach", "coal", "coast", "coat",
  "cobble", "cobra", "cockle", "cocoa", "cod", "coffer", "cog", "coil",
  "coin", "collar", "collie", "colt", "column", "comb", "conch", "cone",
  "conifer", "conduit", "copper", "cord", "core", "corgi", "cork", "cormorant",
  "corn", "corner", "cornet", "corral", "corsair", "cottage", "cotton", "couch",
  "council", "country", "courier", "court", "cow", "coyote", "crab", "cradle",
  "craft", "crag", "cranberry", "crate", "crater", "crayfish", "crayon", "creel",
  "crevice", "cricket", "crocus", "croft", "crook", "crop", "cross", "crouton",
  "crucible", "cruiser", "crumb", "crust", "crypt", "cub", "cube", "cuckoo",
  "cuff", "culvert", "cup", "cupola", "curb", "curlew", "currant", "current",
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
  "abide", "act", "adapt", "add", "adjust", "admire", "adopt", "adore",
  "adorn", "advance", "advise", "affirm", "afford", "aid", "aim", "air",
  "alert", "align", "allay", "allow", "ally", "alter", "amass", "amaze",
  "amble", "amend", "amuse", "anchor", "angle", "annex", "answer", "appeal",
  "appear", "apply", "arch", "arise", "arm", "arrive", "ask", "aspire",
  "assay", "assert", "assess", "assign", "assist", "assure", "attach", "attain",
  "attend", "attest", "attune", "audit", "auger", "avail", "avert", "avoid",
  "await", "awake", "awaken", "award", "axe", "back", "badge", "baffle",
  "bag", "bail", "bait", "bake", "balance", "bale", "ball", "band",
  "bang", "bank", "banter", "bar", "bare", "bargain", "barge", "bark",
  "barrel", "barter", "base", "bash", "baste", "bat", "batch", "bathe",
  "batten", "batter", "battle", "bawl", "bay", "beach", "beacon", "bead",
  "bear", "beat", "beckon", "bed", "beep", "befit", "begin", "behold",
  "belay", "bell", "bellow", "belong", "belt", "bench", "bequeath", "berth",
  "beset", "best", "bestow", "bet", "betide", "better", "bevel", "bias",
  "bid", "bide", "bike", "bill", "billow", "bind", "bird", "bisect",
  "bite", "blare", "blast", "bleach", "blend", "bless", "blight", "blind",
  "bliss", "blitz", "block", "blossom", "blot", "blow", "bluff", "blunt",
  "blur", "blurt", "blush", "board", "boast", "boat", "bob", "bode",
  "boggle", "boil", "bolster", "bond", "bone", "bonus", "book", "boom",
  "boost", "boot", "border", "bore", "borrow", "boss", "calm", "care",
  "bottle", "bottom", "bounce", "bow", "bower", "bowl", "box", "brace",
  "brag", "brake", "brand", "brave", "brawl", "bray", "breach", "bread",
  "break", "claim", "breathe", "breed", "brew", "bribe", "brick", "bridle",
  "brief", "brighten", "brim", "bring", "bristle", "broach", "broaden", "broil",
  "broker", "brood", "brook", "broom", "browse", "bruise", "brush", "bubble",
  "buck", "bucket", "buckle", "bud", "budge", "budget", "buff", "buffer",
  "buffet", "bugle", "bulge", "bulk", "bull", "bumble", "bump", "bunch",
  "bundle", "bunk", "bunker", "bunt", "buoy", "burden", "burn", "burnish",
  "carry", "burrow", "bury", "bus", "bush", "busk", "bust", "bustle",
  "busy", "center", "butt", "butter", "button", "buy", "buzz", "bypass",
  "chant", "cabin", "cable", "cache", "cackle", "caddy", "cheer", "cage",
] as const;

const USER_CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomUint32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randomUint32() % arr.length]!;
}

/**
 * Generates a memorable 3-word room UID like `amber-falcon-drift`.
 * 512 adjectives * 512 nouns * 512 verbs = 134,217,728 combinations (27 bits).
 */
export function generateRoomUid(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(VERBS)}`;
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
