-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerKey" TEXT NOT NULL,
    "totalUsd" REAL NOT NULL,
    "collateralUsd" REAL,
    "marginUsedUsd" REAL,
    "holdingsJson" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Lock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thesisId" TEXT NOT NULL,
    "plannedUsd" REAL NOT NULL,
    "leverage" REAL NOT NULL,
    "verdict" TEXT NOT NULL,
    "metricsJson" TEXT NOT NULL,
    "acknowledgedKeys" TEXT NOT NULL,
    "overrideReason" TEXT,
    "lockedAt" DATETIME NOT NULL,
    CONSTRAINT "Lock_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "Thesis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Portfolio_ownerKey_key" ON "Portfolio"("ownerKey");
CREATE UNIQUE INDEX "Lock_thesisId_key" ON "Lock"("thesisId");
