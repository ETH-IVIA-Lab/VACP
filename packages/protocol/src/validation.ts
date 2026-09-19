import { z } from 'zod';
import { VACP_SCHEMA_VERSION, type VacpActionResult, type VacpObservation } from './schema';
import { vacpRefSchema } from './util';
const fields = z.record(z.string(), z.unknown());
const sourceId = z.templateLiteral(['vacp-source://', z.string()]);
const operation = z.object({
  kind: z.enum(['mutation', 'creation', 'evaluation', 'query']),
  contract: z.string().optional(),
  inputRefs: z.array(vacpRefSchema).optional(),
  affects: z.array(vacpRefSchema).optional(),
  refParameters: z.array(z.object({ parameter: z.string(), role: z.enum(['input', 'affects']) })).optional(),
  results: z
    .array(
      z.object({
        role: z.enum(['state', 'entity', 'data', 'visualization', 'artifact']),
        ref: vacpRefSchema.optional(),
        kind: z.string().optional(),
        mediaType: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});
const observationSchema = z.object({
  version: z.literal(VACP_SCHEMA_VERSION),
  revision: z.string(),
  observedAt: z.string(),
  graph: z.object({
    version: z.literal(VACP_SCHEMA_VERSION),
    sources: z.array(
      z.object({
        id: sourceId,
        type: z.string(),
        title: z.string(),
        description: z.string().optional(),
        data: fields.optional(),
      }),
    ),
    ownership: z.object({ nodes: z.record(vacpRefSchema, sourceId), actions: z.record(z.string(), sourceId) }),
    nodes: z.array(
      z.object({
        ref: vacpRefSchema,
        kind: z.string(),
        layer: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        data: fields.optional(),
      }),
    ),
    edges: z.array(z.object({ from: vacpRefSchema, to: vacpRefSchema, kind: z.string() })),
    actions: z.array(
      z.object({
        name: z.string(),
        title: z.string().optional(),
        description: z.string(),
        parameters: fields.optional(),
        operation,
      }),
    ),
  }),
  state: z.record(vacpRefSchema, z.unknown()),
  summary: z.record(vacpRefSchema, z.unknown()).optional(),
  freshness: z
    .record(
      vacpRefSchema,
      z.object({
        status: z.enum(['current', 'stale', 'running', 'error']),
        inputRevision: z.string().optional(),
        outputRevision: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
}) satisfies z.ZodType<VacpObservation>;
const resultSchema = z.discriminatedUnion('ok', [
  z.object({ callId: z.string(), ok: z.literal(true), result: z.unknown().optional() }),
  z.object({
    callId: z.string(),
    ok: z.literal(false),
    error: z.object({ message: z.string(), details: z.unknown().optional() }),
  }),
]) satisfies z.ZodType<VacpActionResult>;

export const parseObservation = (value: unknown) => observationSchema.parse(value);
export const parseActionResult = (value: unknown) => resultSchema.parse(value);
