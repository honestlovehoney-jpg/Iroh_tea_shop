-- CreateTable
CREATE TABLE "BitgetSignalCoverage" (
    "instrumentId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastAttemptedAt" DATETIME NOT NULL,
    "lastSucceededAt" DATETIME,
    "source" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("instrumentId", "signalType"),
    CONSTRAINT "BitgetSignalCoverage_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "BitgetAsset" ("providerInstrumentId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BitgetSignalCoverage_signalType_status_idx" ON "BitgetSignalCoverage"("signalType", "status");

-- CreateIndex
CREATE INDEX "BitgetSignalCoverage_lastAttemptedAt_idx" ON "BitgetSignalCoverage"("lastAttemptedAt");
