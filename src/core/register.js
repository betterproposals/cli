function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(error) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
}

/** Register the tools on an McpServer, answering in the MCP result shape. */
export function registerTools(server, tools) {
    for (const { name, description, inputSchema, annotations, handler } of tools) {
        server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
            try { return ok(await handler(args)); } catch (e) { return err(e); }
        });
    }
}
