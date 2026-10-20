-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "externalRefs" TEXT[] DEFAULT ARRAY[]::TEXT[];

