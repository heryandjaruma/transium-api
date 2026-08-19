// Approximate money-saved figures for a finished journey, derived from its walked
// distance. These are illustrative gamification numbers, not real fare quotes — the
// constants below are ballpark 2020s Indonesia figures (Pertalite pump price, a typical
// automatic scooter's fuel economy, and common ojek-online/taxi-app base+per-km pricing
// with their usual minimum fares). Every result is rounded to the nearest Rp 5,000 —
// what the user asked to see ("in every IDR 5k order") — since a precise-looking number
// would overstate how exact these estimates actually are.

const IDR_ROUNDING_STEP = 5_000

const FUEL_PRICE_PER_LITER_IDR = 10_000
const MOTORCYCLE_KM_PER_LITER = 40
const FUEL_COST_PER_KM_IDR = FUEL_PRICE_PER_LITER_IDR / MOTORCYCLE_KM_PER_LITER

const RIDE_HAILING_MOTORCYCLE_BASE_IDR = 2_500
const RIDE_HAILING_MOTORCYCLE_PER_KM_IDR = 2_500
const RIDE_HAILING_MOTORCYCLE_MIN_FARE_IDR = 9_000

const RIDE_HAILING_CAR_BASE_IDR = 7_000
const RIDE_HAILING_CAR_PER_KM_IDR = 4_000
const RIDE_HAILING_CAR_MIN_FARE_IDR = 20_000

export type JourneySavings = {
    fuelCostSavedIdr: number
    rideHailingMotorcycleSavedIdr: number
    rideHailingCarSavedIdr: number
}

function roundToNearest5k(idr: number) {
    return Math.round(idr / IDR_ROUNDING_STEP) * IDR_ROUNDING_STEP
}

function rideHailingFare(distanceKm: number, baseIdr: number, perKmIdr: number, minFareIdr: number) {
    return Math.max(minFareIdr, baseIdr + perKmIdr * distanceKm)
}

/** Estimates money saved by not driving/hailing a ride for `distanceMeters`, each rounded to the nearest Rp 5,000. */
export function calculateJourneySavings(distanceMeters: number): JourneySavings {
    const distanceKm = distanceMeters / 1000

    return {
        fuelCostSavedIdr: roundToNearest5k(distanceKm * FUEL_COST_PER_KM_IDR),
        rideHailingMotorcycleSavedIdr: roundToNearest5k(
            rideHailingFare(distanceKm, RIDE_HAILING_MOTORCYCLE_BASE_IDR, RIDE_HAILING_MOTORCYCLE_PER_KM_IDR, RIDE_HAILING_MOTORCYCLE_MIN_FARE_IDR)
        ),
        rideHailingCarSavedIdr: roundToNearest5k(
            rideHailingFare(distanceKm, RIDE_HAILING_CAR_BASE_IDR, RIDE_HAILING_CAR_PER_KM_IDR, RIDE_HAILING_CAR_MIN_FARE_IDR)
        ),
    }
}
