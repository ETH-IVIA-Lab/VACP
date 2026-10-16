import type { VacpAgentActivityHandle, VacpPageBridge } from '@vacp/protocol';

declare global {
  interface Window {
    __vacpStream?: VacpAgentActivityHandle;
    __vacp?: VacpPageBridge;
  }
}
