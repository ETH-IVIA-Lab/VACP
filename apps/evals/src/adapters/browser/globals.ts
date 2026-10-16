import type { VacpAgentActivityHandle, VacpPageBridge } from '@vacp/protocol';
import type {} from 'webmcp-types';

import type { ExecutionRecord } from '../../core/scenario';

declare global {
  var __vacp: VacpPageBridge;
  /** The run log the eval keeps in the page, by execution id, until the runner collects settled entries. */
  var __vacpEvalLog: { entries: Map<string, ExecutionRecord>; settled: Set<string> } | undefined;
  /** Agent turns the eval opened in the page, by handle id, until they end. */
  var __vacpEvalTurns: Map<string, VacpAgentActivityHandle> | undefined;
}
