import { safeParseAsync, type $ZodIssue, type $ZodType, type output } from 'zod/v4/core';
import { VacpActionError } from '@vacp/protocol';

/** One parameter failure. Union failures list each branch's issues, and key or element failures nest theirs. */
export type VacpParameterIssue = {
  path: (string | number)[];
  code: $ZodIssue['code'];
  message: string;
  errors?: VacpParameterIssue[][];
  issues?: VacpParameterIssue[];
};

function parameterIssue(issue: $ZodIssue): VacpParameterIssue {
  const diagnostic = {
    path: issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
    code: issue.code,
    message: issue.message,
  };
  if (issue.code === 'invalid_union') {
    return { ...diagnostic, errors: issue.errors.map((branch) => branch.map(parameterIssue)) };
  }
  if (issue.code === 'invalid_key' || issue.code === 'invalid_element') {
    return { ...diagnostic, issues: issue.issues.map(parameterIssue) };
  }
  return diagnostic;
}

/**
 * Parse an action's `params` with a Zod schema. A failure rejects with a `VacpActionError` whose
 * details are `{ code: 'invalid-params', issues }`. Issues carry paths and codes, never submitted values.
 */
export function parseVacpParams<Schema extends $ZodType>(action: string, schema: Schema) {
  return async (value: unknown): Promise<output<Schema>> => {
    const parsed = await safeParseAsync(schema, value);
    if (!parsed.success) {
      throw new VacpActionError(`Invalid parameters for action "${action}"`, {
        code: 'invalid-params',
        issues: parsed.error.issues.map(parameterIssue),
      });
    }
    return parsed.data;
  };
}
