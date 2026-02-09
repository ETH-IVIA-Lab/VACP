export function formatSolvedStatus(value: boolean | null): string {
  if (value === null) return 'Timeout';
  return value ? 'Correct Solution' : 'Incorrect Solution';
}
