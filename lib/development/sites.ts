import { CandidateSite, DevelopmentStage } from "./types";

/**
 * Candidate sites under screening for the fleet's next solar asset. Static demo data
 * with realistic attributes — in production these come from GIS layers (irradiance
 * rasters, parcel data, TNB/SESB substation maps) and state + DOE permitting records.
 */
export const CANDIDATE_SITES: CandidateSite[] = [
  {
    id: "site-kubang-pasu",
    name: "Kubang Pasu Solar Estate",
    location: "Kubang Pasu, Kedah",
    kind: "greenfield",
    irradiance: 5.8,
    acres: 42,
    substationKm: 2.1,
    permitting: "moderate",
    permittingNote: "State planning approval; no forest reserve or peatland on the parcel",
    landCostPerAcreYr: 850,
    recommendedCapacityMw: 6.0,
  },
  {
    id: "site-shah-alam-roof",
    name: "Shah Alam Logistics Rooftop",
    location: "Shah Alam, Selangor",
    kind: "rooftop",
    irradiance: 5.5,
    acres: 11,
    substationKm: 0.4,
    permitting: "low",
    permittingNote: "Behind-the-meter rooftop under NEM 3.0; local council building permit only",
    landCostPerAcreYr: 1900,
    recommendedCapacityMw: 2.4,
  },
  {
    id: "site-bintulu-coastal",
    name: "Bintulu Coastal Estate",
    location: "Bintulu, Sarawak",
    kind: "greenfield",
    irradiance: 5.1,
    acres: 65,
    substationKm: 9.7,
    permitting: "high",
    permittingNote: "Peat soil at the parcel edge triggers a detailed EIA under DOE Malaysia",
    landCostPerAcreYr: 520,
    recommendedCapacityMw: 8.5,
  },
];

/** Standard development roadmap for the recommended site, month offsets from site control. */
export const DEVELOPMENT_STAGES: DevelopmentStage[] = [
  {
    name: "Site control & permitting",
    window: "Months 0–6",
    detail: "Option agreement on the parcel, state land-use and planning approval, DOE environmental screening.",
  },
  {
    name: "Interconnection study",
    window: "Months 3–12",
    detail: "TNB feasibility + system impact studies for the 2.1 km tie-in to the nearest grid substation.",
  },
  {
    name: "EPC procurement & financing",
    window: "Months 9–14",
    detail: "Fixed-price EPC contract, module/tracker procurement, close construction financing.",
  },
  {
    name: "Construction",
    window: "Months 14–22",
    detail: "Civil works, racking, modules, inverters, substation tie-in.",
  },
  {
    name: "Commissioning & VPP onboarding",
    window: "Months 22–24",
    detail: "Utility witness testing, then the asset joins the WeaveGrid fleet — monitored, forecast, and dispatched from day one.",
  },
];
