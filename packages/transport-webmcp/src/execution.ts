/** Native callers may omit execution context. Always retain the host lifetime when supplied. */
export function webMcpExecutionSignal(context?: { signal?: AbortSignal }, lifetime?: AbortSignal): AbortSignal {
  const caller = context?.signal;
  if (caller && lifetime) return AbortSignal.any([caller, lifetime]);
  return caller ?? lifetime ?? new AbortController().signal;
}
