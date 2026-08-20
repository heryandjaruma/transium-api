-- Migration number: 0016 	 2026-08-20T20:10:34.205Z
--
-- Adds JourneyStep.actionType: a copy of the originating BadgeAction's
-- ActionDefinition.type (e.g. "photo", "checkin" — see migration 0010, which repurposed
-- ActionDefinition.type as free-text once required/optional-ness moved to BadgeAction.type),
-- so a client can tell what *kind* of action a step is without a second lookup. NULL for
-- artificial "takePicture" checkpoints (see POST /private/journey/go), since those have no
-- backing ActionDefinition, and for any row inserted before this migration.

ALTER TABLE JourneyStep ADD COLUMN actionType TEXT;
