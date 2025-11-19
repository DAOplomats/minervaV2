/*
  Warnings:

  - Added the required column `endDate` to the `Proposals` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Proposals" ADD COLUMN     "endDate" TIMESTAMP(3) NOT NULL;
