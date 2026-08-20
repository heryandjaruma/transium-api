-- Migration number: 0017 	 2026-08-20T22:10:41.175Z
--
-- Adds JourneyStep.badgeActionId: a stable reference back to the BadgeAction a step was
-- generated from (POST /private/journey/go), so a step can be correlated to its route
-- counterpart exactly — see GET /journey/real's `journeyAttemptId` param, which joins on
-- this to stamp `stepId` onto each `mission` segment/step. NULL for any row inserted
-- before this migration. Not a foreign key (JourneyStep already has none of its own —
-- ids are plain TEXT throughout this schema), but always a real BadgeAction.id going
-- forward, since every JourneyStep now maps to exactly one BadgeAction (POST .../go no
-- longer inserts artificial steps with no backing action).

ALTER TABLE JourneyStep ADD COLUMN badgeActionId TEXT;
