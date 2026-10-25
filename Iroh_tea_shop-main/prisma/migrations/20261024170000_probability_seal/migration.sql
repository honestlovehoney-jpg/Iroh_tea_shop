-- CreateTable
CREATE TABLE "Seal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thesisId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "horizonDays" INTEGER NOT NULL,
    "userProbability" REAL NOT NULL,
    "systemProbability" REAL NOT NULL,
    "systemMethod" TEXT NOT NULL,
    "systemRationale" TEXT,
    "baseRate" REAL,
    "instrumentId" TEXT NOT NULL,
    "referencePrice" REAL NOT NULL,
    "sealedAt" DATETIME NOT NULL,
    "resolvesAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "outcome" BOOLEAN,
    "resolvedPrice" REAL,
    "resolvedAt" DATETIME,
    "userBrier" REAL,
    "systemBrier" REAL,
    CONSTRAINT "Seal_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "Thesis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Seal_thesisId_key" ON "Seal"("thesisId");
CREATE INDEX "Seal_status_resolvesAt_idx" ON "Seal"("status", "resolvesAt");
