#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { companies, currencies, documents, documentTypes, settings, templates } from './api.js';

const server = new McpServer({
    name: 'Better Proposals',
    version: '0.0.1',
});

function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(error) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
}

const pageSchema = z.number().int().positive().optional().default(1).describe('Page number');
const perPageSchema = z.number().int().positive().optional().default(10).describe('Results per page');
const typeSchema = z.number().int().optional().describe(
    'Document type filter ID. ' +
    'Built-in types: 1=Proposals, 2=Quotes, 3=Brochures, 4=Statements of Work, ' +
    '5=Contracts, 6=Sign offs, 7=Job Offers. ' +
    'Users may also have custom types — use the document_types_list tool to discover them.'
);

const pagination = { page: pageSchema, per_page: perPageSchema };
const paginationWithType = { ...pagination, type: typeSchema };

// Documents
server.registerTool('documents_list', {
    description: 'List all documents',
    inputSchema: paginationWithType,
}, async ({ page, per_page, type }) => {
    try { return ok(await documents.list({ page, perPage: per_page, type })); } catch (e) { return err(e); }
});

server.registerTool('documents_list_new', {
    description: 'List new documents',
    inputSchema: paginationWithType,
}, async ({ page, per_page, type }) => {
    try { return ok(await documents.listNew({ page, perPage: per_page, type })); } catch (e) { return err(e); }
});

server.registerTool('documents_list_opened', {
    description: 'List opened documents',
    inputSchema: paginationWithType,
}, async ({ page, per_page, type }) => {
    try { return ok(await documents.listOpened({ page, perPage: per_page, type })); } catch (e) { return err(e); }
});

server.registerTool('documents_list_sent', {
    description: 'List sent documents',
    inputSchema: paginationWithType,
}, async ({ page, per_page, type }) => {
    try { return ok(await documents.listSent({ page, perPage: per_page, type })); } catch (e) { return err(e); }
});

server.registerTool('documents_list_signed', {
    description: 'List signed documents',
    inputSchema: paginationWithType,
}, async ({ page, per_page, type }) => {
    try { return ok(await documents.listSigned({ page, perPage: per_page, type })); } catch (e) { return err(e); }
});

server.registerTool('documents_list_paid', {
    description: 'List paid documents',
    inputSchema: paginationWithType,
}, async ({ page, per_page, type }) => {
    try { return ok(await documents.listPaid({ page, perPage: per_page, type })); } catch (e) { return err(e); }
});

server.registerTool('documents_get', {
    description: 'Get a single document by ID',
    inputSchema: { id: z.number().int().positive().describe('Document ID') },
}, async ({ id }) => {
    try { return ok(await documents.get(id)); } catch (e) { return err(e); }
});

server.registerTool('documents_count', {
    description: 'Get total document count',
    inputSchema: {},
}, async () => {
    try { return ok(await documents.count()); } catch (e) { return err(e); }
});

server.registerTool('documents_create', {
    description: 'Create a new document',
    inputSchema: {
        company: z.string().describe('Company ID or name. Creates a new company if the name is not found.'),
        cover: z.number().int().optional().describe('Cover ID'),
        template: z.number().int().optional().describe('Template ID to copy from'),
        document_type: z.string().optional().describe('Document type ID or name'),
        brand: z.number().int().optional().describe('Brand ID (uses default brand if omitted)'),
        currency: z.string().length(3).optional().describe('Currency 3-letter code, e.g. USD'),
        tax: z.string().optional().describe('Enable tax'),
        tax_label: z.string().optional().describe('Tax label'),
        tax_amount: z.string().optional().describe('Tax amount'),
        contacts: z.string().optional().describe('Contacts as JSON array, e.g. [{"FirstName":"Jane","Email":"jane@example.com"}]'),
        merge_tags: z.string().optional().describe('Merge tags as JSON array, e.g. [{"tag":"my_tag","value":"My Value"}]'),
    },
}, async ({ company, cover, template, document_type, brand, currency, tax, tax_label, tax_amount, contacts, merge_tags }) => {
    try {
        return ok(await documents.create({
            company, cover, template,
            documentType: document_type,
            brand, currency, tax,
            taxLabel: tax_label,
            taxAmount: tax_amount,
            contacts, mergeTags: merge_tags,
        }));
    } catch (e) { return err(e); }
});

