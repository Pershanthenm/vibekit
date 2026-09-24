// A stdio MCP server small enough to read in one breath: newline-delimited JSON-RPC in, replies
// out. It answers initialize, lists one tool, echoes a call, and — like a real one — writes its own
// chatter to stderr and refuses anything else. Used by the integration tests for the stdio transport.
import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });
process.stderr.write('fake-mcp: started\n');
lines.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake-mcp', version: '0' } } })}\n`);
  } else if (message.method === 'tools/list') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } })}\n`);
  } else if (message.method === 'tools/call') {
    const { name, arguments: args } = message.params ?? {};
    if (name !== 'echo') process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `no tool ${name}` } })}\n`);
    else process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `echo: ${JSON.stringify(args ?? {})} token=${process.env.FAKE_TOKEN ?? 'none'}` }] } })}\n`);
  } else if (message.id !== undefined) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } })}\n`);
  }
});
lines.on('close', () => process.exit(0));
