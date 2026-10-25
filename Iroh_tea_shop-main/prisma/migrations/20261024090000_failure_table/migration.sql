-- Thesis: owner, status gate, chosen ticker. Existing rows keep ownerKey NULL and are not shown to anyone.
ALTER TABLE "Thesis" ADD COLUMN "ownerKey" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "symbol" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "Thesis" ADD COLUMN "statusChangedAt" DATETIME;

CREATE INDEX "Thesis_ownerKey_createdAt_idx" ON "Thesis"("ownerKey", "createdAt");

-- CreateTable
CREATE TABLE "FailurePath" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thesisId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'uncle',
    "condition" TEXT NOT NULL,
    "probability" REAL NOT NULL,
    "impactPct" REAL NOT NULL,
    "deadline" DATETIME NOT NULL,
    "triggerKind" TEXT NOT NULL,
    "triggerLevel" REAL,
    "triggerNote" TEXT NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decisionReason" TEXT,
    "originalJson" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FailurePath_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "Thesis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FailurePath_thesisId_ordinal_idx" ON "FailurePath"("thesisId", "ordinal");
