#!/usr/bin/env bun
import { Command } from 'commander';
import { login, logout } from './auth.js';
import { companies, currencies, documents, documentTypes, settings, templates } from './api.js';
import { install, uninstall, TARGETS } from './mcp-install.js';
import { runAgent } from './ai.js';
import { ask } from './ask.js';
import { update, notifyUpdate, refreshUpdateCache } from './update.js';
import pkg from '../package.json';

const program = new Command();

program
    .name('betterproposals')
    .description('Official CLI for Better Proposals')
    .version(pkg.version);

// After any command runs, nudge the user if a newer version is available.
// Skipped for `update` (redundant) and the hidden refresh command (recursion).
program.hook('postAction', (_thisCmd, actionCmd) => {
    const name = actionCmd.name();
    if (name === 'update' || name === '__refresh-update-cache') return;
    notifyUpdate();
});

// Hidden: spawned detached by notifyUpdate() to refresh the version-check cache.
program
    .command('__refresh-update-cache', { hidden: true })
    .action(async () => {
        try {
            await refreshUpdateCache();
        } catch {
            /* silent */
        }
    });

program
    .command('login')
    .description('Authenticate the CLI with your Better Proposals account')
    .action(async () => {
        try {
            await login();
        } catch (err) {
            console.error('Login failed:', err.message);
            process.exit(1);
        }
    });

program
    .command('logout')
    .description('Log out and remove stored credentials')
    .action(async () => {
        try {
            await logout();
        } catch (err) {
            console.error('Logout failed:', err.message);
            process.exit(1);
        }
    });

program
    .command('update')
    .description('Check for a newer version and update the CLI in place')
    .option('--check', 'Only check whether a newer version exists; do not install')
    .option('--force', 'Reinstall the latest version even if already up to date')
    .action(async (opts) => {
        try {
            await update({ check: opts.check, force: opts.force });
        } catch (err) {
            console.error('Update failed:', err.message);
            process.exit(1);
        }
    });

const documentsCmd = program
    .command('documents')
    .description('Manage documents');

