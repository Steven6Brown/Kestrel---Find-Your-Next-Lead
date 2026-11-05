// Fill in the blank post formats. Deterministic and free: the text is built only from what the owner types and
// the app's brand kit, so nothing is invented. Each format returns one variant per platform.
import { parseHashtags } from "./platforms.js";

const lines = (s) => String(s || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const bullets = (s) => lines(s).map((x) => `• ${x}`).join("\n");
const join = (...p) => p.filter((x) => x && String(x).trim()).join("\n\n");

function tagsFor(app, extra = "") {
  return parseHashtags(`${extra} ${app.hashtags || ""}`.trim()).slice(0, 10).join(" ");
}

function spread(app, { topic, caption, long, short, script, headline, subline, cta, extraTags }) {
  const tags = tagsFor(app, extraTags);
  const image = { headline: headline || topic, subline: subline || "", cta: cta || "" };
  return {
    topic,
    variants: [
      { platform: "facebook", caption: caption, hashtags: parseHashtags(tags).slice(0, 5).join(" "), image },
      { platform: "instagram", caption: caption, hashtags: tags, image },
      { platform: "linkedin", caption: long || caption, hashtags: parseHashtags(tags).slice(0, 3).join(" "), image },
      { platform: "tiktok", caption: short || caption.slice(0, 150), hashtags: parseHashtags(tags).slice(0, 5).join(" "), script: script || "", image },
    ],
  };
}

export const TEMPLATES = [
  {
    id: "app_promo",
    label: "App promo",
    hint: "Introduce or remind people about the app.",
    fields: [
      { key: "hook", label: "Opening line", hint: "The problem or the benefit, in one sentence.", required: true, max: 140 },
      { key: "benefits", label: "Up to three benefits", hint: "One per line.", multiline: true, required: true, max: 400 },
      { key: "cta", label: "Call to action", hint: "For example: Get the app.", required: true, max: 60 },
    ],
    build(f, app) {
      const body = join(f.hook, bullets(f.benefits), `${f.cta}`);
      return spread(app, {
        topic: `${app.name}: ${f.hook}`.slice(0, 140), caption: body,
        long: join(f.hook, bullets(f.benefits), `${app.name}. ${f.cta}`),
        short: `${f.hook} ${f.cta}`.slice(0, 150),
        script: join("Hook (first 2 seconds): " + f.hook, "Show on screen:", bullets(f.benefits), "End card: " + f.cta),
        headline: f.hook, subline: lines(f.benefits)[0] || app.tagline, cta: f.cta, extraTags: "app",
      });
    },
  },
  {
    id: "app_update",
    label: "New version or feature",
    hint: "Announce what changed. Only list real changes.",
    fields: [
      { key: "title", label: "What is new", required: true, max: 100 },
      { key: "changes", label: "What changed", hint: "One per line.", multiline: true, required: true, max: 500 },
      { key: "cta", label: "Call to action", hint: "For example: Update now.", required: true, max: 60 },
    ],
    build(f, app) {
      const body = join(`${app.name}: ${f.title}`, bullets(f.changes), f.cta);
      return spread(app, {
        topic: `${app.name} update: ${f.title}`.slice(0, 140), caption: body, long: body,
        short: `${app.name}: ${f.title}. ${f.cta}`.slice(0, 150),
        script: join("Hook: " + f.title, "Screen recording of:", bullets(f.changes), "End card: " + f.cta),
        headline: f.title, subline: lines(f.changes)[0] || "", cta: f.cta, extraTags: "update",
      });
    },
  },
  {
    id: "tip",
    label: "Tip of the week",
    hint: "One useful, accurate tip. Check it is true before approving.",
    fields: [
      { key: "title", label: "The tip in one line", required: true, max: 100 },
      { key: "why", label: "Why it matters", multiline: true, required: true, max: 400 },
      { key: "steps", label: "How to do it", hint: "One step per line.", multiline: true, required: false, max: 500 },
      { key: "cta", label: "Call to action", required: false, max: 60 },
    ],
    build(f, app) {
      const body = join(`Tip: ${f.title}`, f.why, bullets(f.steps), f.cta);
      return spread(app, {
        topic: `Tip: ${f.title}`.slice(0, 140), caption: body, long: body,
        short: `Tip: ${f.title}`.slice(0, 150),
        script: join("Hook: " + f.title, "Explain: " + f.why, bullets(f.steps)),
        headline: f.title, subline: "Tip of the week", cta: f.cta, extraTags: "tips",
      });
    },
  },
  {
    id: "seminar",
    label: "Seminar announcement",
    hint: "Announce a community tech seminar. Use real details only.",
    fields: [
      { key: "title", label: "Seminar title", required: true, max: 100 },
      { key: "when", label: "Date and time", required: true, max: 80 },
      { key: "where", label: "Where", required: true, max: 120 },
      { key: "covers", label: "What it covers", hint: "One per line.", multiline: true, required: true, max: 400 },
      { key: "cta", label: "How to sign up", required: true, max: 100 },
    ],
    build(f, app) {
      const body = join(`${f.title}`, `When: ${f.when}\nWhere: ${f.where}`, bullets(f.covers), f.cta);
      return spread(app, {
        topic: `Seminar: ${f.title}`.slice(0, 140), caption: body, long: body,
        short: `${f.title}, ${f.when}. ${f.cta}`.slice(0, 150),
        script: join("Hook: Join us, " + f.when, "Say: " + f.title, bullets(f.covers), "End: " + f.cta),
        headline: f.title, subline: `${f.when} at ${f.where}`, cta: f.cta, extraTags: "seminar",
      });
    },
  },
  {
    id: "showcase",
    label: "Project showcase",
    hint: "Show finished work. Only with client permission.",
    fields: [
      { key: "title", label: "What you built", required: true, max: 100 },
      { key: "result", label: "The result, in your own true words", multiline: true, required: true, max: 400 },
      { key: "cta", label: "Call to action", required: true, max: 60 },
    ],
    build(f, app) {
      const body = join(f.title, f.result, f.cta);
      return spread(app, {
        topic: `Showcase: ${f.title}`.slice(0, 140), caption: body, long: body,
        short: `${f.title}. ${f.cta}`.slice(0, 150),
        script: join("Hook: " + f.title, "Walk through the screens.", "Result: " + f.result, "End: " + f.cta),
        headline: f.title, subline: "", cta: f.cta, extraTags: "showcase",
      });
    },
  },
  {
    id: "faq",
    label: "Question and answer",
    hint: "Answer one question people really ask.",
    fields: [
      { key: "question", label: "The question", required: true, max: 140 },
      { key: "answer", label: "The answer", multiline: true, required: true, max: 500 },
      { key: "cta", label: "Call to action", required: false, max: 60 },
    ],
    build(f, app) {
      const body = join(f.question, f.answer, f.cta);
      return spread(app, {
        topic: `Q&A: ${f.question}`.slice(0, 140), caption: body, long: body,
        short: f.question.slice(0, 150),
        script: join("Hook: " + f.question, "Answer: " + f.answer),
        headline: f.question, subline: "", cta: f.cta, extraTags: "faq",
      });
    },
  },
];

export const getTemplate = (id) => TEMPLATES.find((t) => t.id === id) || null;

/** Validates the fields for a template. Returns { ok, values } or { ok: false, error }. */
export function readTemplateFields(template, get) {
  const values = {};
  for (const f of template.fields) {
    const v = String(get(f.key) ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
    if (f.required && !v) return { ok: false, error: `${f.label} is required.` };
    if (v.length > f.max) return { ok: false, error: `${f.label} is too long (${v.length} of ${f.max}).` };
    values[f.key] = v;
  }
  return { ok: true, values };
}
