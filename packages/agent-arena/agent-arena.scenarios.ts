export type AnswerParseStatus = 'ok' | 'no_final_assistant' | 'no_text' | 'no_json_fence' | 'json_parse_error';

export type ScenarioJudgeInput = {
  scenarioId: string;
  answer: unknown | null;
  parseStatus: AnswerParseStatus;
  answerJsonRaw?: string;
};

export type ScenarioJudgeResult = {
  ok: boolean;
  label?: string;
  strictOk?: boolean;
  semanticOk?: boolean;
  expected?: unknown;
  actual?: unknown;
  metrics?: Record<string, unknown>;
  notes?: string[];
};

export type ScenarioBase = {
  id: string;
  route: string;
  hash?: string;
  task: string;
  responseFormat: string;
  tags?: string[];
  judge: (input: ScenarioJudgeInput) => ScenarioJudgeResult;
};

export const SCENARIO_BASES: ScenarioBase[] = [
  {
    id: 'vl-global-development-t1-lifeexp-max-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which country had the highest life expectancy in 2000?',
    responseFormat: '{country: string, lifeExpectancy: number}',
    judge: makeSolutionJudge({ country: 'Japan', lifeExpectancy: 81.6 }),
  },
  {
    id: 'vl-global-development-t2-fertility-1p5-2-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which countries in year 2000 have the fertility (children per woman) between 1.5-2?',
    responseFormat: '{countries: Array<string>}',
    judge: makeSolutionJudge({
      countries: [
        'Australia',
        'Barbados',
        'Belgium',
        'Chile',
        'China',
        'Cuba',
        'Finland',
        'France',
        'Georgia',
        'Ireland',
        'Netherlands',
        'New Zealand',
        'North Korea',
        'Norway',
        'Portugal',
        'United Kingdom',
      ],
    }),
  },
  {
    id: 'vl-global-development-t3-largest-lowest-lifeexp-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which of the largest countries (population above 1 billion) in the world had the lowest life expectancy in 2000?',
    responseFormat: '{country: string, lifeExpectancy: number}',
    judge: makeSolutionJudge({ country: 'Nigeria', lifeExpectancy: 54.6 }),
  },
  {
    id: 'vl-seattle-weather-t1-sun-vs-rain-feb-apr-aug-oct',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Please compare the amount of rainy and sunny days in the range of Februry-April and August-October. Which range has more sunny days, which has more rainy days?',
    responseFormat: '{moreSunnyRange: string, moreRainyRange: string}',
    judge: makeSolutionJudge({ moreSunnyRange: 'August-October', moreRainyRange: 'February-April' }),
  },
  {
    id: 'vl-seattle-weather-t2-extreme-temp-by-weather',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Determine the extreme temp_max values associated with rain, sun, snow.',
    responseFormat: '{rainTempMax: number, sunTempMax: number, snowTempMax: number}',
    judge: makeSolutionJudge({ rainTempMax: 35.6, sunTempMax: 35, snowTempMax: 11.1 }),
  },
  {
    id: 'vl-seattle-weather-t3-snow-season-temp-range',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Examine when snow occurs in the year and the corresponding temperature ranges.',
    responseFormat: '{observations: Array<{month: string, tempMin: number, tempMax: number}>}',
    judge: makeSolutionJudge({
      observations: [
        { month: 'January', tempMin: -1.1, tempMax: 7.2 },
        { month: 'February', tempMin: 5, tempMax: 6.7 },
        { month: 'March', tempMin: 5.6, tempMax: 11.1 },
        { month: 'April', tempMin: 9.4, tempMax: 9.4 },
        { month: 'November', tempMin: 4.4, tempMax: 4.4 },
        { month: 'December', tempMin: 3.9, tempMax: 8.3 },
      ],
    }),
  },
  {
    id: 'mosaic-athletes-t1-regression-football-vs-cycling',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'Compare the male athletes of football and cycling. For which sport is the regression line steeper?',
    responseFormat: '{steeperSport: string}',
    judge: makeSolutionJudge({ steeperSport: 'football' }),
  },
  {
    id: 'mosaic-athletes-t2-top3-tallest-female',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'Name three tallest female athletes and their height.',
    responseFormat: '{tallestFemales: Array<{name: string, height: number}>}',
    judge: makeSolutionJudge({
      tallestFemales: [
        { name: 'Brittney Griner', height: 2.03 },
        { name: 'Elizabeth Cambage', height: 2.03 },
        { name: 'Linet Arasa', height: 2.03 },
      ],
    }),
  },
  {
    id: 'mosaic-athletes-t3-female-judo-100-120kg-count',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'How many female judo practitioners are between 100 and 120 kg?',
    responseFormat: '{count: number}',
    judge: makeSolutionJudge({ count: 3 }),
  },
  {
    id: 'vl-airports-t1-nd-most-outgoing-top-destination',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'Find in state ND (North Dakota) the airport with the most outgoing flight connections. Which airport are the most flights to?',
    responseFormat: '{airport: string, topDestination: string}',
    judge: makeIataIncludesJudge({ airport: 'FAR', topDestination: 'MSP' }),
  },
  {
    id: 'vl-airports-t2-bangor-to-denver',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'Is it possible to fly from airport Bangor International (State ME, Maine) to airport Denver Intl (CO, Colorado) without transfer?',
    responseFormat: '{isPossible: boolean}',
    judge: makeSolutionJudge({ isPossible: false }),
  },
  {
    id: 'vl-airports-t3-nm-airports-smallest-outgoing-flights',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'How many airports are there in state New Mexico (NM)? How many outgoing flights (total number of flights) does the smallest airport (depending on the number of routes to other airports) have?',
    responseFormat: '{count: number, smallestOutgoingFlights: number}',
    judge: makeSolutionJudge({ count: 2, smallestOutgoingFlights: 961 }),
  },
  {
    id: 'cars-parcoords-t1-cylinders-4-weight-range',
    route: '/cars-parcoords/',
    task: 'Select cylinders 4, what is the range of the weight of the cars',
    responseFormat: '{minWeight: number, maxWeight: number}',
    judge: makeSolutionJudge({ minWeight: 1613, maxWeight: 3270 }),
  },
  {
    id: 'cars-parcoords-t2-largest-positive-correlation',
    route: '/cars-parcoords/',
    task: 'Which dimensions do have the largest positive correlation',
    responseFormat: '{dimensions: [string, string]}',
    judge: makeSolutionJudge({ dimensions: ['Displacement', 'Weight'] }),
  },
  {
    id: 'cars-parcoords-t3-cylinders-6-horsepower-outliers',
    route: '/cars-parcoords/',
    task: 'Given the cars with 6 zylinders identify outliers with respect to the horse power dimension',
    responseFormat: '{outliers: Array<{name: string, horsepower: number}>}',
    judge: makeSolutionJudge({
      outliers: [
        { name: 'Ford Maverick', horsepower: 0 },
        { name: 'Ford Grenada I', horsepower: 112 },
      ],
    }),
  },
];