documentsCmd
    .command('all')
    .description('List all documents')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .option('-t, --type <number>', 'Document type filter')
    .action(async (opts) => {
        try {
            const data = await documents.list({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
                type: opts.type !== undefined ? Number(opts.type) : undefined,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('create-cover')
    .description('Create a document cover')
    .option('--brand-id <id>', 'Brand ID')
    .option('--cover-name <name>', 'Cover name (default: Untitled)')
    .option('--bg-colour <hex>', 'Background colour (default: 111111)')
    .option('--headline <text>', 'Headline text')
    .option('--subheader <text>', 'Subheader text')
    .option('--text-colour <hex>', 'Text colour (default: ffffff)')
    .option('--text-align <align>', 'Text alignment (default: left)')
    .option('--button-style <style>', 'Button style (default: round)')
    .option('--button-text <text>', 'Button text')
    .action(async (opts) => {
        try {
            const data = await documents.createCover({
                brandId: opts.brandId,
                coverName: opts.coverName,
                bgColour: opts.bgColour,
                headline: opts.headline,
                subheader: opts.subheader,
                textColour: opts.textColour,
                textAlign: opts.textAlign,
                buttonStyle: opts.buttonStyle,
                buttonText: opts.buttonText,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('count')
    .description('Get total document count')
    .action(async () => {
        try {
            const data = await documents.count();
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('get <id>')
    .description('Get document details')
    .action(async (id) => {
        try {
            const data = await documents.get(id);
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('paid')
    .description('List paid documents')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .option('-t, --type <number>', 'Document type filter')
    .action(async (opts) => {
        try {
            const data = await documents.listPaid({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
                type: opts.type !== undefined ? Number(opts.type) : undefined,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('signed')
    .description('List signed documents')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .option('-t, --type <number>', 'Document type filter')
    .action(async (opts) => {
        try {
            const data = await documents.listSigned({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
                type: opts.type !== undefined ? Number(opts.type) : undefined,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('sent')
    .description('List sent documents')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .option('-t, --type <number>', 'Document type filter')
    .action(async (opts) => {
        try {
            const data = await documents.listSent({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
                type: opts.type !== undefined ? Number(opts.type) : undefined,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('opened')
    .description('List opened documents')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .option('-t, --type <number>', 'Document type filter')
    .action(async (opts) => {
        try {
            const data = await documents.listOpened({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
                type: opts.type !== undefined ? Number(opts.type) : undefined,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('new')
    .description('List new documents')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .option('-t, --type <number>', 'Document type filter')
    .action(async (opts) => {
        try {
            const data = await documents.listNew({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
                type: opts.type !== undefined ? Number(opts.type) : undefined,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentsCmd
    .command('create')
    .description('Create a new document')
    .requiredOption('-c, --company <value>', 'Company ID or name (creates new if name not found)')
    .option('--cover <id>', 'Cover ID')
    .option('--template <id>', 'Template ID to copy from')
    .option('--document-type <value>', 'Document type ID or name')
    .option('--brand <id>', 'Brand ID')
    .option('--currency <code>', 'Currency (3-letter code, e.g. USD)')
    .option('--tax <value>', 'Enable tax (takes from default brand if omitted)')
    .option('--tax-label <label>', 'Tax label')
    .option('--tax-amount <amount>', 'Tax amount')
    .option('--contacts <json>', 'Contacts as JSON array, e.g. \'[{"FirstName":"Jane","Email":"jane@example.com"}]\'')
    .option('--merge-tags <json>', 'Merge tags as JSON array, e.g. \'[{"tag":"my_tag","value":"My Value"}]\'')
    .action(async (opts) => {
        try {
            const data = await documents.create({
                company: opts.company,
                cover: opts.cover,
                template: opts.template,
                documentType: opts.documentType,
                brand: opts.brand,
                currency: opts.currency,
                tax: opts.tax,
                taxLabel: opts.taxLabel,
                taxAmount: opts.taxAmount,
                contacts: opts.contacts,
                mergeTags: opts.mergeTags,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

const settingsCmd = program
    .command('settings')
    .description('Manage settings');

settingsCmd
    .command('get')
    .description('Get account settings')
    .action(async () => {
        try {
            const data = await settings.get();
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

settingsCmd
    .command('brands')
    .description('Get brand settings')
    .action(async () => {
        try {
            const data = await settings.brand();
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

settingsCmd
    .command('merge-tags')
    .description('Get custom merge tags')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .action(async (opts) => {
        try {
            const data = await settings.mergeTags({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

const currenciesCmd = program
    .command('currencies')
    .description('Manage currencies');

currenciesCmd
    .command('all')
    .description('List all currencies')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .action(async (opts) => {
        try {
            const data = await currencies.list({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

currenciesCmd
    .command('get <id>')
    .description('Get currency details')
    .action(async (id) => {
        try {
            const data = await currencies.get(id);
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

const companiesCmd = program
    .command('companies')
    .description('Manage companies');

companiesCmd
    .command('all')
    .description('List all companies')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .action(async (opts) => {
        try {
            const data = await companies.list({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

companiesCmd
    .command('get <id>')
    .description('Get company details')
    .action(async (id) => {
        try {
            const data = await companies.get(id);
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

companiesCmd
    .command('create')
    .description('Create a new company')
    .requiredOption('-n, --company-name <name>', 'Company name')
    .action(async (opts) => {
        try {
            const data = await companies.create({ companyName: opts.companyName });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

const documentTypesCmd = program
    .command('document-types')
    .description('Manage document types');

documentTypesCmd
    .command('all')
    .description('List all document types')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .action(async (opts) => {
        try {
            const data = await documentTypes.list({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

documentTypesCmd
    .command('create')
    .description('Create a new document type')
    .requiredOption('--type-name <name>', 'Document type name')
    .option('--type-colour <hex>', 'Colour hex code (default: #01A3EF)')
    .action(async (opts) => {
        try {
            const data = await documentTypes.create({
                typeName: opts.typeName,
                typeColour: opts.typeColour,
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

const templatesCmd = program
    .command('templates')
    .description('Manage templates');

templatesCmd
    .command('get <id>')
    .description('Get template details')
    .action(async (id) => {
        try {
            const data = await templates.get(id);
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

templatesCmd
    .command('all')
    .description('List all templates')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-n, --per-page <number>', 'Results per page', '10')
    .action(async (opts) => {
        try {
            const data = await templates.list({
                page: Number(opts.page),
                perPage: Number(opts.perPage),
            });
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

const mcpCmd = program
    .command('mcp')
    .description('MCP server management');

mcpCmd
    .command('install <target>')
    .description(`Register the MCP server with an agent config. Targets: ${TARGETS.join(', ')}`)
    .action((target) => {
        try {
            install(target);
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

mcpCmd
    .command('uninstall <target>')
    .description(`Remove the MCP server from an agent config. Targets: ${TARGETS.join(', ')}`)
    .action((target) => {
        try {
            uninstall(target);
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

program
    .command('ai <prompt>')
    .description('Send a natural-language prompt to a Llama (Ollama-compatible) endpoint with access to all Better Proposals tools')
    .option('--endpoint <url>', 'Ollama-compatible chat endpoint (env: BETTERPROPOSALS_LLAMA_URL)')
    .option('--openrouter', 'Use the OpenRouter API instead of local Ollama (needs OPENROUTER_API_KEY; default model qwen/qwen3.5-9b)')
    .option('--model <name>', 'Model name to use (env: BETTERPROPOSALS_LLAMA_MODEL)')
    .option('--system <text>', 'Override the default system prompt')
    .option('--max-iterations <n>', 'Maximum tool-calling rounds before giving up', '8')
    .option('--timeout <seconds>', 'Per-request timeout in seconds (env: BETTERPROPOSALS_LLAMA_TIMEOUT)')
    .option('--num-ctx <n>', 'Ollama context window in tokens (env: BETTERPROPOSALS_LLAMA_NUM_CTX)')
    .option('--max-tool-items <n>', 'Max items kept from a tool result `data` array (env: BETTERPROPOSALS_LLAMA_MAX_TOOL_ITEMS)')
    .option('--session <id>', 'Persist conversation history under this ID so multi-turn chat works across invocations (env: BETTERPROPOSALS_LLAMA_SESSION)')
    .option('--json', 'Output a structured JSON object including the tool-call trace')
    .action(async (prompt, opts) => {
        try {
            const result = await runAgent({
                prompt,
                provider: opts.openrouter ? 'openrouter' : undefined,
                endpoint: opts.endpoint,
                model: opts.model,
                system: opts.system,
                maxIterations: Number(opts.maxIterations),
                timeoutMs: opts.timeout ? Number(opts.timeout) * 1000 : undefined,
                numCtx: opts.numCtx ? Number(opts.numCtx) : undefined,
                maxToolResultItems: opts.maxToolItems ? Number(opts.maxToolItems) : undefined,
                sessionId: opts.session,
            });
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(result.response);
            }
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

program
    .command('ask <prompt>')
    .description('Triage a prompt: article match for how-to questions, MCP agent (tiered qwen3.5) for actions on your account data')
    .option('--endpoint <url>', 'Ollama-compatible chat endpoint for translation + embeddings (env: BETTERPROPOSALS_LLAMA_URL)')
    .option('--openrouter', 'Run the whole pipeline on OpenRouter — translation, embeddings, and agent (needs OPENROUTER_API_KEY; no local Ollama required)')
    .option('--translator-in <name>', 'Model used to translate user input → English (env: BETTERPROPOSALS_TRANSLATOR_IN)')
    .option('--translator-out <name>', 'Model used to translate response → user language (env: BETTERPROPOSALS_TRANSLATOR_OUT)')
    .option('--embed-model <name>', 'Model used for triage + article embeddings (env: BETTERPROPOSALS_EMBED_MODEL)')
    .option('--reranker-model <name>', 'Model used to rerank the top-K article candidates on the general path (OpenRouter default: deepseek/deepseek-v4-flash; env: BETTERPROPOSALS_RERANKER_MODEL)')
    .option('--no-reranker', 'Disable the LLM reranker on the general path (falls back to top-1 cosine)')
    .option('--mcp-model <name>', 'Explicit MCP model — overrides the tier-based auto-selection')
    .option('--mcp-tier <tier>', 'Force MCP tier: simple / medium / complex (model per tier depends on provider)')
    .option('--mcp-timeout <seconds>', 'Per-request timeout for the MCP model in seconds')
    .option('--translate-timeout <seconds>', 'Per-request timeout for translation calls in seconds')
    .option('--no-translate', 'Skip the language roundtrip (treat input as English)')
    .option('--force <path>', 'Bypass triage: "general" or "mcp"')
    .option('--triage-only', 'Print the triage decision without running the route')
    .option('--session <id>', 'Persist conversation history (only used on the MCP path)')
    .option('--num-ctx <n>', 'Ollama context window in tokens (MCP path only)')
    .option('--max-iterations <n>', 'Max tool-calling rounds on the MCP path', '8')
    .option('--max-tool-items <n>', 'Max items kept from a tool result `data` array on the MCP path')
    .option('--token <value>', 'Use this Better Proposals API token instead of local credentials (server-side / web-agent use; implies --openrouter)')
    .option('--json', 'Output the structured ask result (path, scores, response, trace) as JSON')
    .action(async (prompt, opts) => {
        try {
            if (opts.token) {
                const { setOverrideToken } = await import('./auth.js');
                setOverrideToken(opts.token);
            }
            const useOpenRouter = opts.openrouter || !!opts.token;
            const result = await ask({
                prompt,
                provider: useOpenRouter ? 'openrouter' : undefined,
                endpoint: opts.endpoint,
                translatorInModel: opts.translatorIn,
                translatorOutModel: opts.translatorOut,
                embedModel: opts.embedModel,
                rerankerModel: opts.rerankerModel,
                noReranker: opts.reranker === false,
                mcpModel: opts.mcpModel,
                mcpTier: opts.mcpTier,
                mcpTimeoutMs: opts.mcpTimeout ? Number(opts.mcpTimeout) * 1000 : undefined,
                translateTimeoutMs: opts.translateTimeout ? Number(opts.translateTimeout) * 1000 : undefined,
                translate: opts.translate,
                force: opts.force,
                triageOnly: opts.triageOnly,
                sessionId: opts.session,
                numCtx: opts.numCtx ? Number(opts.numCtx) : undefined,
                maxIterations: opts.maxIterations ? Number(opts.maxIterations) : undefined,
                maxToolResultItems: opts.maxToolItems ? Number(opts.maxToolItems) : undefined,
            });
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            } else if (opts.triageOnly) {
                console.log(`path: ${result.decision.path}`);
                console.log(`generalScore: ${result.decision.generalScore?.toFixed(4) ?? 'n/a'}  (best anchor: ${result.decision.generalBest ?? 'n/a'})`);
                console.log(`mcpScore:     ${result.decision.mcpScore?.toFixed(4) ?? 'n/a'}  (best anchor: ${result.decision.mcpBest ?? 'n/a'})`);
                console.log(`language: ${result.language} (${result.languageName})`);
                console.log(`englishPrompt: ${result.englishPrompt}`);
            } else {
                console.log(result.response);
            }
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }
    });

await program.parseAsync(process.argv);