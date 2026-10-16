import { csvParse, median, rollups } from 'd3';
import { z } from 'zod';
import athletesUrl from '../../vgplot-gallery/public/data/athletes.csv?url';

const measurement = z
  .string()
  .transform((value) => (value === '' ? null : Number(value)))
  .pipe(z.number().positive().nullable());
const athleteSchema = z
  .object({
    id: z.coerce.number(),
    name: z.string(),
    nationality: z.string(),
    sex: z.enum(['female', 'male']),
    date_of_birth: z.iso.date(),
    height: measurement,
    weight: measurement,
    sport: z.string(),
    gold: z.coerce.number(),
    silver: z.coerce.number(),
    bronze: z.coerce.number(),
  })
  .transform(({ date_of_birth, ...row }) => ({
    ...row,
    age: 2016 - Number(date_of_birth.slice(0, 4)) - (date_of_birth.slice(5) > '08-05' ? 1 : 0),
    medalist: row.gold + row.silver + row.bronze > 0,
  }));
export type Athlete = z.infer<typeof athleteSchema>;
export type Range = [number, number];
export type BodyRange = { weight: Range; height: Range };
type Filters = { sports: readonly string[]; sex: 'all' | Athlete['sex']; age: Range | null; body: BodyRange | null };
export type SportSummary = { sport: string; count: number; medalists: number; rate: number };

export async function loadAthletes(): Promise<Athlete[]> {
  const response = await fetch(athletesUrl);
  if (!response.ok) throw new Error(`Athlete data failed to load (${response.status})`);
  return csvParse(await response.text()).map((row) => athleteSchema.parse(row));
}
const within = (value: number | null, range: Range) => value !== null && value >= range[0] && value <= range[1];

export function createCohort(athletes: Athlete[]) {
  let filters: Filters = { sports: [], sex: 'all', age: null, body: null };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    if (JSON.stringify(next) === JSON.stringify(filters)) return;
    filters = next;
    for (const listener of listeners) listener();
  };
  const rows = (omit?: keyof Filters) =>
    athletes.filter(
      (row) =>
        (omit === 'sports' || filters.sports.length === 0 || filters.sports.includes(row.sport)) &&
        (omit === 'sex' || filters.sex === 'all' || row.sex === filters.sex) &&
        (omit === 'age' || !filters.age || within(row.age, filters.age)) &&
        (omit === 'body' ||
          !filters.body ||
          (within(row.weight, filters.body.weight) && within(row.height, filters.body.height))),
    );
  return {
    athletes,
    sports: [...new Set(athletes.map((row) => row.sport))].sort(),
    get filters(): Readonly<Filters> {
      return filters;
    },
    rows,
    setSports: (sports: readonly string[]) => update({ sports: [...new Set(sports)].sort() }),
    setSex: (sex: Filters['sex']) => update({ sex }),
    setAge: (age: Range | null) => update({ age }),
    setBody: (body: BodyRange | null) => update({ body }),
    summary() {
      const selected = rows();
      return {
        count: selected.length,
        countries: new Set(selected.map((row) => row.nationality)).size,
        medalists: selected.filter((row) => row.medalist).length,
        medianAge: median(selected, (row) => row.age) ?? null,
        missingBody: selected.filter((row) => row.height === null || row.weight === null).length,
      };
    },
    ranking(): SportSummary[] {
      return rollups(
        rows('sports'),
        (group) => ({ count: group.length, medalists: group.filter((row) => row.medalist).length }),
        (row) => row.sport,
      )
        .map(([sport, value]) => ({ sport, ...value, rate: value.medalists / value.count }))
        .sort((a, b) => b.rate - a.rate || b.count - a.count || a.sport.localeCompare(b.sport));
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type Cohort = ReturnType<typeof createCohort>;
