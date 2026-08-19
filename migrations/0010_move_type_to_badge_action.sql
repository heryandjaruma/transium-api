-- Migration number: 0010 	 2026-08-19T05:16:14.000Z
--
-- Moves required/optional-ness from ActionDefinition.type to BadgeAction.type: the same
-- ActionDefinition (e.g. "Take a photo") can be required in one badge's flow and
-- optional in another's, so this was never a property of the action itself — it's a
-- property of how a specific badge uses it. ActionDefinition.type is left as-is (still
-- free text, now unrelated to required/optional). Existing rows are backfilled from
-- their current ActionDefinition.type so behavior doesn't change until edited going
-- forward.

ALTER TABLE BadgeAction ADD COLUMN type TEXT NOT NULL DEFAULT 'required';

UPDATE BadgeAction
SET type = COALESCE((SELECT ad.type FROM ActionDefinition ad WHERE ad.id = BadgeAction.actionId), 'required');
