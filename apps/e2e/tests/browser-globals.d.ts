import type { VacpAgentActivityHandle, VacpPageBridge } from '@ethivia/vacp-sdk';

declare global {
  interface Window {
    __vacpStream?: VacpAgentActivityHandle;
    __vacp?: VacpPageBridge;
  }
}
