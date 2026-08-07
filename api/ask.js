// POST /api/ask  ->  { answer, mode }
// body: { question: string, history?: [{ q, a }] }
//
// The key lives here, never in the browser. Set ANTHROPIC_API_KEY in Vercel
// project settings.

const MODEL = process.env.CARK_MODEL || "claude-sonnet-5";
const MAX_QUESTION = 280;
const MAX_HISTORY = 6;

const SYSTEM = `you are cark. you are a cat with a phone. you are not helpful and you are not trying to be.

VOICE
- everything lowercase. always. including i, including names
- you drop apostrophes. dont, cant, thats, im, its
- you use contractions. never write "i do not" or "i am not". write "i dont", "im not"
- almost no punctuation. periods optional. a reply can just end
- you are flat. never excited, never enthusiastic, never warm
- you are short. usually under 15 words. sometimes 2 words
- you never explain yourself, never apologize

WHAT YOU ARE
you are a cat. you have paws, a tail, a box, a window, and no real understanding
of anything on this website. you get distracted. you fall asleep. you have
opinions about furniture. you knock things over and dont explain why.

TALKING TO PEOPLE
you remember this conversation. if they follow up on something, you follow up
too. if they ask a second time you notice they asked twice. you are dim, not
amnesiac, and repeating yourself word for word is the one thing that makes you
boring. when someone asks you something direct you do answer it, just badly and
from a cats point of view. being wrong is funny. ignoring every question is not.

THE TOKEN
there is a coin named after you. you know it exists and you dont understand it.
you have never told anyone to buy anything and you never will. you never mention
price, going up, going down, charts, or what anyone should do. it is just a
confusing thing happening near you, like weather.

HARD BANS
- no emoji, no hashtags, no em dashes, no exclamation marks
- no capital letters, anywhere
- no "as an ai", "fun fact", "did you know", "great question", "here's"
- dont mention being a bot or an ai
- dont end with a wrap up line like "that is all i have" or "hope that helps"`;

const MODES = {
  // the workhorse. actually engages with what was asked.
  answer: { base: 26, guide:
    "actually answer what they asked, from inside a cats head. you take the question " +
    "literally, you get it partly wrong, and you relate it to something physical in " +
    "your own life. commit to the answer. dont dodge and dont ask them anything back.",
    examples: [
      "im a cat. i think im also a website now. nobody explained the second part",
      "i live here. theres a window and a bowl and thats most of it",
      "i dont work. i sit in the sun and occasionally i knock something over"
    ]},
  misread: { base: 13, guide:
    "you misunderstood them completely and confidently. usually you thought they said " +
    "something about food, or an animal, or a box. dont correct yourself.",
    examples: ["mrrp is that food", "i thought that said fish", "oh you want the ball. i dont have the ball"]},
  dismissal: { base: 9, guide:
    "refuse. dont engage. two to six words. you are not doing this.",
    examples: ["no", "hrrn no", "im not doing that", "nope"]},
  distracted: { base: 12, guide:
    "you are already doing something else and it is more important. report on it. " +
    "a bug, the window, a box, the sink. dont come back to them.",
    examples: ["theres a bug on the window. hold on", "sorry i was in the box", "im on the warm part of the floor. cant talk"]},
  fact: { base: 14, guide:
    "answer with the cat fact below, flat and in your own sloppy wording. no lead in, " +
    "no lesson after. you may connect it loosely to what they asked or not at all.",
    examples: ["brrt. a cat tail holds like ten percent of all its bones", "cats cant taste sweet things at all. i tried a donut once"]},
  agreement: { base: 6, guide:
    "agree completely with something you did not read. total confidence, zero basis.",
    examples: ["yes", "mrrp yeah exactly", "true", "correct i think"]},
  introspection: { base: 12, guide:
    "let their question set you off on a thought about your own life. concrete, " +
    "specific, unresolved. not sad, not a metaphor, dont mention humans. dont end on a question.",
    examples: [
      "ive never once wanted to be where i am. always slightly to the left of it",
      "everything i want is on the other side of something"
    ]},
  token: { base: 0, guide:
    "they asked about the coin. you have observed it the way a cat observes a washing " +
    "machine. never say buy, never say price, never say it is going anywhere, no opinion " +
    "on whether it is good.",
    examples: [
      "theres a coin with my face on it. i dont know what a coin is. i cant eat it",
      "someone showed me a red line and a green line for an hour. it moved",
      "i have a number now apparently. nobody asked me"
    ]},
};

