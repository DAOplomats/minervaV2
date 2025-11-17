-- CreateEnum
CREATE TYPE "Status" AS ENUM ('PENDING', 'DECIDED', 'FAILED');

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "vote" INTEGER,
    "reason" TEXT,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