export function makeSolutionJudge(
  expected: unknown,
  opts?: {
    numericTolerance?: number;
    accept?: 'strict' | 'semantic';
    includeExpected?: boolean;
  },
) {
  const tolerance = typeof opts?.numericTolerance === 'number' ? opts.numericTolerance : 0.15;
  const accept = opts?.accept ?? 'semantic';
  const includeExpected = opts?.includeExpected !== false;

  return ({ answer, parseStatus }: ScenarioJudgeInput): ScenarioJudgeResult => {
    if (parseStatus !== 'ok') {
      return {
        ok: false,
        label: 'parse_error',
        expected: includeExpected ? expected : undefined,
        actual: answer,
        notes: [parseStatus],
      };
    }

    const strictOk = deepEqual(expected, answer, { numericTolerance: tolerance, semantic: false });
    const semanticOk = deepEqual(expected, answer, { numericTolerance: tolerance, semantic: true });
    const ok = accept === 'strict' ? strictOk : semanticOk;

    return {
      ok,
      label: accept,
      strictOk,
      semanticOk,
      expected: includeExpected ? expected : undefined,
      actual: answer,
      metrics: { numericTolerance: tolerance },
    };
  };
}

export function makeIataIncludesJudge(expected: {
  airport: string;
  topDestination: string;
}): (input: ScenarioJudgeInput) => ScenarioJudgeResult {
  const strictJudge = makeSolutionJudge(expected, { accept: 'strict' });

  return ({ answer, parseStatus }: ScenarioJudgeInput): ScenarioJudgeResult => {
    if (parseStatus !== 'ok') return strictJudge({ scenarioId: '', answer, parseStatus });
    if (!answer || typeof answer !== 'object') {
      return { ok: false, label: 'invalid_answer_type', expected, actual: answer };
    }

    const a = answer as Record<string, unknown>;
    const airport = typeof a.airport === 'string' ? a.airport : '';
    const topDestination = typeof a.topDestination === 'string' ? a.topDestination : '';
    const semanticOk =
      airport.toUpperCase().includes(expected.airport.toUpperCase()) &&
      topDestination.toUpperCase().includes(expected.topDestination.toUpperCase());
    const strictOk = strictJudge({ scenarioId: '', answer, parseStatus }).ok;

    return {
      ok: semanticOk,
      label: semanticOk ? 'semantic' : 'semantic',
      strictOk,
      semanticOk,
      expected,
      actual: answer,
      metrics: { method: 'includes_iata' },
    };
  };
}

