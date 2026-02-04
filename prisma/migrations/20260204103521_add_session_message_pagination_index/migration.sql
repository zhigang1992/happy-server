-- CreateIndex
CREATE INDEX "SessionMessage_sessionId_createdAt_id_idx" ON "SessionMessage"("sessionId", "createdAt", "id");
