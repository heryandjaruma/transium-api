-- Migration number: 0008 	 2026-08-18T00:00:00.000Z
--
-- Stores APNs device tokens so a user can be pushed to on more than one
-- device at once. A row is keyed by `token` (not `userId`) because the
-- token, not the user, identifies a physical device install: the common
-- flow is the iOS app registering its token right after sign-in, and the
-- same device token can move to a different user if someone signs out and
-- a different account signs in on that device, so re-registering must
-- reassign ownership rather than insert a duplicate.

CREATE TABLE DeviceToken (
	id TEXT PRIMARY KEY,
	userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	token TEXT NOT NULL UNIQUE,
	environment TEXT NOT NULL DEFAULT 'production',
	createdAt TEXT NOT NULL,
	updatedAt TEXT NOT NULL
);

CREATE INDEX idx_device_token_userId ON DeviceToken(userId);
