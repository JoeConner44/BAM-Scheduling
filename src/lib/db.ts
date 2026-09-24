import { PrismaClient } from "@prisma/client";
import { resolveDatabaseEnv } from "./db-env";

resolveDatabaseEnv();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
