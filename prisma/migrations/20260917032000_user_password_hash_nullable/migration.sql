-- Account auth lives in Supabase Auth; Prisma passwordHash is optional.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
