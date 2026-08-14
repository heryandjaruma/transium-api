-- Migration number: 0004 	 2026-08-14T00:00:00.000Z
--
-- Adds the road-following geometry for each route, sourced from
-- bali_transit.gpkg's bus_routes layer (OSM public transport relations).
-- Stored as a GeoJSON [lng, lat] coordinate array so it can be sliced
-- per-leg with turf's lineSlice. Populated by resources/bus_route_shapes_update.sql.

ALTER TABLE BusRoute ADD COLUMN shape TEXT;
