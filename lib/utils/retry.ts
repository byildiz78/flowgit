/**
 * Generic retry function with delay
 * @param fn Function to retry
 * @param options Options for retry
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    minTimeout?: number;
    maxTimeout?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const {
    retries = 3,
    minTimeout = 1000,
    maxTimeout = 5000,
    onRetry = () => {}
  } = options;

  let lastError: Error;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Son denemede hata olursa direkt throw
      if (attempt === retries) {
        throw error;
      }

      // Network veya timeout hatalarını kontrol et
      if (error.name === 'AbortError' || 
          error.code === 'UND_ERR_HEADERS_TIMEOUT' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT') {
        
        // Exponential backoff ile bekleme süresi hesapla
        const timeout = Math.min(
          Math.ceil(Math.random() * Math.pow(2, attempt) * minTimeout),
          maxTimeout
        );

        onRetry(error, attempt);
        await new Promise(resolve => setTimeout(resolve, timeout));
        continue;
      }

      // Diğer hataları direkt throw et
      throw error;
    }
  }

  throw lastError;
}
