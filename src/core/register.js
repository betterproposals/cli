// Claude cuts a tool result at about 150,000 characters; this is the line before
// that, so the model is told to narrow the request instead of reading a cut answer.
export const MAX_RESULT_CHARS = 100000;

// Long texts are cut in steps (descriptions and HTML are what makes a document
// big: a line item description can have 10,000 characters) until the answer fits.
const CUT_STEPS = [2000, 500, 200];

function cutTexts(value, max) {
    if (typeof value === 'string') {
        return value.length > max ? `${value.slice(0, max)}…[cut, ${value.length} chars]` : value;
    }
    if (Array.isArray(value)) return value.map((item) => cutTexts(item, max));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cutTexts(item, max)]));
    }

    return value;
}

function withNotice(data, max) {
    const notice = `Long texts were cut to ${max} characters, marked "…[cut, N chars]", so the answer fits. ` +
        'Never send a cut text back in a write: it would replace the full one.';

    return Array.isArray(data) ? { _notice: notice, data } : { _notice: notice, ...data };
}

// The longest answer that fits with the long texts cut, or null
function shrink(data, maxChars) {
    if (data === null || typeof data !== 'object') return null;

    for (const max of CUT_STEPS) {
        const text = JSON.stringify(withNotice(cutTexts(data, max), max));
        if (text.length <= maxChars) return text;
    }

    return null;
}

function ok(data, maxChars, isWrite) {
    const text = JSON.stringify(data);
    if (text.length <= maxChars) return { content: [{ type: 'text', text }] };

    const shrunk = shrink(data, maxChars);
    if (shrunk !== null) return { content: [{ type: 'text', text: shrunk }] };

    // A write was already saved: an error would make the AI send it again and
    // create the same items twice
    if (isWrite) {
        return {
            content: [{
                type: 'text',
                text: `Saved. The answer is too large to show (${text.length} characters, the limit is ${maxChars}). ` +
                    'Do not send the request again: read the document with documents_get to check the result.',
            }],
        };
    }

    return err(new Error(
        `The answer is too large to return (${text.length} characters, the limit is ${maxChars}). ` +
        'Ask for less: a smaller per_page, a filter, or documents_get for a single document.'
    ));
}

function err(error) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
}

/** Register the tools on an McpServer, answering in the MCP result shape. */
export function registerTools(server, tools, { maxResultChars = MAX_RESULT_CHARS } = {}) {
    for (const { name, description, inputSchema, annotations, handler } of tools) {
        server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
            try { return ok(await handler(args), maxResultChars, annotations?.readOnlyHint === false); } catch (e) { return err(e); }
        });
    }
}
