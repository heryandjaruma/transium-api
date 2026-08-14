-- Initial schema for Transium, generated from the ERD.

-- ============ App-level reference data ============

CREATE TABLE Kelurahan (
	id TEXT PRIMARY KEY,
	kelurahanName TEXT NOT NULL,
	kecamatanName TEXT NOT NULL
);

CREATE TABLE ActionDefinition (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	description TEXT NOT NULL,
	type TEXT NOT NULL
);

CREATE TABLE Badge (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	category TEXT NOT NULL,
	description TEXT NOT NULL,
	type TEXT NOT NULL,
	kelurahanId TEXT REFERENCES Kelurahan(id)
);

CREATE INDEX idx_badge_kelurahanId ON Badge(kelurahanId);

CREATE TABLE BadgeAction (
	id TEXT PRIMARY KEY,
	badgeId TEXT NOT NULL REFERENCES Badge(id),
	actionId TEXT NOT NULL REFERENCES ActionDefinition(id),
	sequence INTEGER NOT NULL,
	lat REAL,
	lng REAL,
	instruction TEXT,
	UNIQUE (badgeId, actionId)
);

CREATE TABLE Quest (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	category TEXT NOT NULL,
	description TEXT NOT NULL
);

CREATE TABLE QuestBadge (
	id TEXT PRIMARY KEY,
	questId TEXT NOT NULL REFERENCES Quest(id),
	badgeId TEXT NOT NULL REFERENCES Badge(id),
	UNIQUE (questId, badgeId)
);

CREATE INDEX idx_questBadge_badgeId ON QuestBadge(badgeId);

-- ============ Bus route reference data ============

CREATE TABLE BusStop (
	id TEXT PRIMARY KEY,
    stopId TEXT,
	name TEXT NOT NULL,
	lat REAL NOT NULL,
	lng REAL NOT NULL
);

CREATE TABLE BusRoute (
	id TEXT PRIMARY KEY,
	ref TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	direction TEXT NOT NULL,
	color TEXT NOT NULL
);

CREATE TABLE RouteStop (
	id TEXT PRIMARY KEY,
	routeId TEXT NOT NULL REFERENCES BusRoute(id),
	stopId TEXT NOT NULL REFERENCES BusStop(id),
	sequence INTEGER NOT NULL
);

CREATE INDEX idx_routeStop_routeId_sequence ON RouteStop(routeId, sequence);
CREATE INDEX idx_routeStop_stopId ON RouteStop(stopId);

-- ============ User-level data ============

CREATE TABLE User (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	method TEXT NOT NULL
);

CREATE TABLE Profile (
	id TEXT PRIMARY KEY,
	userId TEXT NOT NULL UNIQUE REFERENCES User(id),
	firstName TEXT NOT NULL,
	lastName TEXT,
	level INTEGER NOT NULL
);

CREATE TABLE UserQuest (
	id TEXT PRIMARY KEY,
	userId TEXT NOT NULL REFERENCES User(id),
	questId TEXT NOT NULL REFERENCES Quest(id),
	status TEXT NOT NULL,
	createdAt TEXT NOT NULL,
	completedAt TEXT
);

CREATE INDEX idx_userQuest_userId_status ON UserQuest(userId, status);

CREATE TABLE JourneyAttempt (
	id TEXT PRIMARY KEY,
	userQuestId TEXT NOT NULL REFERENCES UserQuest(id),
	currentStepSequence INTEGER NOT NULL,
	status TEXT NOT NULL,
	createdAt TEXT NOT NULL,
	startedAt TEXT,
	endedAt TEXT
);

CREATE INDEX idx_journeyAttempt_userQuestId_status ON JourneyAttempt(userQuestId, status);

CREATE TABLE JourneySummary (
	id TEXT PRIMARY KEY,
	journeyAttemptId TEXT NOT NULL UNIQUE REFERENCES JourneyAttempt(id),
	stepsTaken INTEGER NOT NULL,
	distanceMeters REAL NOT NULL,
	calorie REAL NOT NULL,
	startPoint TEXT NOT NULL,
	finishPoint TEXT NOT NULL
);

CREATE TABLE JourneyStep (
	id TEXT PRIMARY KEY,
	journeyAttemptId TEXT NOT NULL REFERENCES JourneyAttempt(id),
	sequence INTEGER NOT NULL,
	name TEXT NOT NULL,
	description TEXT NOT NULL,
	type TEXT NOT NULL,
	lat REAL,
	lng REAL,
	status TEXT NOT NULL,
	UNIQUE (journeyAttemptId, sequence)
);

CREATE TABLE Media (
	id TEXT PRIMARY KEY,
	createdAt TEXT NOT NULL,
	type TEXT NOT NULL,
	url TEXT NOT NULL
);

CREATE TABLE JourneyMedia (
	id TEXT PRIMARY KEY,
	journeyStepId TEXT NOT NULL REFERENCES JourneyStep(id),
	mediaId TEXT NOT NULL REFERENCES Media(id)
);

CREATE INDEX idx_journeyMedia_journeyStepId ON JourneyMedia(journeyStepId);
CREATE INDEX idx_journeyMedia_mediaId ON JourneyMedia(mediaId);

CREATE TABLE UserBadge (
	id TEXT PRIMARY KEY,
	userId TEXT NOT NULL REFERENCES User(id),
	badgeId TEXT NOT NULL REFERENCES Badge(id),
	journeyAttemptId TEXT REFERENCES JourneyAttempt(id),
	earnedAt TEXT NOT NULL,
	UNIQUE (userId, badgeId)
);

CREATE INDEX idx_userBadge_badgeId ON UserBadge(badgeId);