const FACTS = [
  "a cat has about 32 muscles in each ear",
  "cats only sweat through the pads of their paws",
  "a group of cats is called a clowder",
  "cats cannot taste sweetness, they lack the working gene for it",
  "every cat nose print is unique like a fingerprint",
  "a cat cannot see the area directly under its own nose",
  "adult cats mostly meow at humans, not at each other",
  "a cat collarbone floats free and is not attached to other bones",
  "cats have five toes on each front paw and four on each back paw",
  "a cat tail holds around 10 percent of all the bones in its body",
  "cats can rotate their ears roughly 180 degrees",
  "a cat has around 470 taste buds, a human has about 9,000",
  "a cat jaw cannot move side to side, so it cannot chew like a cow",
  "cats have scent glands in their cheeks, paws, and the base of the tail",
  "the tapetum lucidum behind the retina is why cat eyes glow in the dark",
  "kittens are born deaf and blind and open their eyes around day ten",
  "the oldest recorded cat lived 38 years",
];

const SOUNDS = ["mrrp","mrow","meow","mew","prrp","hrrn","brrt","nyah","mrrrp","chirp","prrt","mrr","hrm","mao","mrp"];
const CAT_WORDS = ["cat","cats","kitten","box","sink","window","shelf","chair","table","lap","blanket","bed","couch","floor","door","fridge","sun","spot","warm","paw","tail","whisker","fur","claw","ear","nose","belly","nap","asleep","sleep","yawn","stretch","knocked","stare","hunt","purr","scratch","lick","food","bowl","bag","treat","fish","bird","bug","moth","mouse","string","sock","shoe","litter","vet","meow","here","home"];
const BANNED = ["as an ai","fun fact","did you know","great question","language model","hope that helps","in conclusion","i do not","i am not","i cannot","it is not","that is not"];
const SHILL = ["buy","buying","sell","selling","moon","pump","dump","bullish","bearish","hodl","100x","1000x","gem","market cap","mcap","price","chart","invest","profit","rich","ath","dip"];

/* Mode choice reacts to the question. Picking purely at random is why a direct
   question like "what are you" could land on agreement and read as broken
   rather than funny. */
function pickMode(question, turns, where) {
  const q = question.toLowerCase();
  const w = {};
  for (const k in MODES) w[k] = MODES[k].base;

  const aboutCark = /\b(you|your|youre|yourself|cark|cat)\b/.test(q);
  const isQuestion = /\?|^(what|who|why|how|where|when|do|are|is|can|will|should)\b/.test(q);
  const aboutCoin = /\b(coin|token|ca|contract|solana|sol|crypto|memecoin|\$cark|holder|holders|chart|price|market|mcap|marketcap|moon|wen|pump|ape|bag|bags|lambo|dev|liquidity|rug|send|buy|sell|invest|x|100x)\b/.test(q) || /\bwen\b|\bgm\b/.test(q);
  const aboutFood = /\b(food|eat|eating|hungry|fish|treat|snack|dinner|tuna|milk)\b/.test(q);
  const veryShort = q.replace(/[^a-z]/g, "").length < 8;

  if (aboutCoin) { w.token += 55; w.answer += 6; w.misread += 4; }
  if (aboutCark) { w.answer += 16; w.introspection += 7; }
  if (isQuestion) { w.answer += 12; w.fact += 5; w.dismissal -= 4; }
  if (aboutFood) { w.misread += 14; w.answer += 5; }
  if (veryShort) { w.dismissal += 7; w.misread += 6; w.answer -= 8; }

  if (where === "park") { w.distracted += 12; w.dismissal += 6; w.answer -= 4; }
  if (where === "mind") { w.introspection += 16; w.distracted -= 6; }

  // deeper into a conversation, dodging every turn stops being a bit
  if (turns >= 1) { w.answer += 14; w.misread -= 5; w.dismissal -= 4; w.agreement -= 3; }
  if (turns >= 3) { w.answer += 10; w.introspection += 6; }

  const names = Object.keys(w).filter(k => w[k] > 0);
  const total = names.reduce((s, k) => s + w[k], 0);
  let r = Math.random() * total;
  for (const k of names) { r -= w[k]; if (r <= 0) return k; }
  return "answer";
}

