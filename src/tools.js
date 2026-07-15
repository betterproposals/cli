import { z } from 'zod';
import { companies, currencies, documents, documentTypes, settings, templates } from './api.js';
import { cliStatus } from './update.js';

// Single source of truth for the tools exposed both via MCP (`src/mcp.js`)
// and via the Llama agent loop (`src/ai.js`). Each tool is { name,
// description, inputSchema (zod raw shape), handler }. Handlers throw on
// failure; consumers wrap errors in their protocol's error shape.

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

export const TOOLS = [
    {
        name: 'documents_list',
        description: 'List all documents',
        inputSchema: paginationWithType,
        handler: ({ page, per_page, type }) => documents.list({ page, perPage: per_page, type }),
    },
    {
        name: 'documents_list_new',
        description: 'List new documents',
        inputSchema: paginationWithType,
        handler: ({ page, per_page, type }) => documents.listNew({ page, perPage: per_page, type }),
    },
    {
        name: 'documents_list_opened',
        description: 'List opened documents',
        inputSchema: paginationWithType,
        handler: ({ page, per_page, type }) => documents.listOpened({ page, perPage: per_page, type }),
    },
    {
        name: 'documents_list_sent',
        description: 'List sent documents',
        inputSchema: paginationWithType,
        handler: ({ page, per_page, type }) => documents.listSent({ page, perPage: per_page, type }),
    },
    {
        name: 'documents_list_signed',
        description: 'List signed documents',
        inputSchema: paginationWithType,
        handler: ({ page, per_page, type }) => documents.listSigned({ page, perPage: per_page, type }),
    },
    {
        name: 'documents_list_paid',
        description: 'List paid documents',
        inputSchema: paginationWithType,
        handler: ({ page, per_page, type }) => documents.listPaid({ page, perPage: per_page, type }),
    },
    {
        name: 'documents_get',
        description: 'Get a single document by ID',
        inputSchema: { id: z.number().int().positive().describe('Document ID') },
        handler: ({ id }) => documents.get(id),
    },
    {
        name: 'documents_count',
        description: 'Get total document count',
        inputSchema: {},
        handler: () => documents.count(),
    },
    {
        name: 'documents_create',
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
        handler: ({ company, cover, template, document_type, brand, currency, tax, tax_label, tax_amount, contacts, merge_tags }) =>
            documents.create({
                company, cover, template,
                documentType: document_type,
                brand, currency, tax,
                taxLabel: tax_label,
                taxAmount: tax_amount,
                contacts, mergeTags: merge_tags,
            }),
    },
    {
        name: 'documents_edit',
        description: 'Edit an existing document. Only the provided fields are changed. When contacts are provided they replace the existing ones; contacts that already signed are never removed or modified.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            company: z.string().optional().describe('Company ID or name. Creates a new company if the name is not found.'),
            cover: z.number().int().optional().describe('Cover ID'),
            document_type: z.string().optional().describe('Document type ID or name'),
            brand: z.number().int().optional().describe('Brand ID'),
            currency: z.string().length(3).optional().describe('Currency 3-letter code, e.g. USD'),
            tax: z.string().optional().describe('Enable tax'),
            tax_label: z.string().optional().describe('Tax label'),
            tax_amount: z.string().optional().describe('Tax amount'),
            description: z.string().optional().describe('Document description'),
            contacts: z.string().optional().describe('Contacts as JSON array, replaces the existing ones, e.g. [{"FirstName":"Jane","Surname":"Doe","Email":"jane@example.com","Signature":true}]'),
            merge_tags: z.string().optional().describe('Merge tags as JSON array, e.g. [{"tag":"my_tag","value":"My Value"}]'),
        },
        handler: ({ id, company, cover, document_type, brand, currency, tax, tax_label, tax_amount, description, contacts, merge_tags }) =>
            documents.edit({
                id, company, cover,
                documentType: document_type,
                brand, currency, tax,
                taxLabel: tax_label,
                taxAmount: tax_amount,
                description,
                contacts, mergeTags: merge_tags,
            }),
    },
    {
        name: 'documents_populate',
        description: 'Populate a document with sections and blocks, like the editor does. Each section becomes a page and can contain blocks of type: content (HTML content block), image (full width image), video, pricing (pricing block with tables and line items), acceptance (signing block) and library (Content Library element). A document can have only one pricing block and one acceptance block.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            sections: z.string().describe(
                'Sections as JSON array. Each section: {"Name":"Introduction","Blocks":[...]}. Blocks by type: ' +
                '{"Type":"content","Content":"<p>HTML</p>","Colour":"FFFFFF","TextColour":"2D2D2D"} (Content can be an array of 2 strings for two columns); ' +
                '{"Type":"image","ImageSrc":"https://...","AltText":"..."}; ' +
                '{"Type":"video","VideoType":"youtube|vimeo|wistia|upload","VideoSrc":"https://...","Layout":0}; ' +
                '{"Type":"pricing","Tables":[{"Title":"...","Items":[{"Label":"...","Description":"...","UnitCost":100,"Quantity":1,"RecurringType":"one-off|monthly|quarterly|annual","Optional":false}]}]}; ' +
                '{"Type":"acceptance","SignType":0,"ButtonText":"Sign Document","SignatureStatement":"..."}; ' +
                '{"Type":"library","LibraryElementID":123,"LibraryElementType":"customblock|text|video|bigphoto"}'
            ),
        },
        handler: ({ id, sections }) => documents.populate({ id, sections }),
    },
    {
        name: 'documents_send',
        description: 'Send a document to its recipients by email, each one receiving their personal link. Recipients that already signed cannot be removed or modified. If recipients is omitted, the document is sent to its existing contacts. Sending counts towards the monthly sending limit of the plan.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            subject: z.string().optional().describe('Email subject line. Supports merge tags like {{company_name}} and {{first_name}}. Omit to use the subject saved on the document or the brand default'),
            message: z.string().optional().describe('Personal message included in the email. Supports merge tags. Omit to use the message saved on the document or the brand default'),
            recipients: z.string().optional().describe('Recipients as JSON array (max 25), e.g. [{"FirstName":"Jane","Surname":"Doe","Email":"jane@example.com","RequiredToSign":true}]. Omit to send to the existing contacts.'),
            sign_order: z.boolean().optional().describe('When true, recipients must sign in the order they appear (default: false)'),
            password: z.string().optional().describe('Password protection for the document'),
            just_link_generation: z.boolean().optional().describe('When true, only generates the personal links without sending emails (default: false)'),
        },
        handler: ({ id, subject, message, recipients, sign_order, password, just_link_generation }) =>
            documents.send({
                id, subject, message, recipients,
                signOrder: sign_order,
                password,
                justLinkGeneration: just_link_generation,
            }),
    },
    {
        name: 'documents_create_cover',
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
        handler: ({ brand_id, cover_name, bg_colour, headline, subheader, text_colour, text_align, button_style, button_text }) =>
            documents.createCover({
                brandId: brand_id, coverName: cover_name, bgColour: bg_colour,
                headline, subheader, textColour: text_colour,
                textAlign: text_align, buttonStyle: button_style, buttonText: button_text,
            }),
    },
    {
        name: 'documents_edit_cover',
        description: 'Edit a document cover. Only the provided fields are changed.',
        inputSchema: {
            id: z.number().int().positive().describe('Cover ID'),
            brand_id: z.number().int().optional().describe('Brand ID'),
            cover_name: z.string().optional().describe('Cover name'),
            bg_colour: z.string().optional().describe('Background colour hex'),
            headline: z.string().optional().describe('Headline text'),
            subheader: z.string().optional().describe('Subheader text'),
            text_colour: z.string().optional().describe('Text colour hex'),
            text_align: z.string().optional().describe('Text alignment'),
            button_style: z.string().optional().describe('Button style'),
            button_text: z.string().optional().describe('Button text'),
        },
        handler: ({ id, brand_id, cover_name, bg_colour, headline, subheader, text_colour, text_align, button_style, button_text }) =>
            documents.editCover({
                id, brandId: brand_id, coverName: cover_name, bgColour: bg_colour,
                headline, subheader, textColour: text_colour,
                textAlign: text_align, buttonStyle: button_style, buttonText: button_text,
            }),
    },
    {
        name: 'settings_get',
        description: 'Get account settings',
        inputSchema: {},
        handler: () => settings.get(),
    },
    {
        name: 'settings_brand',
        description: 'Get brand settings',
        inputSchema: {},
        handler: () => settings.brand(),
    },
    {
        name: 'settings_merge_tags',
        description: 'Get custom merge tags',
        inputSchema: pagination,
        handler: ({ page, per_page }) => settings.mergeTags({ page, perPage: per_page }),
    },
    {
        name: 'currencies_list',
        description: 'List all currencies',
        inputSchema: pagination,
        handler: ({ page, per_page }) => currencies.list({ page, perPage: per_page }),
    },
    {
        name: 'currencies_get',
        description: 'Get a single currency by ID',
        inputSchema: { id: z.number().int().positive().describe('Currency ID') },
        handler: ({ id }) => currencies.get(id),
    },
    {
        name: 'companies_list',
        description: 'List all companies',
        inputSchema: pagination,
        handler: ({ page, per_page }) => companies.list({ page, perPage: per_page }),
    },
    {
        name: 'companies_get',
        description: 'Get a single company by ID',
        inputSchema: { id: z.number().int().positive().describe('Company ID') },
        handler: ({ id }) => companies.get(id),
    },
    {
        name: 'companies_create',
        description: 'Create a new company',
        inputSchema: { company_name: z.string().describe('Company name') },
        handler: ({ company_name }) => companies.create({ companyName: company_name }),
    },
    {
        name: 'document_types_list',
        description: 'List all custom document types created by the user',
        inputSchema: pagination,
        handler: ({ page, per_page }) => documentTypes.list({ page, perPage: per_page }),
    },
    {
        name: 'document_types_create',
        description: 'Create a new document type',
        inputSchema: {
            type_name: z.string().describe('Document type name'),
            type_colour: z.string().optional().describe('Colour hex code (default: #01A3EF)'),
        },
        handler: ({ type_name, type_colour }) => documentTypes.create({ typeName: type_name, typeColour: type_colour }),
    },
    {
        name: 'templates_list',
        description: 'List all templates',
        inputSchema: pagination,
        handler: ({ page, per_page }) => templates.list({ page, perPage: per_page }),
    },
    {
        name: 'templates_get',
        description: 'Get a single template by ID',
        inputSchema: { id: z.number().int().positive().describe('Template ID') },
        handler: ({ id }) => templates.get(id),
    },
    {
        name: 'cli_status',
        description: 'Report the Better Proposals CLI version and whether a newer release is available. Use when the user asks what version they are on, whether the CLI is up to date, or how to update.',
        inputSchema: {},
        handler: () => cliStatus(),
    },
];

export const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
