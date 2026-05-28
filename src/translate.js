import { franc } from 'franc-min';
import { ollamaChat } from './ollama.js';

// Language roundtrip using two dedicated translation models:
//   - `hy-chat-translator-in`  : any language → English
//   - `hy-chat-translator-out` : English → target language
// (both built from `ali6parmak/hy-mt1.5`; the system prompts live in the
// Modelfiles in the repo root, so we don't send our own here)
//
// Language detection runs on the JS side via `franc-min` — fast, no LLM
// roundtrip, and the translator models don't expose the source language
// so we can't recover it from them.

const DEFAULT_TRANSLATOR_IN = 'hy-chat-translator-in';
const DEFAULT_TRANSLATOR_OUT = 'hy-chat-translator-out';

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

export async function translateToEnglish(text, { endpoint, model = DEFAULT_TRANSLATOR_IN, timeoutMs }) {
    const messages = [{ role: 'user', content: text }];
    const raw = await ollamaChat({ endpoint, model, messages, timeoutMs });
    return raw.trim();
}

// hy-mt1.5 freely translates URLs and slugs (e.g. /en/articles/123-foo
// → /it/articles/123-modificare-il-design...) which silently produces
// broken links. Replace URLs with opaque placeholder tokens before
// translation and splice them back afterwards.
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

export async function translateFromEnglish(text, targetLang, { endpoint, model = DEFAULT_TRANSLATOR_OUT, timeoutMs }) {
    const lang = resolveLanguage(targetLang);
    if (!lang || lang.iso639_1 === 'en') return text;
    const { masked, urls } = protectUrls(text);
    // OUT modelfile's SYSTEM tells the model the user message will be
    // "<TargetLanguage>: <English phrase>". Stick to that contract.
    const messages = [{ role: 'user', content: `${lang.name}: ${masked}` }];
    const raw = await ollamaChat({ endpoint, model, messages, timeoutMs });
    return restoreUrls(raw.trim(), urls);
}

// Compatibility shim for older callers that expect a single function
// returning {language, english}. Detection is local now; translation is
// only invoked when the language isn't English.
export async function detectAndTranslate(text, { endpoint, model = DEFAULT_TRANSLATOR_IN, timeoutMs }) {
    const lang = detectLanguage(text);
    if (lang.iso639_1 === 'en') return { language: 'en', english: text };
    const english = await translateToEnglish(text, { endpoint, model, timeoutMs });
    return { language: lang.iso639_1, english };
}
