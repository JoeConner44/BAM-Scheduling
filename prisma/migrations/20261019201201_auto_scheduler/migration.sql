-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('WEATHER_RAIN', 'WEATHER_COLD', 'WEATHER_WIND', 'MOVED', 'UNPLACED', 'CONFLICT', 'NEW_JOB');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ESTIMATOR';

-- AlterTable
ALTER TABLE "JobType" ADD COLUMN     "dryHoursAfter" INTEGER,
ADD COLUMN     "maxRainChance" INTEGER,
ADD COLUMN     "maxWindMph" INTEGER,
ADD COLUMN     "minTempF" INTEGER;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "weatherFetchedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "requestedDate" DATE,
ADD COLUMN     "workOrderFileKey" TEXT,
ADD COLUMN     "workOrderNumber" TEXT;

-- AlterTable
ALTER TABLE "ScheduleBlock" ADD COLUMN     "auto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProjectMaterial" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherHour" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "tempF" INTEGER NOT NULL,
    "precipChance" INTEGER NOT NULL,
    "windMph" INTEGER NOT NULL,
    "summary" TEXT,

    CONSTRAINT "WeatherHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "projectId" TEXT,
    "blockId" TEXT,
    "day" DATE,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanRun" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" JSONB NOT NULL,

    CONSTRAINT "PlanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeatherHour_locationId_day_hour_key" ON "WeatherHour"("locationId", "day", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_key_key" ON "Alert"("key");

-- CreateIndex
CREATE INDEX "Alert_resolvedAt_dismissedAt_idx" ON "Alert"("resolvedAt", "dismissedAt");

-- AddForeignKey
ALTER TABLE "ProjectMaterial" ADD CONSTRAINT "ProjectMaterial_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherHour" ADD CONSTRAINT "WeatherHour_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "ScheduleBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;
