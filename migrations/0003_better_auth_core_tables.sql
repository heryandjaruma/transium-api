-- Migration number: 0003 	 2026-08-14T00:00:00.000Z
--
-- Replaces the old app-defined User table with Better Auth's own core
-- tables. Both projects have zero rows so far, so this is a clean swap
-- rather than a data migration. SQLite table names are case-insensitive,
-- so `Profile.userId`, `UserQuest.userId`, and `UserBadge.userId` (declared
-- as `REFERENCES User(id)`) keep resolving correctly against the new
-- `user` table without any changes on their side.
--
-- Schema below mirrors Better Auth's default core schema exactly as
-- produced by `getSchema()` from the installed `better-auth` package
-- (booleans and dates are stored as INTEGER 0/1 and ISO TEXT respectively,
-- since D1/SQLite doesn't natively support either).

DROP TABLE User;

CREATE TABLE user (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	email TEXT NOT NULL UNIQUE,
	emailVerified INTEGER NOT NULL DEFAULT 0,
	image TEXT,
	createdAt TEXT NOT NULL,
	updatedAt TEXT NOT NULL
);

CREATE TABLE session (
	id TEXT PRIMARY KEY,
	expiresAt TEXT NOT NULL,
	token TEXT NOT NULL UNIQUE,
	createdAt TEXT NOT NULL,
	updatedAt TEXT NOT NULL,
	ipAddress TEXT,
	userAgent TEXT,
	userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_userId ON session(userId);

CREATE TABLE account (
	id TEXT PRIMARY KEY,
	accountId TEXT NOT NULL,
	providerId TEXT NOT NULL,
	userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	accessToken TEXT,
	refreshToken TEXT,
	idToken TEXT,
	accessTokenExpiresAt TEXT,
	refreshTokenExpiresAt TEXT,
	scope TEXT,
	password TEXT,
	createdAt TEXT NOT NULL,
	updatedAt TEXT NOT NULL
);

CREATE INDEX idx_account_userId ON account(userId);

CREATE TABLE verification (
	id TEXT PRIMARY KEY,
	identifier TEXT NOT NULL,
	value TEXT NOT NULL,
	expiresAt TEXT NOT NULL,
	createdAt TEXT NOT NULL,
	updatedAt TEXT NOT NULL
);

CREATE INDEX idx_verification_identifier ON verification(identifier);
