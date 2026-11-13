// @ethivia/vacp-sdk/agent: the agent tools over a page bridge, WebMCP registration, and the tool contract they share.
export {
  createVacpToolHandlers,
  type VacpExecuteInput,
  type VacpProgressInput,
  type VacpToolBridge,
  type VacpToolHandlers,
} from '../bridge';
export { getVacpBridge } from '../browser';
export {
  compileVacpWebMcpTools,
  installVacpWebMcp,
  type VacpWebMcpInstallation,
  type VacpWebMcpOptions,
  type VacpWebMcpRegistry,
  type VacpWebMcpSource,
} from '../webmcp';
export {
  parseVacpNarration,
  VACP_NARRATION_MAX_LENGTH,
  VACP_SCHEMA_VERSION,
  type VacpAgentActivityControl,
  vacpAgentToolGuidance,
  vacpAgentTools,
  type VacpCapabilitiesRequest,
  vacpNarrationGuidance,
  vacpProgressFields,
  type VacpStateRequest,
  vacpToolResult,
  type VacpToolResult,
} from '../protocol';
