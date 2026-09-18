/** Values carried by snapshots and actions before JSON serialization. */
export type JsonScalar = string | number | boolean | null | undefined;

export type JsonValue = JsonScalar | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };
