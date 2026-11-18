import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embedText, chatText } from './provider.js';
import { cosineSimilarity } from './triage.js';

// Two-stage article selector: cosine gives us a top-K from 150+ articles
// (cheap, always right for lexical matches), then an optional LLM rerank
// fixes the cases cosine gets wrong — e.g. "le rupie indiane. come le
// imposto?" (how to set Indian rupees) would get "using quantities" from
// pure cosine but "finance settings" from an LLM that understands intent.
// The reranker is optional: callers pass a `reranker` object only when
// they want the extra LLM cost (OpenRouter, not the local path).
const TOP_K = 5;

const RERANK_SYSTEM = `You pick the most relevant Better Proposals help-center article for a user's English question.
Reply with ONLY the number of the best article (1-based). If none are relevant, reply "none". Do not explain.`;

// "General" path: no LLM. The user's English question is embedded and
// matched against pre-embedded help-center article titles (with their
// category as a hint). The single best match becomes the response,
// formatted as a short note pointing at the article + a fallback line
// telling the user to contact support for anything else.
//
// A weak best-match score still returns the best article — we don't try
// to "I don't know" here, because the small-LLM path that used to do
// that proved unreliable and slow. If the question is genuinely off-topic
// the user can always rephrase and the contact-support sentence covers
// the gap.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ARTICLES_PATH = join(__dirname, 'data', 'help-articles.json');

// Cache keyed by embed model so local (nomic, 768-dim) and OpenRouter
// (text-embedding-3-small, 1536-dim) vectors don't collide.
function articleEmbedsCachePath(embedModel) {
    const safe = String(embedModel).replace(/[^A-Za-z0-9._-]/g, '_');
    return join(homedir(), '.betterproposals', `help-article-embeds-${safe}.json`);
}

let cachedArticles = null;
function loadArticles() {
    if (!cachedArticles) {
        cachedArticles = JSON.parse(readFileSync(ARTICLES_PATH, 'utf8'));
    }
    return cachedArticles;
}

// "Topic: Title (slug words)" as the embedding input. Categories
// disambiguate generic titles (e.g. "Creating a template" vs "Creating a
// cover"). The URL slug adds action verbs ("adding", "creating",
// "integrating") that title abbreviations often drop, which improves
// matching for "how do I X" queries.
function articleText(article) {
    const slugTail = article.url?.split('/').pop() ?? '';
    const slugWords = slugTail.replace(/^\d+-/, '').replace(/-/g, ' ');
    const head = article.category ? `${article.category}: ${article.title}` : article.title;
    return slugWords ? `${head}. ${slugWords}` : head;
}

const EMBED_FORMAT_VERSION = 'v2-with-slug';
function articlesFingerprint(articles) {
    return `${EMBED_FORMAT_VERSION}::${articles.length}::${articles[0]?.url}::${articles[articles.length - 1]?.url}`;
}

async function ensureArticleEmbeddings({ provider, embedEndpoint, apiKey, embedModel }) {
    const articles = loadArticles();
    const fingerprint = articlesFingerprint(articles);
    const cachePath = articleEmbedsCachePath(embedModel);

    if (existsSync(cachePath)) {
        try {
            const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
            if (cached.model === embedModel && cached.fingerprint === fingerprint) {
                return cached.embeddings;
            }
        } catch {
            // Corrupt cache — fall through and recompute.
        }
    }

    const embeddings = await embedText({
        provider,
        endpoint: embedEndpoint,
        apiKey,
        model: embedModel,
        input: articles.map(articleText),
    });
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(
        cachePath,
        JSON.stringify({ model: embedModel, fingerprint, embeddings }),
        'utf8',
    );
    return embeddings;
}

function topK(queryEmbed, articles, embeddings, k) {
    const scored = articles.map((article, i) => ({
        article,
        score: cosineSimilarity(queryEmbed, embeddings[i]),
        index: i,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
}

function parseRerankerChoice(raw, n) {
    const s = (raw ?? '').toLowerCase().trim();
    if (s === 'none') return null;
    const m = s.match(/\d+/);
    if (!m) return null;
    const picked = Number(m[0]);
    return Number.isFinite(picked) && picked >= 1 && picked <= n ? picked - 1 : null;
}

async function rerankWithLLM({
    query, candidates, provider, endpoint, apiKey, rerankerModel, timeoutMs,
}) {
    const list = candidates
        .map((c, i) => `${i + 1}. ${c.article.title} — ${c.article.category} — ${c.article.url}`)
        .join('\n');
    const messages = [
        { role: 'system', content: RERANK_SYSTEM },
        { role: 'user', content: `User question: ${query}\n\nCandidate articles:\n${list}` },
    ];
    const raw = await chatText({ provider, endpoint, apiKey, model: rerankerModel, messages, timeoutMs });
    return parseRerankerChoice(raw, candidates.length);
}

export async function findBestArticle(query, { provider = 'ollama', embedEndpoint, apiKey, embedModel, reranker, rerankTimeoutMs }) {
    const articles = loadArticles();
    const embeddings = await ensureArticleEmbeddings({ provider, embedEndpoint, apiKey, embedModel });
    const queryEmbed = await embedText({ provider, endpoint: embedEndpoint, apiKey, model: embedModel, input: query });

    const candidates = topK(queryEmbed, articles, embeddings, TOP_K);

    // Reranker off (Ollama) or unavailable: top-1 cosine wins.
    if (!reranker || provider !== 'openrouter') {
        return {
            article: candidates[0].article,
            score: candidates[0].score,
            reranked: false,
            candidates,
        };
    }

    // Reranker on (OpenRouter): LLM picks from the top-K.
    try {
        const picked = await rerankWithLLM({
            query, candidates, provider, endpoint: embedEndpoint, apiKey,
            rerankerModel: reranker.model,
            timeoutMs: rerankTimeoutMs ?? 60_000,
        });
        const chosen = picked !== null ? candidates[picked] : candidates[0];
        return {
            article: chosen.article,
            score: chosen.score,
            reranked: true,
            rerankerPickedIndex: picked,
            candidates,
        };
    } catch {
        // Reranker failure is not fatal — fall back to top-1 cosine.
        return {
            article: candidates[0].article,
            score: candidates[0].score,
            reranked: false,
            rerankerFailed: true,
            candidates,
        };
    }
}

export async function runGeneralAgent({ prompt, provider = 'ollama', embedEndpoint, apiKey, embedModel, reranker }) {
    const { article, score, reranked, candidates } = await findBestArticle(prompt, {
        provider, embedEndpoint, apiKey, embedModel, reranker,
    });
    const body =
        `Here's a help article that should answer your question:\n\n` +
        `**${article.title}** (${article.category})\n${article.url}\n\n` +
        `If you have other questions about this topic, please contact our customer support.`;
    return { response: body, article, score, reranked, candidates };
}
