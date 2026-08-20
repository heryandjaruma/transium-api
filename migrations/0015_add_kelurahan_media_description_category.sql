-- Migration number: 0015 	 2026-08-20T00:00:00.000Z

ALTER TABLE Kelurahan ADD COLUMN description TEXT;
ALTER TABLE Kelurahan ADD COLUMN category TEXT;

CREATE TABLE KelurahanMedia (
	id TEXT PRIMARY KEY,
	kelurahanId TEXT NOT NULL REFERENCES Kelurahan(id),
	mediaId TEXT NOT NULL REFERENCES Media(id),
	UNIQUE (kelurahanId, mediaId)
);

CREATE INDEX idx_kelurahanMedia_kelurahanId ON KelurahanMedia(kelurahanId);
CREATE INDEX idx_kelurahanMedia_mediaId ON KelurahanMedia(mediaId);