server.registerTool('documents_create_cover', {
    description: 'Create a document cover',
    inputSchema: {
        brand_id: z.number().int().optional().describe('Brand ID'),
        cover_name: z.string().optional().describe('Cover name (default: Untitled)'),
        bg_colour: z.string().optional().describe('Background colour hex (default: 111111)'),
        headline: z.string().optional().describe('Headline text'),
        subheader: z.string().optional().describe('Subheader text'),
        text_colour: z.string().optional().describe('Text colour hex (default: ffffff)'),
        text_align: z.string().optional().describe('Text alignment (default: left)'),
        button_style: z.string().optional().describe('Button style (default: round)'),
        button_text: z.string().optional().describe('Button text'),
    },
}, async ({ brand_id, cover_name, bg_colour, headline, subheader, text_colour, text_align, button_style, button_text }) => {
    try {
        return ok(await documents.createCover({
            brandId: brand_id, coverName: cover_name, bgColour: bg_colour,
            headline, subheader, textColour: text_colour,
            textAlign: text_align, buttonStyle: button_style, buttonText: button_text,
        }));
    } catch (e) { return err(e); }
});

// Settings
server.registerTool('settings_get', {
    description: 'Get account settings',
    inputSchema: {},
}, async () => {
    try { return ok(await settings.get()); } catch (e) { return err(e); }
});

server.registerTool('settings_brand', {
    description: 'Get brand settings',
    inputSchema: {},
}, async () => {
    try { return ok(await settings.brand()); } catch (e) { return err(e); }
});

server.registerTool('settings_merge_tags', {
    description: 'Get custom merge tags',
    inputSchema: pagination,
}, async ({ page, per_page }) => {
    try { return ok(await settings.mergeTags({ page, perPage: per_page })); } catch (e) { return err(e); }
});

// Currencies
server.registerTool('currencies_list', {
    description: 'List all currencies',
    inputSchema: pagination,
}, async ({ page, per_page }) => {
    try { return ok(await currencies.list({ page, perPage: per_page })); } catch (e) { return err(e); }
});

server.registerTool('currencies_get', {
    description: 'Get a single currency by ID',
    inputSchema: { id: z.number().int().positive().describe('Currency ID') },
}, async ({ id }) => {
    try { return ok(await currencies.get(id)); } catch (e) { return err(e); }
});

// Companies
server.registerTool('companies_list', {
    description: 'List all companies',
    inputSchema: pagination,
}, async ({ page, per_page }) => {
    try { return ok(await companies.list({ page, perPage: per_page })); } catch (e) { return err(e); }
});

server.registerTool('companies_get', {
    description: 'Get a single company by ID',
    inputSchema: { id: z.number().int().positive().describe('Company ID') },
}, async ({ id }) => {
    try { return ok(await companies.get(id)); } catch (e) { return err(e); }
});

server.registerTool('companies_create', {
    description: 'Create a new company',
    inputSchema: { company_name: z.string().describe('Company name') },
}, async ({ company_name }) => {
    try { return ok(await companies.create({ companyName: company_name })); } catch (e) { return err(e); }
});

// Document types
server.registerTool('document_types_list', {
    description: 'List all custom document types created by the user',
    inputSchema: pagination,
}, async ({ page, per_page }) => {
    try { return ok(await documentTypes.list({ page, perPage: per_page })); } catch (e) { return err(e); }
});

server.registerTool('document_types_create', {
    description: 'Create a new document type',
    inputSchema: {
        type_name: z.string().describe('Document type name'),
        type_colour: z.string().optional().describe('Colour hex code (default: #01A3EF)'),
    },
}, async ({ type_name, type_colour }) => {
    try { return ok(await documentTypes.create({ typeName: type_name, typeColour: type_colour })); } catch (e) { return err(e); }
});

// Templates
server.registerTool('templates_list', {
    description: 'List all templates',
    inputSchema: pagination,
}, async ({ page, per_page }) => {
    try { return ok(await templates.list({ page, perPage: per_page })); } catch (e) { return err(e); }
});

server.registerTool('templates_get', {
    description: 'Get a single template by ID',
    inputSchema: { id: z.number().int().positive().describe('Template ID') },
}, async ({ id }) => {
    try { return ok(await templates.get(id)); } catch (e) { return err(e); }
});

const transport = new StdioServerTransport();
await server.connect(transport);
