export interface PartNameInfo {
  readonly [name: string]: string | boolean | number;
}

export function partNameMap(parts: PartNameInfo) {
  return Object.keys(parts)
    .filter((key) => parts[key])
    .join(' ');
}
