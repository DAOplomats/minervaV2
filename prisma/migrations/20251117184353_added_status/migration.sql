/*
  Warnings:

  - Added the required column `status` to the `Decision` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "status" "Status" NOT NULL;
