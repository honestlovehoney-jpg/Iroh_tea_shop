-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thesisId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'system',
    "label" TEXT NOT NULL,
    "valueText" TEXT,
    "state" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "observedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL,
    "marketClosed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Claim_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "Thesis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Claim_thesisId_idx" ON "Claim"("thesisId");
