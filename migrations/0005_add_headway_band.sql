-- Migration number: 0005 	 2026-08-17T16:25:20.000Z

CREATE TABLE HeadwayBand (
	id TEXT PRIMARY KEY,
	routeId TEXT NOT NULL REFERENCES BusRoute(id),
	dayType TEXT NOT NULL,        -- 'weekday' | 'weekend' | 'all'
	startMinute INTEGER NOT NULL, -- minutes since midnight, e.g. 0
	endMinute INTEGER NOT NULL,   -- e.g. 359 for 00:00-05:59
	headwayMinutes REAL NOT NULL,
	UNIQUE (routeId, dayType, startMinute)
);

CREATE INDEX idx_headwayBand_routeId ON HeadwayBand(routeId);
