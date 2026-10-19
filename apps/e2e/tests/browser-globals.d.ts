import type { VacpAgentActivityHandle, VacpPageBridge } from '@ethivia/vacp-protocol';

declare global {
  interface Window {
    __vacpStream?: VacpAgentActivityHandle;
    __vacp?: VacpPageBridge;
  }
}
