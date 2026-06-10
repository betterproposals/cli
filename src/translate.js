import { franc } from 'franc-min';
import { chatText } from './provider.js';

// Language roundtrip.
//   - Ollama mode: two dedicated local translator models
//       `hy-chat-translator-in`  : any language → English
//       `hy-chat-translator-out` : English → target language
//     (built from `ali6parmak/hy-mt1.5`; system prompts live in the
//     Modelfiles in the repo root, so we don't resend them).
//   - OpenRouter mode: a single general model (deepseek/deepseek-v4-flash
//     by default) does both directions, with the equivalent system prompts
//     sent in-request — the custom Modelfile models can't run on cloud.
//
// Language detection always runs locally via `franc-min` — fast, no LLM
// roundtrip, and the translator models don't expose the source language.

const DEFAULT_TRANSLATOR_IN = 'hy-chat-translator-in';
const DEFAULT_TRANSLATOR_OUT = 'hy-chat-translator-out';

// System prompts mirroring ModelFile_hy-mt15-in / -out, sent in-request
// when translating via OpenRouter (where the custom models aren't available).
const IN_SYSTEM = `You are a raw machine translation endpoint. Your ONLY task is to translate the input text into natural English.
- Do NOT reply to the user message.
- Do NOT explain anything.
- Do NOT add introductory phrases like "The translation is:".
- Output ONLY the final English text.`;

const OUT_SYSTEM = `You are a machine translation engine.
The user will provide a target language and an English phrase.
Your ONLY job is to translate that English phrase into the requested target language.
- Output ONLY the final translated text.
- Do not include any greeting, intro, or explanations.
- Do NOT prepend the language name or any label (no "Italiano:", no "Italian:", no "Francese:", nothing).
- Do NOT add "Here is the translation:" or similar commentary.`;

// franc-min returns ISO 639-3 codes. Map the common ones to ISO 639-1
// + the English name we pass to the OUT translator.
const LANGUAGES_BY_639_3 = {
    eng: { iso639_1: 'en', name: 'English' },
    ita: { iso639_1: 'it', name: 'Italian' },
    spa: { iso639_1: 'es', name: 'Spanish' },
    fra: { iso639_1: 'fr', name: 'French' },
    deu: { iso639_1: 'de', name: 'German' },
    por: { iso639_1: 'pt', name: 'Portuguese' },
    nld: { iso639_1: 'nl', name: 'Dutch' },
    pol: { iso639_1: 'pl', name: 'Polish' },
    rus: { iso639_1: 'ru', name: 'Russian' },
    swe: { iso639_1: 'sv', name: 'Swedish' },
    nor: { iso639_1: 'no', name: 'Norwegian' },
    dan: { iso639_1: 'da', name: 'Danish' },
    fin: { iso639_1: 'fi', name: 'Finnish' },
    ell: { iso639_1: 'el', name: 'Greek' },
    tur: { iso639_1: 'tr', name: 'Turkish' },
    jpn: { iso639_1: 'ja', name: 'Japanese' },
    kor: { iso639_1: 'ko', name: 'Korean' },
    cmn: { iso639_1: 'zh', name: 'Chinese' },
    zho: { iso639_1: 'zh', name: 'Chinese' },
    arb: { iso639_1: 'ar', name: 'Arabic' },
    ara: { iso639_1: 'ar', name: 'Arabic' },
    heb: { iso639_1: 'he', name: 'Hebrew' },
    ces: { iso639_1: 'cs', name: 'Czech' },
    ron: { iso639_1: 'ro', name: 'Romanian' },
    hun: { iso639_1: 'hu', name: 'Hungarian' },
    ukr: { iso639_1: 'uk', name: 'Ukrainian' },
    vie: { iso639_1: 'vi', name: 'Vietnamese' },
    tha: { iso639_1: 'th', name: 'Thai' },
    ind: { iso639_1: 'id', name: 'Indonesian' },
    hin: { iso639_1: 'hi', name: 'Hindi' },
};

// Map 639-1 codes back to language data, so callers (or --force flags)
// that supply "it" / "fr" / "en" still resolve to the full English name
// the OUT translator expects.
const LANGUAGES_BY_639_1 = Object.fromEntries(
    Object.values(LANGUAGES_BY_639_3).map((l) => [l.iso639_1, l]),
);

function resolveLanguage(code) {
    if (!code) return LANGUAGES_BY_639_1.en;
    const lower = code.toLowerCase();
    return LANGUAGES_BY_639_3[lower] ?? LANGUAGES_BY_639_1[lower] ?? null;
}

