CREATE TABLE "BitgetAsset" (
  "providerInstrumentId" TEXT NOT NULL PRIMARY KEY,
  "symbol" TEXT NOT NULL,
  "underlyingTicker" TEXT NOT NULL,
  "companyName" TEXT,
  "tradingPeriodJson" TEXT NOT NULL,
  "weekendTradable" TEXT,
  "sourceRequestTime" TEXT,
  "listingStatus" TEXT NOT NULL DEFAULT 'active',
  "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastVerifiedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "BitgetAsset_symbol_key" ON "BitgetAsset"("symbol");
CREATE INDEX "BitgetAsset_underlyingTicker_idx" ON "BitgetAsset"("underlyingTicker");
CREATE INDEX "BitgetAsset_companyName_idx" ON "BitgetAsset"("companyName");
CREATE INDEX "BitgetAsset_listingStatus_lastVerifiedAt_idx" ON "BitgetAsset"("listingStatus", "lastVerifiedAt");

CREATE TABLE "BitgetSignalObservation" (
  "cacheKey" TEXT NOT NULL PRIMARY KEY,
  "instrumentId" TEXT NOT NULL,
  "signalType" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "fetchedAt" DATETIME NOT NULL,
  CONSTRAINT "BitgetSignalObservation_instrumentId_fkey"
    FOREIGN KEY ("instrumentId") REFERENCES "BitgetAsset" ("providerInstrumentId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BitgetSignalObservation_instrumentId_signalType_fetchedAt_idx"
  ON "BitgetSignalObservation"("instrumentId", "signalType", "fetchedAt");
