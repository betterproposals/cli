#!/usr/bin/env bun
import { Command } from 'commander';
import { login, logout } from './auth.js';
import { companies, currencies, documents, documentTypes, settings, templates } from './api.js';

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

await program.parseAsync(process.argv);