// Distinctive marker words/regexes that are highly specific to one
// language (no false positives in the others below). Two-or-more matches
// override franc's verdict — covering cases where franc is confidently
// wrong on short, English-loanword-heavy input (observed: franc returns
// `fra` with score 1.0 for "come cancello l'account?", which is Italian).
const STRONG_MARKERS = {
    eng: [
        /\bhow\b/i,
        /\bwhat\b/i,
        /\bwhere\b/i,
        /\bwhen\b/i,
        /\bwhy\b/i,
        /\bwho\b/i,
        /\bdo\b/i,
        /\bdoes\b/i,
        /\bdid\b/i,
        /\bcan\b/i,
        /\bcould\b/i,
        /\bshould\b/i,
        /\bwould\b/i,
        /\bmy\b/i,
        /\byour\b/i,
        /\bthe\b/i,
        /\bis\b/i,
        /\bare\b/i,
        /\bwas\b/i,
        /\bwere\b/i,
        /\bi\b/i,
        /\byou\b/i,
        /\bplease\b/i,
        /\bthanks?\b/i,
    ],
    ita: [
        /\bcome\b/i,             // Italian "how"; French would be "comment"
        /\bperch[éè]\b/i,
        /\bcosa\b/i,
        /\bquest[oaie]\b/i,
        /\bquell[oaie]\b/i,
        /\bgli\b/i,
        /\bsono\b/i,
        /\bfaccio\b/i,
        /\bposso\b/i,
        /\bcancello\b/i,
        /\boggi\b/i,
        /\bpi[uù]\b/i,
        /\bdov[eé]\b/i,
        /\bquant[oaie]\b/i,
        /\bavete\b/i,
        /\bho\b/i,                // Italian "I have"
        /\binviato\b/i,
        /\binvio\b/i,
        /\bcancellare\b/i,
        /\baccount\b.*\bdell?['']/i,
    ],
    fra: [
        /\bcomment\b/i,
        /\bpourquoi\b/i,
        /\bj['']ai\b/i,
        /\bpuis[- ]je\b/i,
        /\baujourd['']hui\b/i,
        /\bbonjour\b/i,
        /\bmerci\b/i,
        /\bqu['']est[- ]ce\b/i,
        /\best[- ]ce\b/i,
        /\bnotre\b/i,
    ],
    spa: [
        /\bc[oó]mo\b/i,
        /\bpor qu[eé]\b/i,
        /\bcu[aá]ndo\b/i,
        /\bpor favor\b/i,
        /\bgracias\b/i,
        /\baqu[ií]\b/i,
        /\btodav[ií]a\b/i,
        /\busted\b/i,
        /\bporqu[eé]\b/i,
    ],
    deu: [
        /\bwie\b/i,
        /\bwarum\b/i,
        /\bich\b/i,
        /\bnicht\b/i,
        /\bbitte\b/i,
        /\bdanke\b/i,
    ],
    por: [
        /\bcomo\b/i,
        /\bobrigado\b/i,
        /\bporqu[eê]\b/i,
        /\bvoc[eê]\b/i,
        /\bn[aã]o\b/i,
    ],
};

function countMarkers(text) {
    const counts = {};
    for (const [code, patterns] of Object.entries(STRONG_MARKERS)) {
        counts[code] = patterns.reduce((n, rx) => n + (rx.test(text) ? 1 : 0), 0);
    }
    return counts;
}

// franc-min can return obscure languages that don't make sense for
// betterproposals traffic (e.g. Vietnamese for short English). Constrain
// it to the set we actually support, so misfires at least pick a
// neighbouring real candidate that the marker disambiguator can fix.
const SUPPORTED_639_3 = Object.keys(LANGUAGES_BY_639_3);

function disambiguate(text, francCode) {
    const counts = countMarkers(text);
    const francMarkers = counts[francCode] ?? 0;
    // If franc's pick has no marker support, any language with ≥1 marker
    // wins. If franc's pick HAS markers, require a strict majority to
    // override (avoids flapping on borderline counts).
    let bestCode = francCode;
    let bestCount = Math.max(francMarkers, 0);
    for (const [code, n] of Object.entries(counts)) {
        if (code === francCode) continue;
        if (n > bestCount) {
            bestCount = n;
            bestCode = code;
        }
    }
    return bestCode;
}

export function detectLanguage(text) {
    // `franc` returns 'und' for text it cannot identify (typically very
    // short input). Treat as English so we skip the roundtrip rather
    // than calling the translator with no target.
    const input = text ?? '';
    let code = franc(input, { only: SUPPORTED_639_3 });
    if (code === 'und') return LANGUAGES_BY_639_1.en;
    // franc is unreliable on short Latin-script text with English
    // loanwords (its 3-gram model collapses Romance languages). Override
    // when distinctive markers point elsewhere.
    code = disambiguate(input, code);
    return LANGUAGES_BY_639_3[code] ?? LANGUAGES_BY_639_1.en;
}

