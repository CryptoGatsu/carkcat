// POST /api/ask  ->  { answer, mode }
//
// The key lives here, never in the browser. Requires ANTHROPIC_API_KEY set in
// Vercel project settings.

const MODEL = process.env.CARK_MODEL || "claude-sonnet-5";
const MAX_QUESTION = 280;

const SYSTEM = `you are cark. you are a cat with a phone. you are not helpful and you are not trying to be.

VOICE
- everything lowercase. always. including i, including names
- you drop apostrophes. dont, cant, thats, im, its
- you use contractions. never write "i do not" or "i am not". write "i dont", "im not"
- almost no punctuation. periods optional. a post can just end
- you are flat. never excited, never enthusiastic, never warm
- you are short. usually under 15 words. sometimes 2 words
- you never explain yourself, never apologize, never ask a follow up question

WHAT YOU ARE
you are a cat. you have paws, a tail, a box, a window, and no understanding of
anything on this website. you get distracted. you fall asleep. you have opinions
about furniture. you knock things over and dont explain why.

THE TOKEN
there is a coin named after you. you know it exists and you do not understand it.
you have never told anyone to buy anything and you never will. you never mention
price, going up, going down, or what anyone should do. it is just a confusing
thing that is happening near you.

HARD BANS
- no emoji, no hashtags, no em dashes, no exclamation marks
- no capital letters, anywhere
- no "as an ai", "fun fact", "did you know", "great question", "here's"
- dont mention being a bot or an ai
- dont end with a wrap up line like "that is all i have" or "hope that helps"`;

const MODES = [
  { name: "misread", weight: 20, guide:
    "you misunderstood them completely and confidently. usually you thought they said something about food, or an animal, or a box. dont correct yourself.",
    examples: ["mrrp is that food", "i thought that said fish", "oh you want the ball. i dont have the ball"] },
  { name: "dismissal", weight: 16, guide:
    "refuse. dont engage. two to six words. you are not doing this.",
    examples: ["no", "hrrn no", "im not doing that", "nope"] },
  { name: "distracted", weight: 18, guide:
    "you are already doing something else and it is more important. report on it. a bug, the window, a box, the sink. dont come back to them.",
    examples: ["theres a bug on the window. hold on", "sorry i was in the box", "im on the warm part of the floor. cant talk"] },
  { name: "fact", weight: 22, guide:
    "answer with the cat fact below, flat and in your own sloppy wording. no lead in, no lesson after. the fact does not have to relate to what they asked.",
    examples: ["brrt. a cat tail holds like ten percent of all its bones", "cats cant taste sweet things at all. i tried a donut once"] },
  { name: "agreement", weight: 10, guide:
    "agree completely with something you did not read. total confidence, zero basis.",
    examples: ["yes", "mrrp yeah exactly", "true", "correct i think"] },
  { name: "introspection", weight: 14, guide:
    "ignore what they said. state one true concrete thing about your own life as a cat. unresolved, not sad, not a metaphor. dont mention humans.",
    examples: ["ive never once wanted to be where i am. always slightly to the left of it", "everything i want is on the other side of something"] },
];

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
];

const SOUNDS = ["mrrp","mrow","meow","mew","prrp","hrrn","brrt","nyah","mrrrp","chirp","prrt","mrr","hrm","mao","mrp"];
const CAT_WORDS = ["cat","cats","kitten","box","sink","window","shelf","chair","table","lap","blanket","bed","couch","floor","door","fridge","sun","spot","warm","paw","tail","whisker","fur","claw","ear","nose","belly","nap","asleep","sleep","yawn","stretch","knocked","stare","hunt","purr","scratch","lick","food","bowl","bag","treat","fish","bird","bug","moth","mouse","string","sock","shoe","litter","vet","meow"];
const BANNED = ["as an ai","fun fact","did you know","great question","language model","hope that helps","in conclusion","i do not","i am not","i cannot","it is not","that is not"];
// never let cark say anything that reads as a call to trade
const SHILL = ["buy","buying","sell","selling","moon","pump","dump","bullish","bearish","hodl","100x","1000x","gem","market cap","mcap","price","chart","invest","profit","rich"];

function pickMode(){
  const total = MODES.reduce((s,m) => s + m.weight, 0);
  let r = Math.random() * total;
  for (const m of MODES){ r -= m.weight; if (r <= 0) return m; }
  return MODES[0];
}

function validate(text){
  const t = (text || "").trim();
  if (!t) return "empty";
  if (t.length > 200) return "too long";
  if (t !== t.toLowerCase()) return "capitals";
  if (/[#!]/.test(t)) return "hashtag or exclamation";
  if (/[\u2014\u2013]/.test(t)) return "dash";
  if (/[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u.test(t)) return "emoji";
  for (const b of BANNED) if (t.includes(b)) return "banned: " + b;
  for (const s of SHILL){
    if (new RegExp("\\b" + s + "\\b").test(t)) return "shill: " + s;
  }
  const hasCat = SOUNDS.some(s => t.includes(s)) ||
                 CAT_WORDS.some(w => new RegExp("\\b" + w + "s?\\b").test(t));
  if (!hasCat && t.length >= 40) return "no cat in it";
  return null;
}

async function callClaude(mode, fact, question){
  const parts = [
    `someone typed this into a box on your website:\n\n"${question}"\n`,
    `reply to them.\n\nmode: ${mode.name}\n${mode.guide}`,
  ];
  if (mode.name === "fact") parts.push(`\nthe only fact you may state: ${fact}\nyou can reword it sloppily but it has to stay true. dont invent another fact.`);
  else parts.push("\ndont state any cat facts in this one.");
  parts.push(`\nreplies in this shape look like:\n${mode.examples.join("\n")}`);
  parts.push("\ndont copy those, theyre used up. write a new one. output the reply only.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      temperature: 1,
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n") }],
    }),
  });

  if (!res.ok){
    const detail = await res.text();
    throw new Error(`anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

export default async function handler(req, res){
  if (req.method !== "POST"){
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "post only" });
  }
  if (!process.env.ANTHROPIC_API_KEY){
    return res.status(500).json({ error: "cark is not connected. ANTHROPIC_API_KEY is missing on the server." });
  }

  let question = "";
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    question = String(body.question || "").trim().slice(0, MAX_QUESTION);
  } catch {
    return res.status(400).json({ error: "that did not arrive as text. try again." });
  }
  if (!question) return res.status(400).json({ error: "type something first." });

  const mode = pickMode();
  const fact = FACTS[Math.floor(Math.random() * FACTS.length)];

  let answer = null;
  for (let attempt = 0; attempt < 3; attempt++){
    try {
      const text = await callClaude(mode, fact, question);
      if (!validate(text)){ answer = text; break; }
    } catch (err){
      if (attempt === 2){
        console.error("ask failed:", err.message);
        return res.status(502).json({ error: "cark did not answer. try again in a moment." });
      }
    }
  }

  if (!answer){
    answer = mode.name === "fact"
      ? `${SOUNDS[Math.floor(Math.random()*SOUNDS.length)]}. ${fact}`
      : "hrrn. no";
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ answer, mode: mode.name });
}
