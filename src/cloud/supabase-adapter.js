import { APP_CONFIG } from "../config.js";

let clientPromise = null;

async function ensureClient() {
  if (!APP_CONFIG.cloud.enabled) {
    throw new Error("Cloud sync is disabled until the secure Supabase schema, RLS and auth configuration is verified.");
  }

  if (window.supabase && window.supabase.createClient) {
    return window.supabase.createClient(APP_CONFIG.cloud.supabaseUrl, APP_CONFIG.cloud.supabaseAnonKey);
  }

  if (!clientPromise) {
    clientPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = APP_CONFIG.cloud.supabaseJsCdn;
      script.onload = () => {
        if (!window.supabase || !window.supabase.createClient) {
          reject(new Error("Supabase client loaded but createClient is unavailable."));
          return;
        }
        resolve(window.supabase.createClient(APP_CONFIG.cloud.supabaseUrl, APP_CONFIG.cloud.supabaseAnonKey));
      };
      script.onerror = () => reject(new Error("Could not load the Supabase client."));
      document.head.appendChild(script);
    });
  }

  return clientPromise;
}

const TABLES = Object.freeze({
  animal: "animals",
  milk: "milk_logs",
  weight: "weight_logs",
  breeding: "breeding_events",
  health: "health_logs",
  expense: "expense_logs",
  income: "income_logs",
  payment: "payment_logs"
});

export async function push(record) {
  const client = await ensureClient();
  const table = TABLES[record.kind];
  if (!table) throw new Error("No cloud table mapping for record type " + record.kind + ".");

  const payload = { ...record };
  delete payload.kind;

  const { error } = await client.from(table).upsert(payload, { onConflict: "client_id" });
  if (error) throw error;
  return true;
}
