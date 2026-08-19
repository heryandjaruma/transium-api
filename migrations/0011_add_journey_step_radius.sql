-- Migration number: 0011 	 2026-08-19T05:51:00.000Z
--
-- Adds JourneyStep.radiusMeters: the geofence tolerance (meters) a client should use for
-- this step's lat/lng, set once at creation (POST /private/journey/go) so the phone's
-- CLCircularRegion radius and the server's own proximity check in POST .../advance always
-- agree — a client-side guess could otherwise let a region fire at a distance the server
-- then rejects. NULL for steps without lat/lng, and for any row inserted before this
-- migration (POST .../advance falls back to a hardcoded default for those).

ALTER TABLE JourneyStep ADD COLUMN radiusMeters REAL;
