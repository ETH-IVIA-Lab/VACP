export function formatSolvedStatus(value: boolean | null): string {
  if (value === null) return 'Plumbing Failure';
  return value ? 'Correct Solution' : 'Incorrect Solution';
}
