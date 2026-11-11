import { auth } from '../firebase';

export interface ApiFetchOptions extends RequestInit {
  skipAuth?: boolean;
}

/**
 * Single authoritative client API caller.
 * - Automatically attaches fresh Firebase ID token as Bearer token if user is signed in.
 * - Strips any spoofed x-actor-* headers.
 * - Automatically retries once on HTTP 401 after forcing a token refresh.
 * - Provides honest network error and offline messages.
 */
export async function authenticatedFetch(
  url: string,
  options: ApiFetchOptions = {},
  forceRefresh = false
): Promise<Response> {
  const headers = new Headers(options.headers || {});

  // Remove any spoofed x-actor-* headers
  headers.delete('x-actor-uid');
  headers.delete('x-actor-role');
  headers.delete('x-actor-email');
  headers.delete('x-actor-biz-id');

  // Attach fresh Bearer ID token if user is authenticated and skipAuth is not explicitly true
  if (!options.skipAuth) {
    if (auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken(forceRefresh);
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }
      } catch (tokenErr) {
        console.warn('[ApiClient] Failed to acquire Firebase ID token:', tokenErr);
      }
    } else if (typeof window !== 'undefined' && !headers.has('Authorization')) {
      const isDemo =
        localStorage.getItem('paypilot_data_source') === 'demo' ||
        (typeof import.meta !== 'undefined' && import.meta.env?.DEV);
      if (isDemo) {
        const role = localStorage.getItem('paypilot_active_role') || 'seller';
        headers.set('Authorization', `Bearer demo-token-${role}-demo-user-${role}-biz-aerocool`);
      }
    }
  }

  // Ensure JSON content-type if body is provided and not FormData
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Auto-retry once on 401 with force-refreshed token
    if (response.status === 401 && auth.currentUser && !forceRefresh && !options.skipAuth) {
      console.info('[ApiClient] Received 401. Attempting forced token refresh and retry...');
      return await authenticatedFetch(url, options, true);
    }

    return response;
  } catch (netErr: any) {
    // Retry once for transient socket reset or event-loop stall if not already retried
    if (!forceRefresh) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return await authenticatedFetch(url, options, true);
      } catch {
        // Fall through to error messaging
      }
    }

    if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('You appear to be offline. Please check your internet connection.');
    }
    throw new Error(netErr?.message || 'Network request failed. Please try again.');
  }
}
