-- Migration number: 0018 	 2026-08-20T22:22:07.593Z
--
-- Lets a photo be attached to a JourneyAttempt directly, not just to one of its
-- JourneySteps: now that POST /private/journey/go no longer inserts artificial
-- "takePicture" checkpoints (see migration 0016's era), there's no longer always a step
-- to hang a "document your journey" photo off of.
--
-- SQLite can't drop a NOT NULL constraint via a plain ALTER TABLE, so this rebuilds
-- JourneyMedia: `journeyAttemptId` is added and backfilled from each row's existing
-- step (so it's always populated, even for step-tied media — every query can now join
-- straight to JourneyAttempt without going through JourneyStep), and `journeyStepId`
-- becomes nullable — NULL for a photo attached to the attempt itself.

CREATE TABLE JourneyMedia_new (
	id TEXT PRIMARY KEY,
	journeyAttemptId TEXT NOT NULL REFERENCES JourneyAttempt(id),
	journeyStepId TEXT REFERENCES JourneyStep(id),
	mediaId TEXT NOT NULL REFERENCES Media(id)
);

INSERT INTO JourneyMedia_new (id, journeyAttemptId, journeyStepId, mediaId)
SELECT jm.id, js.journeyAttemptId, jm.journeyStepId, jm.mediaId
FROM JourneyMedia jm
JOIN JourneyStep js ON js.id = jm.journeyStepId;

DROP TABLE JourneyMedia;
ALTER TABLE JourneyMedia_new RENAME TO JourneyMedia;

CREATE INDEX idx_journeyMedia_journeyAttemptId ON JourneyMedia(journeyAttemptId);
CREATE INDEX idx_journeyMedia_journeyStepId ON JourneyMedia(journeyStepId);
CREATE INDEX idx_journeyMedia_mediaId ON JourneyMedia(mediaId);
