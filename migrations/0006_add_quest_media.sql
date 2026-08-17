-- Migration number: 0006 	 2026-08-18T00:00:00.000Z

CREATE TABLE QuestMedia (
	id TEXT PRIMARY KEY,
	questId TEXT NOT NULL REFERENCES Quest(id),
	mediaId TEXT NOT NULL REFERENCES Media(id),
	UNIQUE (questId, mediaId)
);

CREATE INDEX idx_questMedia_questId ON QuestMedia(questId);
CREATE INDEX idx_questMedia_mediaId ON QuestMedia(mediaId);
