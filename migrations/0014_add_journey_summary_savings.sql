-- Migration number: 0014 	 2026-08-20T00:00:00.000Z
--
-- Adds approximate money-saved estimates to JourneySummary, derived from
-- JourneySummary.distanceMeters at completion time (see src/lib/savings.ts) —
-- what that distance would have cost in fuel for a private motorcycle, or as a
-- ride-hailing motorcycle/car trip, rounded to the nearest Rp 5,000 for a
-- friendlier display number. Existing rows backfill to 0 since their distance
-- was never run through the calculation.

ALTER TABLE JourneySummary ADD COLUMN fuelCostSavedIdr INTEGER NOT NULL DEFAULT 0;
ALTER TABLE JourneySummary ADD COLUMN rideHailingMotorcycleSavedIdr INTEGER NOT NULL DEFAULT 0;
ALTER TABLE JourneySummary ADD COLUMN rideHailingCarSavedIdr INTEGER NOT NULL DEFAULT 0;
