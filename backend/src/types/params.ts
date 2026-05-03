export function getParam(value: string | string[] | undefined): string {
  if (!value) {
    throw new Error('Missing route parameter.');
  }
  return Array.isArray(value) ? value[0] : value;
}