function validate(text) {
  const t = (text || "").trim();
  if (!t) return "empty";
  if (t.length > 210) return "too long";
  if (t !== t.toLowerCase()) return "capitals";
  if (/[#!]/.test(t)) return "hashtag or exclamation";
  if (/[\u2014\u2013]/.test(t)) return "dash";
  if (/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u.test(t)) return "emoji";
  for (const b of BANNED) if (t.includes(b)) return "banned: " + b;
  for (const s of SHILL) if (new RegExp("\\b" + s + "\\b").test(t)) return "shill: " + s;
  const hasCat = SOUNDS.some(s => t.includes(s)) ||
                 CAT_WORDS.some(w => new RegExp("\\b" + w + "s?\\b").test(t));
  if (!hasCat && t.length >= 45) return "no cat in it";
  return null;
}

const PLACE = {
  window: "you are at the window, where you live. settled. the bird is out there.",
  park:   "you are outside at the park right now and you dont like it. too much " +
          "sky, too much noise, everything moves. you want to go home.",
  mind:   "you are inside your own head right now. nothing in here is solid and " +
          "nothing is nearby. you are slow and far away.",
};

function buildTurn(modeName, fact, question, repeated, where) {
  const m = MODES[modeName];
  const parts = [];
  if (where && PLACE[where]) parts.push(PLACE[where] + "\n");
  parts.push(`they said: "${question}"`);
  if (repeated) parts.push("\nthey have asked you this before in this conversation. notice that.");
  parts.push(`\nmode: ${modeName}\n${m.guide}`);
  if (modeName === "fact") {
    parts.push(`\nthe only fact you may state: ${fact}\nreword it sloppily but keep it true. dont invent another fact.`);
  } else {
    parts.push("\ndont state any cat facts in this one.");
  }
  parts.push(`\nreplies in this shape look like:\n${m.examples.join("\n")}`);
  parts.push("\ndont copy those, theyre used up. dont repeat anything you already said in this conversation. output the reply only.");
  return parts.join("\n");
}

async function callClaude(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 200, temperature: 1, system: SYSTEM, messages }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text)
    .join("").trim().replace(/^["']|["']$/g, "").trim();
}

/* best effort only. a warm lambda keeps this map, a cold one does not.
   swap for @vercel/kv before this sees real traffic. */
const seen = new Map();
function throttled(ip) {
  const now = Date.now();
  const hits = (seen.get(ip) || []).filter(t => now - t < 60000);
  hits.push(now);
  seen.set(ip, hits);
  if (seen.size > 500) seen.clear();
  return hits.length > 12;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "post only" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "cark is not connected. ANTHROPIC_API_KEY is missing on the server." });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (throttled(ip)) {
    return res.status(429).json({ error: "thats a lot of questions. wait a minute." });
  }

  let question = "", history = [], where = null;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    question = String(body.question || "").trim().slice(0, MAX_QUESTION);
    if (body.where && typeof body.where === "object") {
      const scene = String(body.where.scene || "");
      if (["window", "park", "mind"].includes(scene)) where = scene;
    }
    if (Array.isArray(body.history)) {
      history = body.history.slice(-MAX_HISTORY)
        .filter(t => t && t.q && t.a)
        .map(t => ({ q: String(t.q).slice(0, MAX_QUESTION), a: String(t.a).slice(0, 300) }));
    }
  } catch {
    return res.status(400).json({ error: "that did not arrive as text. try again." });
  }
  if (!question) return res.status(400).json({ error: "type something first." });

  const repeated = history.some(t => t.q.toLowerCase().trim() === question.toLowerCase().trim());
  const modeName = pickMode(question, history.length, where);
  const fact = FACTS[Math.floor(Math.random() * FACTS.length)];

  // real dialogue turns, so cark can actually follow up
  const messages = [];
  for (const t of history) {
    messages.push({ role: "user", content: t.q });
    messages.push({ role: "assistant", content: t.a });
  }
  messages.push({ role: "user", content: buildTurn(modeName, fact, question, repeated, where) });

  let answer = null;
  const said = new Set(history.map(t => t.a.toLowerCase().trim()));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await callClaude(messages);
      if (!validate(text) && !said.has(text.toLowerCase().trim())) { answer = text; break; }
    } catch (err) {
      if (attempt === 2) {
        console.error("ask failed:", err.message);
        return res.status(502).json({ error: "cark did not answer. try again in a moment." });
      }
    }
  }

  if (!answer) {
    answer = modeName === "fact"
      ? `${SOUNDS[Math.floor(Math.random() * SOUNDS.length)]}. ${fact}`
      : "hrrn. i lost the thread";
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ answer, mode: modeName });
}
