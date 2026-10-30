-- CreateTable
CREATE TABLE "Expert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "busyRanges" TEXT NOT NULL DEFAULT '[]',
    "conflictStates" TEXT NOT NULL DEFAULT '[]',
    "maxPerMonth" INTEGER NOT NULL DEFAULT 4,
    "empanelledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EvcVisit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scheduledFor" DATETIME,
    "dueAt" DATETIME,
    "members" TEXT NOT NULL DEFAULT '[]',
    "experts" TEXT NOT NULL DEFAULT '[]',
    "allocatedAt" DATETIME,
    "allocatedBy" TEXT,
    "reportText" TEXT,
    "recommendation" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvcVisit_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EvcVisit" ("applicationId", "completedAt", "createdAt", "dueAt", "id", "members", "recommendation", "reportText", "scheduledFor", "status") SELECT "applicationId", "completedAt", "createdAt", "dueAt", "id", "members", "recommendation", "reportText", "scheduledFor", "status" FROM "EvcVisit";
DROP TABLE "EvcVisit";
ALTER TABLE "new_EvcVisit" RENAME TO "EvcVisit";
CREATE UNIQUE INDEX "EvcVisit_applicationId_key" ON "EvcVisit"("applicationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Expert_userId_key" ON "Expert"("userId");
