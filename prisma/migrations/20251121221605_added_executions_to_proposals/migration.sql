/*
  Warnings:

  - You are about to drop the column `decisionId` on the `Execution` table. All the data in the column will be lost.
  - Added the required column `proposalId` to the `Execution` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Execution" DROP CONSTRAINT "Execution_decisionId_fkey";

-- AlterTable
ALTER TABLE "Execution" DROP COLUMN "decisionId",
ADD COLUMN     "proposalId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