export async function translateToEnglish(text, { provider = 'ollama', endpoint, apiKey, model = DEFAULT_TRANSLATOR_IN, timeoutMs }) {
    // Ollama's custom model has the system prompt baked in; OpenRouter
    // needs it sent explicitly.
    const messages = provider === 'openrouter'
        ? [{ role: 'system', content: IN_SYSTEM }, { role: 'user', content: text }]
        : [{ role: 'user', content: text }];
    const raw = await chatText({ provider, endpoint, apiKey, model, messages, timeoutMs });
    return raw.trim();
}

// hy-mt1.5 freely translates URLs and slugs (e.g. /en/articles/123-foo
// → /it/articles/123-modificare-il-design...) which silently produces
// broken links. Replace URLs with opaque placeholder tokens before
// translation and splice them back afterwards.
// Also: small models occasionally prepend the language name ("Italiano:",
// "Italian:") as a label despite the system prompt forbidding it. Strip it.
function stripLeadingLabel(text, langName) {
    if (!langName || !text) return text;
    const rx = new RegExp(`^\\s*\\**${langName}(?:o|e|a|ese)?\\*?\\s*:?\\s*`, 'i');
    const cleaned = text.replace(rx, '');
    return cleaned || text;
}

const URL_REGEX = /https?:\/\/\S+/g;
function protectUrls(text) {
    const urls = [];
    const masked = text.replace(URL_REGEX, (match) => {
        const i = urls.length;
        urls.push(match);
        return `[[URL${i}]]`;
    });
    return { masked, urls };
}
function restoreUrls(text, urls) {
    return text.replace(/\[\[URL(\d+)\]\]/g, (_, i) => urls[Number(i)] ?? `[[URL${i}]]`);
}

export async function translateFromEnglish(text, targetLang, { provider = 'ollama', endpoint, apiKey, model = DEFAULT_TRANSLATOR_OUT, timeoutMs }) {
    const lang = resolveLanguage(targetLang);
    if (!lang || lang.iso639_1 === 'en') return text;
    const { masked, urls } = protectUrls(text);
    // Both modes use the same "<TargetLanguage>: <English phrase>" user
    // contract; OpenRouter additionally gets the OUT system prompt.
    const userMsg = { role: 'user', content: `${lang.name}: ${masked}` };
    const messages = provider === 'openrouter'
        ? [{ role: 'system', content: OUT_SYSTEM }, userMsg]
        : [userMsg];
    const raw = await chatText({ provider, endpoint, apiKey, model, messages, timeoutMs });
    const cleaned = stripLeadingLabel(raw.trim(), lang.name);
    return restoreUrls(cleaned, urls);
}

function parseJsonLoose(text) {
    const cleaned = (text ?? '').replace(/```json|```/gi, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

const DETECT_TRANSLATE_SYSTEM = `You are a language detection and translation engine for a SaaS assistant.
The user sends one message in any language. Respond with ONLY a JSON object — no markdown, no code fences, no commentary:
{"lang":"<ISO 639-1 code, e.g. en, it, es, fr, de, pt>","en":"<the message translated to natural English>"}
If the message is already in English, set "lang" to "en" and "en" to the original message verbatim.
Output ONLY the JSON object.`;

// Detect the source language and produce the English version of the prompt
// in one shot. On OpenRouter this is a single strong-model call (robust on
// short text where franc-min misfires — e.g. it labels "create a proposal
// about a coffee shop" as Romanian). On Ollama it falls back to local
// franc detection + the hy translator.
export async function prepareInput(prompt, { provider = 'ollama', endpoint, apiKey, model, timeoutMs }) {
    if (provider === 'openrouter') {
        try {
            const raw = await chatText({
                provider, endpoint, apiKey, model,
                messages: [
                    { role: 'system', content: DETECT_TRANSLATE_SYSTEM },
                    { role: 'user', content: prompt },
                ],
                timeoutMs,
            });
            const parsed = parseJsonLoose(raw);
            const lang = parsed && resolveLanguage(parsed.lang);
            if (lang && typeof parsed.en === 'string' && parsed.en.trim()) {
                return {
                    languageCode: lang.iso639_1,
                    languageName: lang.name,
                    englishPrompt: lang.iso639_1 === 'en' ? prompt : parsed.en.trim(),
                };
            }
        } catch {
            // fall through to franc-based fallback below
        }
    }

    // Local / fallback path: detect with franc, translate only if needed.
    const lang = detectLanguage(prompt);
    if (lang.iso639_1 === 'en') {
        return { languageCode: 'en', languageName: 'English', englishPrompt: prompt };
    }
    const englishPrompt = await translateToEnglish(prompt, { provider, endpoint, apiKey, model, timeoutMs });
    return { languageCode: lang.iso639_1, languageName: lang.name, englishPrompt };
}

// Compatibility shim for older callers that expect a single function
// returning {language, english}.
export async function detectAndTranslate(text, opts) {
    const { languageCode, englishPrompt } = await prepareInput(text, opts ?? {});
    return { language: languageCode, english: englishPrompt };
}
