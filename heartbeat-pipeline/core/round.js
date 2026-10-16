/** Round a number to 1 decimal place. */
export function round1(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
