import { APP_CONFIG } from "./config.js";

let clientPromise = null;

async function loadClient() {
  if (!APP_CONFIG.cloud.supabaseUrl || !APP_CONFIG.cloud.supabaseAnonKey) {
    throw new Error("Supabase authentication is not configured.");
  }

  if (window.supabase?.createClient) {
    return window.supabase.createClient(
      APP_CONFIG.cloud.supabaseUrl,
      APP_CONFIG.cloud.supabaseAnonKey
    );
  }

  if (!clientPromise) {
    clientPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = APP_CONFIG.cloud.supabaseJsCdn;
      script.onload = () => {
        if (!window.supabase?.createClient) {
          reject(new Error("Supabase client loaded but createClient is unavailable."));
          return;
        }
        resolve(window.supabase.createClient(
          APP_CONFIG.cloud.supabaseUrl,
          APP_CONFIG.cloud.supabaseAnonKey
        ));
      };
      script.onerror = () => reject(new Error("Could not load the Supabase client."));
      document.head.appendChild(script);
    });
  }

  return clientPromise;
}

export const getAuthClient = loadClient;
