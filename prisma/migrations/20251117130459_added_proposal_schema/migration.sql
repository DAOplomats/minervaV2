-- AlterTable
ALTER TABLE "DAOs" ADD COLUMN     "votingDelay" INTEGER;

-- CreateTable
CREATE TABLE "Proposals" (
    "id" TEXT NOT NULL,
    "daoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "choices" TEXT[],
    "startDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposals_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Proposals" ADD CONSTRAINT "Proposals_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "DAOs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
