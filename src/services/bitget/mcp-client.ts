import 'server-only';

const MCP_ENDPOINT = 'https://agent.bitget.com/mcp';
let activeSessionId: string | null = null;

/**
 * Parses SSE (Server-Sent Events) stream and extracts JSON data
 */
function parseSSE(responseText: string): any {
  const lines = responseText.split('\n');
  let jsonData = '';
  
  for (const line of lines) {
    if (line.startsWith('data:')) {
      jsonData = line.replace('data:', '').trim();
      break;
    }
  }
  
  if (!jsonData) {
    throw new Error('No data field found in SSE response');
  }
  
  return JSON.parse(jsonData);
}

/**
 * Initializes or reuses an MCP session.
 */
async function getSessionId(): Promise<string> {
  if (activeSessionId) return activeSessionId;

  console.log('[MCP] Initializing session...');
  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream', // <-- FIXED HERE
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'thesis-desk-backend', version: '1.0.0' },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP Init failed: ${response.status} - ${text}`);
  }

  const sessionId = response.headers.get('mcp-session-id');
  if (!sessionId) {
    console.log('[MCP] No session ID returned, proceeding stateless.');
    return 'stateless';
  }

  activeSessionId = sessionId;
  console.log('[MCP] Session initialized:', sessionId);
  return sessionId;
}

/**
 * Executes an MCP tool call (e.g., guide, do_query).
 */
export async function callMcpTool(toolName: string, arguments_: any) {
  const sessionId = await getSessionId();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream', // <-- FIXED HERE
  };
  if (sessionId !== 'stateless') {
    headers['mcp-session-id'] = sessionId;
  }

  console.log(`[MCP] Calling tool: ${toolName} with args:`, JSON.stringify(arguments_));

  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: arguments_,
      },
    }),
  });

  const responseText = await response.text();
  console.log(`[MCP] Raw response status: ${response.status}`);
  
  if (!response.ok) {
    throw new Error(`MCP Tool call failed: ${response.status} - ${responseText}`);
  }

  try {
    const data = parseSSE(responseText);
    console.log('[MCP] Parsed SSE successfully');
    
    if (data.error) {
      throw new Error(`MCP Error: ${JSON.stringify(data.error)}`);
    }
    
    return data.result?.content?.[0]?.text || data.result || data;
  } catch (parseError) {
    console.error('[MCP] SSE parse failed, trying raw JSON:', parseError);
    try {
      const data = JSON.parse(responseText);
      return data.result?.content?.[0]?.text || data.result;
    } catch {
      throw new Error(`Failed to parse MCP response: ${responseText.substring(0, 200)}`);
    }
  }
}

/**
 * High-level helper for Bitget Equity Data
 */
export async function getEquityData(entryId: string, params: any) {
  return callMcpTool('do_query', { entry_id: entryId, params });
}
