-- Migration number: 0009 	 2026-08-19T04:48:39.000Z
--
-- Stores the breadcrumb of GPS points a device recorded while a journey attempt was
-- in progress, so the finished journey's actual walked path can be drawn (Strava-style)
-- rather than just the planned route. Kept as its own table rather than a column on
-- JourneySummary since it's an ordered, potentially-large point series, not a scalar --
-- the same normalized-child-table pattern JourneyStep already uses for JourneyAttempt.

CREATE TABLE JourneyPathPoint (
	id TEXT PRIMARY KEY,
	journeyAttemptId TEXT NOT NULL REFERENCES JourneyAttempt(id),
	sequence INTEGER NOT NULL,
	lat REAL NOT NULL,
	lng REAL NOT NULL,
	recordedAt TEXT,
	UNIQUE (journeyAttemptId, sequence)
);

CREATE INDEX idx_journeyPathPoint_journeyAttemptId ON JourneyPathPoint(journeyAttemptId);
