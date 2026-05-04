export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitWithAbortChecks(ms: number, isAborted: () => boolean): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (isAborted()) return true;
    await delay(Math.min(500, end - Date.now()));
  }
  return false;
}
