-- Migration number: 0019 	 2026-08-23T00:00:00.000Z

CREATE TABLE Area (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT,
	category TEXT,
	lat REAL NOT NULL,
	lng REAL NOT NULL
);

ALTER TABLE Kelurahan ADD COLUMN areaId TEXT REFERENCES Area(id);
CREATE INDEX idx_kelurahan_areaId ON Kelurahan(areaId);

CREATE TABLE AreaMedia (
	id TEXT PRIMARY KEY,
	areaId TEXT NOT NULL REFERENCES Area(id),
	mediaId TEXT NOT NULL REFERENCES Media(id),
	UNIQUE (areaId, mediaId)
);

CREATE INDEX idx_areaMedia_areaId ON AreaMedia(areaId);
CREATE INDEX idx_areaMedia_mediaId ON AreaMedia(mediaId);
