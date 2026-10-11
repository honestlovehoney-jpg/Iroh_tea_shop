# Iroh's Tea Shop: Bitget Thesis Desk

A 3D tea shop in your browser where you test stock theses against Bitget market data. Walk into the shop, open a thesis at the Counter, and ask Uncle, the shop's host, for the evidence.

**Live site:** <https://irohteashop.vercel.app>

## What you can do

You start outside the shop, in front of a sketchbook. Press **Enter Teashop** when the room has loaded. A dock at the bottom of the screen takes you between the stops.

| Stop              | What you do there                                                                 |
| ----------------- | --------------------------------------------------------------------------------- |
| **Counter**       | Read stock theses, search instruments, and save your own theses.                  |
| **Host**          | Ask Uncle a question. He answers from Bitget market data, written by Qwen.        |
| **Shelf**         | See which instruments Bitget covers and how complete the data is.                 |
| **Observatorium** | See how the S&P 500 benchmark and the largest US stocks are moving.               |

The first dock button, **Waiting room**, takes you back to the sketchbook.

### Counter: the Thesis Desk

Three theses sit on the counter as scrolls, each covering four stocks. Each scroll carries a **momentum seal**: Strong, Building, Weak, or No signal. The seal counts how many of the thesis's stocks rose over the last seven days, using Bitget daily candles. It is a summary of price movement. It does not say the thesis is right.

- **Open a thesis** to read it, then open any of its stocks to see eight days of candles and Bitget's live quote.
- **Ask Uncle about this thesis** types a question in the Host panel. You decide whether to send it.
- **Trade on Bitget** opens bitget.com in a new tab. Nothing in the shop places orders.
- A link such as `/?thesis=<id>` skips the waiting room and opens that thesis.

### Host: ask Uncle

Uncle is the old tea master who runs the shop. Each message pulls fresh Bitget data through the MCP server, and Qwen writes the answer. Every answer shows its provenance: the symbol, the MCP source, and the time the data was fetched. The desk is read-only. It never places orders.

### Shelf: coverage

The Shelf shows how many Bitget stocks are in the catalog, how many have been checked for daily candles, and the latest check results.

### Observatorium: major stocks

The Observatorium opens a market board for the S&P 500 benchmark (SPY) and eight large US names: Apple, Microsoft, NVIDIA, Amazon, Meta, Tesla, JPMorgan and Visa. Each row shows the latest price, a small seven-day chart, and the one-day and seven-day change. A summary at the top counts how many are rising today and names the leader and laggard.

The figures come from Bitget daily candles, so the latest candle is today so far. A stock that is not in the Bitget catalog shows "Not in the catalog". The board has a link to the planetary model, which opens in a new tab.

### Moving around the room

- Drag to look around. Scroll or pinch to zoom. Double-click the floor to walk there.
- Click a glowing seal in the room to go to its stop.
- Press **◎** (Recenter view) to put the camera back.
- Press **Escape** to close a panel.
- It works on desktop and mobile.

**Log in** at the top right is optional. You need only a nickname and a password. An account keeps your chats with Uncle.

## How the data flows

- **Bitget MCP server.** `src/services/bitget/mcp-client.ts` calls Bitget's MCP server for equity data such as price quotes and candles.
- **API routes.** The browser never talks to Bitget directly. It calls routes under `src/app/api/bitget/`: `mcp`, `research`, `assets/search`, `assets/[instrumentId]/candles`, `coverage`, and `catalog/sync`.
- **Catalog.** A catalog sync stores the list of Bitget instruments and their signal coverage in the database, so search and the Shelf are fast.
- **Uncle.** The `research` route fetches Bitget data for the symbol in the question, then sends it to Qwen with instructions to answer only from that data.

Details are in [`docs/bitget-integration.md`](docs/bitget-integration.md) and [`docs/bitget-mcp-inventory.md`](docs/bitget-mcp-inventory.md).

## Run it locally

You need Node.js and npm. Use Node.js 24.10.0, the version in `.nvmrc`.

1. Get the code:

   ```bash
   git clone https://github.com/TonyLegend-77/Iroh.git
   cd Iroh
   ```

2. Install the packages:

   ```bash
   npm ci
   ```

3. Copy the settings file and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   | Variable        | What it is                                           |
   | --------------- | ---------------------------------------------------- |
   | `QWEN_API_KEY`  | Key for the Qwen model that writes Uncle's answers.  |
   | `QWEN_BASE_URL` | Base URL of the Qwen API.                            |
   | `QWEN_MODEL`    | Name of the Qwen model to use.                       |
   | `DATABASE_URL`  | Database connection string.                          |
   | `BITGET_CATALOG_SYNC_TOKEN` | Secret that allows the catalog sync (step 5). |

   Keep these server-side. Never put them in a `NEXT_PUBLIC_` variable, because Next.js sends those to the browser.

4. Start the app:

   ```bash
   npm run dev
   ```

5. Fill the catalog once. The Counter and the Shelf read it, and until it is filled the Counter says "The Bitget catalog has not been synced yet."

   ```bash
   curl -X POST http://127.0.0.1:3000/api/bitget/catalog/sync \
     -H "Authorization: Bearer $BITGET_CATALOG_SYNC_TOKEN"
   ```

6. Open <http://127.0.0.1:3000>. If port 3000 is busy, Next.js uses the next free port and prints it.

## Checks

```bash
npm run typecheck
npm test
npm run format:check
npm run build
npx playwright install chromium
npm run test:e2e
```

Run `npx playwright install chromium` once before the first browser test run.

## Deploy

The site runs on Vercel. A push to `main` starts a deploy. Set `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL` and `DATABASE_URL` in the Vercel project settings before the first deploy.

## Where the code lives

| Folder                              | What it holds                                                          |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `src/app/`                          | Next.js pages and API routes, including `api/bitget/`                  |
| `src/scene/`                        | The 3D room: camera, props, the host, the orrery                       |
| `src/ui/`                           | Panels, the Thesis Desk, the Shelf, the dock, the waiting room         |
| `src/thesis/`                       | The theses and their types                                             |
| `src/services/bitget/`              | The Bitget MCP client                                                  |
| `src/chat/`                         | The chat session with Uncle, limits, and availability                  |
| `src/auth/`, `src/iroh/`, `prisma/` | Accounts, saved chats and theses, and the database schema              |
| `scripts/`                          | Database setup and audit scripts                                       |
| `tests/`                            | Unit tests; Bitget tests are in `tests/bitget/`, browser tests too     |

In the code, "Iroh" means Uncle.

## Known limits

- Uncle answers only from the Bitget data fetched for the question. If Bitget has no data for a symbol, he says so.
- The momentum seal looks back seven days only. A rise can reverse, and a fall can be the start of the thesis.
- Everything is read-only research. Nothing here is financial advice, and a thesis summary does not say that the thesis is right.
- Accounts have no password reset.

## Credits

The 3D shop is based on the open-source [Iroh's Tea Shop](https://github.com/White-Lotus-Labs/iroh-tea-shop) by White-Lotus-Labs.
