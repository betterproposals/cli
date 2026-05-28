import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ollamaEmbed } from './ollama.js';
import { cosineSimilarity } from './triage.js';

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
const ARTICLE_EMBEDS_CACHE = join(homedir(), '.betterproposals', 'help-article-embeds.json');

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

async function ensureArticleEmbeddings({ embedEndpoint, embedModel }) {
    const articles = loadArticles();
    const fingerprint = articlesFingerprint(articles);

    if (existsSync(ARTICLE_EMBEDS_CACHE)) {
        try {
            const cached = JSON.parse(readFileSync(ARTICLE_EMBEDS_CACHE, 'utf8'));
            if (cached.model === embedModel && cached.fingerprint === fingerprint) {
                return cached.embeddings;
            }
        } catch {
            // Corrupt cache — fall through and recompute.
        }
    }

    const embeddings = await ollamaEmbed({
        endpoint: embedEndpoint,
        model: embedModel,
        input: articles.map(articleText),
    });
    mkdirSync(dirname(ARTICLE_EMBEDS_CACHE), { recursive: true });
    writeFileSync(
        ARTICLE_EMBEDS_CACHE,
        JSON.stringify({ model: embedModel, fingerprint, embeddings }),
        'utf8',
    );
    return embeddings;
}

export async function findBestArticle(query, { embedEndpoint, embedModel }) {
    const articles = loadArticles();
    const embeddings = await ensureArticleEmbeddings({ embedEndpoint, embedModel });
    const queryEmbed = await ollamaEmbed({ endpoint: embedEndpoint, model: embedModel, input: query });

    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < embeddings.length; i++) {
        const score = cosineSimilarity(queryEmbed, embeddings[i]);
        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }
    return { article: articles[bestIdx], score: bestScore };
}

export async function runGeneralAgent({ prompt, embedEndpoint, embedModel }) {
    const { article, score } = await findBestArticle(prompt, { embedEndpoint, embedModel });
    const body =
        `Here's a help article that should answer your question:\n\n` +
        `**${article.title}** (${article.category})\n${article.url}\n\n` +
        `If you have other questions about this topic, please contact our customer support.`;
    return { response: body, article, score };
}
