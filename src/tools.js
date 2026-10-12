import { z } from 'zod';
import { companies, currencies, documents, documentTypes, getLimits, settings, templates } from './api.js';
import { getCachedLimits, jsonLimitNote, valueLimitNote } from './limits.js';
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

// Every parameter sent to a write tool is capped independently by the API. The
// number is per-account and only known after an async lookup, so the schemas
// carry it as advisory description text rather than a zod .max() — a static cap
// baked in at module load would be wrong for allow-listed accounts. The real
// enforcement happens in api.js against the live value.
const LIMIT_NOTE = valueLimitNote(getCachedLimits());

// How the JSON-string fields are measured depends on the API version: value by
// value (per_value) or as ONE parameter sharing a single budget (per_parameter).
const JSON_LIMIT_NOTE = jsonLimitNote(getCachedLimits());

const ALL_TOOLS = [
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
        description: 'Get a single document by ID, with the link to open it in the editor of the app (Editor)',
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
        description: 'Create a new document. The response contains the link to open it in the editor of the app (Editor): always give it to the user, so they can check and edit the document before sending it',
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
            contacts: z.string().optional().describe('Contacts as JSON array, e.g. [{"FirstName":"Jane","Email":"jane@example.com"}]' + JSON_LIMIT_NOTE),
            merge_tags: z.string().optional().describe('Merge tags as JSON array, e.g. [{"tag":"my_tag","value":"My Value"}]' + JSON_LIMIT_NOTE),
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
        description: 'Edit an existing document. Only the provided fields are changed. When contacts are provided they replace the existing ones; contacts that already signed are never removed or modified. The response contains the link to open the document in the editor of the app (Editor).',
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
            merge_tags: z.string().optional().describe('Merge tags as JSON array, e.g. [{"tag":"my_tag","value":"My Value"}]' + JSON_LIMIT_NOTE),
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
            sign_order: z.boolean().optional().describe('When true, recipients must sign in the order they appear. Omit to keep the sign order saved on the document'),
            password: z.string().optional().describe('Password protection for the document. Omit to keep the password saved on the document, send an empty string to remove it'),
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
        name: 'documents_block_content',
        description: 'Add a content block (HTML, one or two columns) to a document, like the editor does. The block goes in an existing section (section = section ID), in a new section (section = name) or in a new untitled section, at the end of the section or at the given position.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            section: z.union([z.number().int().positive(), z.string()]).optional().describe('Existing section ID or name of a new section. Omit for a new untitled section'),
            position: z.number().int().positive().optional().describe('Position of the block in the section, starting from 1. Omit to append it at the end'),
            content: z.string().optional().describe('HTML content of the block, e.g. "<h2>Title</h2><p>Text</p>" (default: "<p>Start writing</p>")'),
            colour: z.string().optional().describe('Background colour hex without # (default: F5F5F5)'),
            text_colour: z.string().optional().describe('Text colour hex without # (default: 333333)'),
            wide: z.boolean().optional().describe('Wide block (default: false)'),
        },
        handler: ({ id, section, position, content, colour, text_colour, wide }) =>
            documents.block('content', { id, section, position, Content: content, Colour: colour, TextColour: text_colour, Wide: wide }),
    },
    {
        name: 'documents_block_image',
        description: 'Add a full width image block to a document, like the editor does. The block goes in an existing section (section = section ID), in a new section (section = name) or in a new untitled section, at the end of the section or at the given position.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            section: z.union([z.number().int().positive(), z.string()]).optional().describe('Existing section ID or name of a new section. Omit for a new untitled section'),
            position: z.number().int().positive().optional().describe('Position of the block in the section, starting from 1. Omit to append it at the end'),
            image_src: z.string().optional().describe('URL of the image'),
            alt_text: z.string().optional().describe('Alternative text of the image'),
        },
        handler: ({ id, section, position, image_src, alt_text }) =>
            documents.block('image', { id, section, position, ImageSrc: image_src, AltText: alt_text }),
    },
    {
        name: 'documents_block_video',
        description: 'Add a video block to a document, like the editor does. The block goes in an existing section (section = section ID), in a new section (section = name) or in a new untitled section, at the end of the section or at the given position.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            section: z.union([z.number().int().positive(), z.string()]).optional().describe('Existing section ID or name of a new section. Omit for a new untitled section'),
            position: z.number().int().positive().optional().describe('Position of the block in the section, starting from 1. Omit to append it at the end'),
            video_type: z.enum(['youtube', 'vimeo', 'wistia', 'upload']).optional().describe('Video provider'),
            video_src: z.string().optional().describe('URL of the video'),
            layout: z.number().int().min(0).max(2).optional().describe('0 normal, 1 wide, 2 full width (default: 0)'),
            bg_colour: z.string().optional().describe('Background colour hex without #'),
        },
        handler: ({ id, section, position, video_type, video_src, layout, bg_colour }) =>
            documents.block('video', { id, section, position, VideoType: video_type, VideoSrc: video_src, Layout: layout, BGColour: bg_colour }),
    },
    {
        name: 'documents_block_pricing',
        description: 'Add the pricing block to a document or, when the document already has one (e.g. created from a template), edit it: same tool for adding and updating pricing tables and line items. Tables and items without an ID are created; with an ID (returned by this tool and by documents_get PriceTables) they are updated, or deleted with "Delete": true. Changing UnitCost or Quantity of an item recalculates its total, changing Cost recalculates its unit cost. Quote totals are recalculated. When the tables or line items are more than the API accepts in a single request they are sent automatically with more requests. Returns the resulting PriceTables with IDs and the link to open the document in the editor of the app (Editor).',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            section: z.union([z.number().int().positive(), z.string()]).optional().describe('Used only when the block is added: existing section ID or name of a new section. Omit for a new untitled section'),
            position: z.number().int().positive().optional().describe('Used only when the block is added: position of the block in the section, starting from 1. Omit to append it at the end'),
            title: z.string().optional().describe('Title of the pricing block'),
            tables: z.string().optional().describe(
                'Pricing tables as JSON array. New table: {"Title":"Services","Items":[{"Label":"Website design","Description":"...","UnitCost":1000,"Quantity":1,"RecurringType":"one-off|monthly|quarterly|annual","Optional":false}]}. ' +
                'Edit existing table/items: {"ID":444,"Title":"New title","Items":[{"ID":555,"UnitCost":1200},{"ID":556,"Delete":true},{"Label":"New item","UnitCost":300}]}. Delete a table: {"ID":444,"Delete":true}.' + JSON_LIMIT_NOTE
            ),
        },
        handler: ({ id, section, position, title, tables }) =>
            documents.pricingBlock({ id, section, position, title, tables }),
    },
    {
        name: 'documents_block_acceptance',
        description: 'Add the acceptance (signing) block to a document, like the editor does. A document can have only one acceptance block. The block goes in an existing section (section = section ID), in a new section (section = name) or in a new untitled section, at the end of the section or at the given position.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            section: z.union([z.number().int().positive(), z.string()]).optional().describe('Existing section ID or name of a new section. Omit for a new untitled section'),
            position: z.number().int().positive().optional().describe('Position of the block in the section, starting from 1. Omit to append it at the end'),
            sign_type: z.number().int().min(0).max(1).optional().describe('0 signature, 1 acceptance button (default: 0)'),
            button_text: z.string().optional().describe('Text of the button'),
            signature_statement: z.string().optional().describe('Statement shown next to the signature'),
            options: z.string().optional().describe('Options the client can choose from, as JSON array of strings'),
        },
        handler: ({ id, section, position, sign_type, button_text, signature_statement, options }) =>
            documents.block('acceptance', { id, section, position, SignType: sign_type, ButtonText: button_text, SignatureStatement: signature_statement, Options: options }),
    },
    {
        name: 'documents_block_library',
        description: 'Add a Content Library element to a document, like the editor does. The block goes in an existing section (section = section ID), in a new section (section = name) or in a new untitled section, at the end of the section or at the given position.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            section: z.union([z.number().int().positive(), z.string()]).optional().describe('Existing section ID or name of a new section. Omit for a new untitled section'),
            position: z.number().int().positive().optional().describe('Position of the block in the section, starting from 1. Omit to append it at the end'),
            library_element_id: z.number().int().positive().describe('Content Library element ID'),
            library_element_type: z.enum(['customblock', 'text', 'video', 'bigphoto']).describe('Content Library element type'),
        },
        handler: ({ id, section, position, library_element_id, library_element_type }) =>
            documents.block('library', { id, section, position, LibraryElementID: library_element_id, LibraryElementType: library_element_type }),
    },
    {
        name: 'documents_links',
        description: 'Generate the personal link of every recipient of a document WITHOUT sending any email, so the user can deliver the links. Recipients are saved as document contacts; recipients that already signed cannot be removed or modified. If recipients is omitted, the links are generated for the existing contacts. Counts as a send towards the monthly sending limit of the plan and follows the same rules as the send page. Always give the user the editor link (Editor, returned when the document is created, edited or read) and let them check the document before generating the links.',
        inputSchema: {
            id: z.number().int().positive().describe('Document ID'),
            recipients: z.string().optional().describe('Recipients as JSON array (max 25), e.g. [{"FirstName":"Jane","Surname":"Doe","Email":"jane@example.com","RequiredToSign":true}]. Omit to use the existing contacts.'),
            sign_order: z.boolean().optional().describe('When true, recipients must sign in the order they appear. Omit to keep the sign order saved on the document'),
            password: z.string().optional().describe('Password protection for the document. Omit to keep the password saved on the document, send an empty string to remove it'),
        },
        handler: ({ id, recipients, sign_order, password }) =>
            documents.links({ id, recipients, signOrder: sign_order, password }),
    },
    {
        name: 'documents_create_cover',
        description: 'Create a document cover',
        inputSchema: {
            brand_id: z.number().int().optional().describe('Brand ID'),
            cover_name: z.string().optional().describe('Cover name (default: Untitled)' + LIMIT_NOTE),
            bg_colour: z.string().optional().describe('Background colour hex (default: 111111)'),
            headline: z.string().optional().describe('Headline text' + LIMIT_NOTE),
            subheader: z.string().optional().describe('Subheader text' + LIMIT_NOTE),
            text_colour: z.string().optional().describe('Text colour hex (default: ffffff)'),
            text_align: z.string().optional().describe('Text alignment (default: left)'),
            button_style: z.string().optional().describe('Button style (default: round)'),
            button_text: z.string().optional().describe('Button text' + LIMIT_NOTE),
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
        inputSchema: { company_name: z.string().describe('Company name' + LIMIT_NOTE) },
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
            type_name: z.string().describe('Document type name' + LIMIT_NOTE),
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
        name: 'api_limits',
        description:
            'Report the maximum size allowed for the values sent when creating or updating data. ' +
            'The limit varies by account, so call this before writing long content — merge tag values, ' +
            'cover headlines, contact lists, pricing items — to check the budget you actually have. ' +
            'With scope per_value every single value is capped (in characters), field_max_length lists the fields ' +
            'allowed more, list_max_items the max entries of the lists per request and request_max_length the max ' +
            'bytes of a request; with scope per_parameter every parameter is capped as a whole, in UTF-8 bytes.',
        inputSchema: {},
        handler: () => getLimits(),
    },
    {
        name: 'cli_status',
        description: 'Report the Better Proposals CLI version and whether a newer release is available. Use when the user asks what version they are on, whether the CLI is up to date, or how to update.',
        inputSchema: {},
        handler: () => cliStatus(),
    },
];

// Tools of the endpoints switched off in the API (API_DISABLED_ENDPOINTS in the
// API repo .env): kept here so they can be released one at a time by removing
// them from this list. The full documents_populate and documents_send tools
// will replace the single block and links tools once fully unlocked.
export const DISABLED_TOOLS = [
    'documents_populate',
    'documents_send',
    'documents_block_content',
    'documents_block_image',
    'documents_block_video',
    'documents_block_acceptance',
    'documents_block_library',
];

export const TOOLS = ALL_TOOLS.filter((t) => !DISABLED_TOOLS.includes(t.name));

export const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
