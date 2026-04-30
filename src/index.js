#!/usr/bin/env bun
import { Command } from 'commander';
import { login } from './auth.js';
import { documents } from './api.js';

const program = new Command();

program
    .name('betterproposals')
    .description('Official CLI for Better Proposals')
    .version('0.0.1');

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

await program.parseAsync(process.argv);