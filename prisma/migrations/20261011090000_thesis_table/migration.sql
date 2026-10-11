-- CreateTable
CREATE TABLE "Thesis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "instrumentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Thesis_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "BitgetAsset" ("providerInstrumentId") ON DELETE SET NULL ON UPDATE CASCADE
);
