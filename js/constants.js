// Constants: the single place for every number the maths depends on.
export const PAYMENTS_PER_YEAR = { Week: 52, Fortnight: 26, Month: 12, Quarter: 4, Year: 1 };
export const STEP_DAYS = { Week: 7, Fortnight: 14 };
export const STEP_MONTHS = { Month: 1, Quarter: 3, Year: 12 };
export const APPROX_DAYS = { Week: 7, Fortnight: 14, Month: 30.4375, Quarter: 91.3125, Year: 365.25 };

export const PERIODS = Object.keys(PAYMENTS_PER_YEAR);
export const PERIOD_LABELS = { Week: 'Weekly', Fortnight: 'Fortnightly', Month: 'Monthly', Quarter: 'Quarterly', Year: 'Yearly' };
export const TYPES = ['Need', 'Want'];

export const STORAGE_KEY = 'budgetTracker:v1'; // key name kept so earlier saved data is migrated, not lost
export const SCHEMA_VERSION = 2;

export const DEFAULT_CATEGORIES = [
  'Streaming', 'Subscriptions', 'Pets', 'Household', 'Health & personal',
  'Insurance', 'Utilities', 'Food & groceries', 'Transport', 'Other',
];

export const DEFAULT_SETTINGS = {
  income: { amount: 0, every: 1, period: 'Fortnight' },
  alertDays: 3,
  lumpDays: 60,
  lookbackDays: 365,
  categories: DEFAULT_CATEGORIES,
  theme: 'auto',
  view: 'Month',
  notify: false,
  bankMapping: null,
};

// name | cost | every | period | category | type
export const SEED_ROWS = [
  ['Amazon Prime', 79, 1, 'Year', 'Streaming', 'Want'],
  ['Netflix', 37.98, 1, 'Month', 'Streaming', 'Want'],
  ['Disney+', 24.99, 1, 'Month', 'Streaming', 'Want'],
  ['Stan', 23.99, 1, 'Month', 'Streaming', 'Want'],
  ['HBO', 15.99, 1, 'Month', 'Streaming', 'Want'],
  ['Fred Walks', 200, 1, 'Fortnight', 'Pets', ''],
  ['Fred Insurance', 78.49, 1, 'Fortnight', 'Pets', 'Need'],
  ['Grass', 51.68, 1, 'Fortnight', '', ''],
  ['HealthyPetPlus', 23.08, 1, 'Fortnight', 'Pets', 'Need'],
  ['Dermaveen', 32, 3, 'Month', 'Health & personal', ''],
  ['Catfood', 71.98, 1, 'Fortnight', 'Pets', 'Need'],
  ['Fah', 140, 1, 'Fortnight', '', ''],
  ['TP', 11.63, 3, 'Month', 'Household', 'Need'],
  ['Kleenex', 19.84, 3, 'Month', 'Household', 'Need'],
  ['Catfood 2', 71.98, 1, 'Month', 'Pets', 'Need'],
  ['Freds Pills', 42.34, 7, 'Week', 'Pets', 'Need'],
  ['Lyka', 178.5, 6, 'Week', 'Pets', 'Need'],
];
