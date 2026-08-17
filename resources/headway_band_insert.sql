-- HeadwayBand inserts
-- dayType = 'all', with startMinute/endMinute set to each route's
-- first/last departure (minutes since midnight)
-- headwayMinutes = average of the given range for each route

INSERT INTO HeadwayBand (id, routeId, dayType, startMinute, endMinute, headwayMinutes) VALUES
('hb-K1B-0-all', 'K1B-0', 'all', 270, 1128, 17),
('hb-K1B-1-all', 'K1B-1', 'all', 270, 1128, 17),
('hb-K2B-0-all', 'K2B-0', 'all', 300, 1140, 16),
('hb-K2B-1-all', 'K2B-1', 'all', 300, 1140, 16),
('hb-K3B-0-all', 'K3B-0', 'all', 300, 1115, 24),
('hb-K3B-1-all', 'K3B-1', 'all', 300, 1115, 24),
('hb-K4B-0-all', 'K4B-0', 'all', 300, 1100, 18.5),
('hb-K4B-1-all', 'K4B-1', 'all', 300, 1100, 18.5),
('hb-K5B-0-all', 'K5B-0', 'all', 300, 1110, 18.5),
('hb-K5B-1-all', 'K5B-1', 'all', 300, 1110, 18.5),
('hb-K6B-0-all', 'K6B-0', 'all', 300, 1112, 28),
('hb-K6B-1-all', 'K6B-1', 'all', 300, 1112, 28),
('hb-TS1-0-all', 'TS1-0', 'all', 480, 1125, 37.5),
('hb-TS1-1-all', 'TS1-1', 'all', 360, 1005, 37.5);
