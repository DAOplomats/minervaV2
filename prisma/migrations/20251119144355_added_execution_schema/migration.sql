-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('SUCCESS', 'PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
