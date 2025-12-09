-- CreateTable
CREATE TABLE "SessionBlob" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionBlob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionBlob_sessionId_idx" ON "SessionBlob"("sessionId");

-- CreateIndex
CREATE INDEX "SessionBlob_accountId_idx" ON "SessionBlob"("accountId");

-- AddForeignKey
ALTER TABLE "SessionBlob" ADD CONSTRAINT "SessionBlob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionBlob" ADD CONSTRAINT "SessionBlob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
