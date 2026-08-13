-- Migration number: 0002 	 2026-08-13T05:03:54.001Z

ALTER TABLE BusStop ADD COLUMN stopId TEXT;
CREATE UNIQUE INDEX idx_busStop_stopId ON BusStop(stopId);
