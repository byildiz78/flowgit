/**
 * Generic retry function with delay
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries
 * @param delay Delay between retries in milliseconds
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delay: number
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.warn(
        `[RETRY] Attempt ${attempt}/${maxRetries} failed:`,
        (error instanceof Error) ? error.message : String(error)
      );

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed after ${maxRetries} attempts. Last error: ${lastError?.message}`
  );
}
