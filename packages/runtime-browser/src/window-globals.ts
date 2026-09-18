const DEFAULT_GLOBAL_KEY = '__vacp';

export function resolveVacpGlobalKey(globalKey: string | undefined): string {
  return globalKey?.length ? globalKey : DEFAULT_GLOBAL_KEY;
}
