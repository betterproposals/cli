// Claude cuts a tool result at about 150,000 characters; this is the line before
// that, so the model is told to narrow the request instead of reading a cut answer.
export const MAX_RESULT_CHARS = 100000;

function ok(data, maxChars) {
    const text = JSON.stringify(data);
    if (text.length > maxChars) {
        return err(new Error(
            `The answer is too large to return (${text.length} characters, the limit is ${maxChars}). ` +
            'Ask for less: a smaller per_page, a filter, or documents_get for a single document.'
        ));
    }
    return { content: [{ type: 'text', text }] };
}

function err(error) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
}

/** Register the tools on an McpServer, answering in the MCP result shape. */
export function registerTools(server, tools, { maxResultChars = MAX_RESULT_CHARS } = {}) {
    for (const { name, description, inputSchema, annotations, handler } of tools) {
        server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
            try { return ok(await handler(args), maxResultChars); } catch (e) { return err(e); }
        });
    }
}
