-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "alertedTiers" TEXT NOT NULL DEFAULT '[]',
    "institutionId" TEXT NOT NULL,
    "renewalUrl" TEXT,
    "renewalNote" TEXT,
    "renewalSubmittedAt" DATETIME,
    "rejectionNote" TEXT,
    "verifiedBy" TEXT,
    "enteredDate" DATETIME,
    "ocrExtractedDate" DATETIME,
    "ocrConfidence" REAL,
    "dateConflict" BOOLEAN NOT NULL DEFAULT false,
    "officerConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "aiSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("alertedTiers", "createdAt", "expiresAt", "fileName", "id", "institutionId", "rejectionNote", "renewalNote", "renewalSubmittedAt", "renewalUrl", "status", "type", "updatedAt", "verifiedBy") SELECT "alertedTiers", "createdAt", "expiresAt", "fileName", "id", "institutionId", "rejectionNote", "renewalNote", "renewalSubmittedAt", "renewalUrl", "status", "type", "updatedAt", "verifiedBy" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
