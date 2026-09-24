-- Migration number: 0022 	 2026-09-24T14:27:12.384Z

ALTER TABLE "user" ADD COLUMN "role" TEXT;
ALTER TABLE "user" ADD COLUMN "banned" INTEGER;
ALTER TABLE "user" ADD COLUMN "banReason" TEXT;
ALTER TABLE "user" ADD COLUMN "banExpires" DATE;

ALTER TABLE "session" ADD COLUMN "impersonatedBy" DATE;