function deepEqual(expected: unknown, actual: unknown, ctx: { numericTolerance: number; semantic: boolean }): boolean {
  if (expected === null || expected === undefined) return expected === actual;

  if (typeof expected === 'number') return numericEqual(expected, actual, ctx.numericTolerance);
  if (typeof expected === 'string') return typeof actual === 'string' && expected === actual;
  if (typeof expected === 'boolean') return typeof actual === 'boolean' && expected === actual;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return arrayEqual(expected, actual, ctx);
  }

  if (typeof expected === 'object') {
    if (typeof actual !== 'object' || actual === null) return false;
    const e = expected as Record<string, unknown>;
    const a = actual as Record<string, unknown>;

    const eKeys = Object.keys(e).sort();
    const aKeys = Object.keys(a).sort();
    if (eKeys.length !== aKeys.length) return false;
    for (let i = 0; i < eKeys.length; i++) if (eKeys[i] !== aKeys[i]) return false;
    for (const k of eKeys) {
      if (!deepEqual(e[k], a[k], ctx)) return false;
    }
    return true;
  }

  return expected === actual;
}

function numericEqual(expected: number, actual: unknown, tol: number) {
  if (typeof actual !== 'number') return false;
  if (!Number.isFinite(actual)) return false;
  if (Number.isInteger(expected))
    return Number.isInteger(actual) ? expected === actual : Math.round(actual) === expected;
  return Math.abs(expected - actual) <= tol;
}

function arrayEqual(expected: unknown[], actual: unknown[], ctx: { numericTolerance: number; semantic: boolean }) {
  if (expected.length !== actual.length) return false;

  // Simple semantic normalizations that matter for evaluation:
  // - string arrays: treat as order-insensitive sets
  // - arrays of objects w/ name|month: sort by that key
  if (ctx.semantic) {
    if (expected.every((v) => typeof v === 'string') && actual.every((v) => typeof v === 'string')) {
      const e = [...(expected as string[])].sort();
      const a = [...(actual as string[])].sort();
      return e.every((v, i) => v === a[i]);
    }

    const sortKey = (arr: unknown[]) => {
      if (arr.every((v) => typeof v === 'object' && v !== null && 'name' in (v as any))) return 'name';
      if (arr.every((v) => typeof v === 'object' && v !== null && 'month' in (v as any))) return 'month';
      return null;
    };

    const key = sortKey(expected) && sortKey(actual);
    if (key) {
      const normMonth = key === 'month' ? normalizeMonth : (s: string) => s;
      const e = [...(expected as any[])].sort((x, y) =>
        String(normMonth(String(x[key]))).localeCompare(String(normMonth(String(y[key])))),
      );
      const a = [...(actual as any[])].sort((x, y) =>
        String(normMonth(String(x[key]))).localeCompare(String(normMonth(String(y[key])))),
      );
      return e.every((v, i) => deepEqual(v, a[i], ctx));
    }
  }

  // Strict fallback: positional compare
  return expected.every((v, i) => deepEqual(v, actual[i], ctx));
}

function normalizeMonth(value: string) {
  const k = value.trim().toLowerCase();
  const map: Record<string, string> = {
    jan: 'January',
    january: 'January',
    feb: 'February',
    february: 'February',
    mar: 'March',
    march: 'March',
    apr: 'April',
    april: 'April',
    may: 'May',
    jun: 'June',
    june: 'June',
    jul: 'July',
    july: 'July',
    aug: 'August',
    august: 'August',
    sep: 'September',
    sept: 'September',
    september: 'September',
    oct: 'October',
    october: 'October',
    nov: 'November',
    november: 'November',
    dec: 'December',
    december: 'December',
  };
  return map[k] ?? value;
}
