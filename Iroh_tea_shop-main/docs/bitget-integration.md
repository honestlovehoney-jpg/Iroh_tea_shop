# Bitget integration: first vertical slice

## Verified in the development investigation

The public Reality stock catalog is available at `GET /api/v3/reality/market/stock-info`. The current investigation reported 2,809 rows, 2,809 unique `symbol` values, nullable `name` values, and a `requestTime` field. Those counts are a point-in-time observation, not a constant; the application does not hard-code them.

A read-only daily-candle request was confirmed for a Reality stock symbol using `GET /api/v2/spot/market/candles?symbol=RAAPLUSDT&granularity=1day&limit=3`.

MCP discovery is not implemented or verified yet. This slice intentionally uses the documented public REST endpoints and does not expose trading operations.

## Added application contract

- `POST /api/bitget/catalog/sync` — server-side catalog synchronization, protected by `Authorization: Bearer $BITGET_CATALOG_SYNC_TOKEN`.
- `GET /api/bitget/assets/search?q=...&page=1&pageSize=25` — local SQLite-backed search over company name, underlying ticker, canonical provider symbol, and provider instrument ID.
- `GET /api/bitget/assets/:instrumentId/candles?granularity=1day&limit=3` — validates the canonical instrument ID, retrieves normalized read-only candles, and reuses observations cached for 60 seconds.

Set `BITGET_CATALOG_SYNC_TOKEN` to a long random secret on the server before triggering sync. Never expose it in browser code. The public catalog is refreshed explicitly rather than on every search. The provider's documented 1 request/second limit should be respected by any scheduled sync or retry logic.

## Canonical data rules

- `providerInstrumentId` is the exact Bitget `symbol`, such as `RAAPLUSDT`.
- `underlyingTicker` is the source `code`, such as `AAPL`.
- `companyName` is nullable; a missing name is not a missing instrument.
- Old catalog records are retained and marked `not_seen_in_latest_sync` if absent from a later full catalog response.
- Catalog membership and signal availability are separate. A searchable instrument may have no candle observations.
- Candle rows with invalid timestamps or OHLC values are discarded, not coerced to zero.

## Operational limitations / follow-up

1. Run migrations and regenerate Prisma Client before launching the app.
2. Execute a catalog sync in an environment with network access, then inspect the returned `received`, `valid`, and `rejected` counts.
3. Verify API response timestamps and the candle array ordering against a live response before relying on newest/oldest ordering in UI.
4. Add company-name enrichment only from a documented, permitted source; never fabricate names for null records.
5. Add sync rate limiting/locking before scheduling refreshes, and add retry/backoff and stale-cache fallback for provider failures.
6. MCP tool inventory and its schemas remain pending a successful MCP handshake.
