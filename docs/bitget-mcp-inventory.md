# Bitget MCP Inventory — Steps 1–5 Completed

### Step 1–2 Results (Project Inspection)
| Check | Result |
|-------|--------|
| `@modelcontextprotocol/sdk` | **Not present** in `package.json` |
| Existing MCP client / `agent.bitget.com` code | **None** in `src`, `docs`, or config |
| Project MCP surface | Empty — clean slate |

### Step 3–4 Results (Live Handshake)
| Item | Verified value |
|------|----------------|
| Endpoint | `https://agent.bitget.com/mcp` |
| Transport | HTTP + SSE (`text/event-stream`) |
| Protocol version | `2024-11-05` |
| Server | `bitget-mcp-server` **v4.1.0** |
| Session | Returned via `mcp-session-id` header |
| Tools discovered | **Exactly 2** (`guide`, `do_query`) |

### Categories Returned by `guide`
| key | name | entry_count | relevance to Thesis Desk |
|-----|------|-------------|--------------------------|
| equity | 美股 | **22** | Primary research signals |
| etf | ETF | 3 | Secondary |
| news | 新闻 | 1 | Supporting |
| sentiment | 市场情绪 | 2 | Supporting |
| crypto | 加密货币 | 39 | Out of scope for tokenized US stocks |

### Equity Catalog Entries (Top Examples)
| entry_id | Summary (EN) | Required params | Access |
|----------|--------------|-----------------|--------|
| `equity_price_quote` | Real-time quote + basic info | `symbol` | Read-only |
| `equity_price_historical` | Historical OHLCV | symbol(s), time range | Read-only |
| `equity_profile` | Company profile | `symbol` | Read-only |
| `equity_fundamental_balance` | Balance sheet | `symbol` + filters | Read-only |
| `equity_ownership_form_13f` | 13F institutional holdings | `symbol` | Read-only |
| `equity_estimates_consensus` | Analyst consensus | `symbol` | Read-only |
*(Full list of 22 entries audited and verified)*

### Controlled Invocation Evidence
`do_query` with `entry_id=equity_price_quote`, `params={symbol:"AAPL"}` returned live data:
- `last_price`: 335.02  
- `open` / `high` / `low` / `close` / `volume` present  
- `provider`: `bitget_data`  
- `isError`: false  

### Integration Boundary (Confirmed)
| Allowed for research workbench | Not exposed |
|--------------------------------|-------------|
| `guide` + `do_query` (equity/etf/news/sentiment) | Any trading, account, transfer, or withdraw tools |
| Public REST catalog + candles (verified) | API-key-based trading MCP packages |
