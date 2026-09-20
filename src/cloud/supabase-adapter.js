import { APP_CONFIG } from "../config.js";
import { get } from "../storage/local-db.js";
import { getAuthClient } from "../auth.js";

let clientPromise = null;

export async function ensureClient() {
  if (!APP_CONFIG.cloud.enabled) {
    throw new Error("Cloud sync is disabled until the secure Supabase schema, RLS and auth configuration is verified.");
  }
  if (!APP_CONFIG.cloud.farmId || !APP_CONFIG.cloud.supabaseAnonKey) {
    throw new Error("Cloud sync is not configured for a farm yet.");
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
  breeding: "breeding_logs",
  health: "health_logs",
  expense: "expense_logs",
  income: "income_logs",
  payment: "payment_logs"
});

const REQUIRED = Object.freeze({
  animal: ["animal_id", "type", "breed"],
  milk: ["animal_id", "local_date", "session", "yield_liters"],
  weight: ["animal_id", "local_date", "kilograms"],
  breeding: ["animal_id", "event_type", "event_date"],
  health: ["animal_id", "treatment_type", "treatment_date"],
  expense: ["category", "amount", "expense_date"],
  income: ["category", "amount", "income_date"],
  payment: ["payment_type", "amount", "payment_date"]
});

async function resolveAnimalCode(animalId) {
  if (!animalId) return animalId;
  const animal = await get("animals", animalId);
  return animal?.animalCode || animalId;
}

export function toCloudPayload(record, farmId = APP_CONFIG.cloud.farmId) {
  if (!farmId) throw new Error("Farm ID is required for cloud synchronization.");

  const common = {
    farm_id: farmId,
    id: record.id,
    client_id: record.clientId || record.id
  };

  const payloads = {
    animal: {
      farm_id: farmId,
      client_id: record.clientId || record.id,
      animal_id: record.animalCode,
      rfid: record.rfid || null,
      qr_value: record.qrValue || null,
      type: record.type,
      sex: record.sex || null,
      breed: record.breed,
      birth_date: record.birthDate || null,
      acquired_date: record.acquiredDate || null,
      source: record.source || null,
      status: record.status || "active",
      dam_id: record.damId || null,
      sire_id: record.sireId || null,
      notes: record.notes || null,
      updated_at: record.updatedAt || new Date().toISOString()
    },
    milk: {
      ...common,
      animal_id: record.animalId,
      local_date: record.localDate,
      session: record.session,
      yield_liters: record.liters
    },
    weight: {
      ...common,
      animal_id: record.animalId,
      local_date: record.localDate,
      kilograms: record.kilograms
    },
    breeding: {
      ...common,
      animal_id: record.animalId,
      event_type: record.eventType || "service",
      event_date: record.eventDate || record.serviceDate,
      expected_calving: record.expectedCalving || null,
      result: record.result || null,
      notes: record.notes || null
    },
    health: {
      ...common,
      animal_id: record.animalId,
      treatment_type: record.treatmentType,
      description: record.description || null,
      treatment_date: record.treatmentDate,
      medicine: record.medicine || null,
      dose: record.dose || null,
      provider: record.provider || null,
      withdrawal_end_date: record.withdrawalEndDate || null,
      cost: Number(record.cost || 0)
    },
    expense: {
      ...common,
      category: record.category,
      amount: record.amount,
      expense_date: record.expenseDate,
      notes: record.notes || null,
      supplier: record.supplier || null
    },
    income: {
      ...common,
      category: record.category,
      amount: record.amount,
      income_date: record.incomeDate,
      reference: record.reference || null,
      notes: record.notes || null
    },
    payment: {
      ...common,
      payment_type: record.paymentType,
      amount: record.amount,
      payment_date: record.paymentDate,
      counterparty_name: record.counterpartyName || null,
      counterparty_phone: record.counterpartyPhone || null,
      mpesa_code: record.mpesaCode || null,
      linked_record_type: record.linkedRecordType || null,
      linked_record_id: record.linkedRecordId || null,
      proof_path: record.proofPath || null,
      notes: record.notes || null
    }
  };

  const payload = payloads[record.kind];
  if (!payload) throw new Error("No cloud mapping for record type " + record.kind + ".");

  const missing = REQUIRED[record.kind].filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
  if (missing.length) throw new Error("Cloud payload is missing: " + missing.join(", ") + ".");

  return payload;
}

export async function push(record) {
  const client = await ensureClient();
  const table = TABLES[record.kind];
  if (!table) throw new Error("Cloud table is not configured for record type " + record.kind + ".");
  const resolvedRecord = ["milk", "weight", "breeding", "health"].includes(record.kind)
    ? { ...record, animalId: await resolveAnimalCode(record.animalId) }
    : record;
  const payload = toCloudPayload(resolvedRecord);
  const conflictTarget = record.kind === "animal" ? "farm_id,animal_id" : "client_id";
  const safePayload = record.kind === "animal" ? (() => { const { id, ...withoutId } = payload; return withoutId; })() : payload;
  const { error } = await client.from(table).upsert(safePayload, { onConflict: conflictTarget });
  if (error) throw error;
  return true;
}


export async function pullFarmSnapshot() {
  if (!APP_CONFIG.cloud.farmId) throw new Error("Farm ID is required for cloud import.");

  const client = await getAuthClient();
  const { data: authData, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  if (!authData.session?.user) throw new Error("Sign in before importing farm data.");

  const farmId = APP_CONFIG.cloud.farmId;
  const [farm, animals, milk, breeding, health, expense, weight] = await Promise.all([
    client.from("farms").select("*").eq("id", farmId).maybeSingle(),
    client.from("animals").select("*").eq("farm_id", farmId).order("animal_id"),
    client.from("milk_logs").select("*").eq("farm_id", farmId).order("recorded_at"),
    client.from("breeding_logs").select("*").eq("farm_id", farmId).order("event_date"),
    client.from("health_logs").select("*").eq("farm_id", farmId).order("treatment_date"),
    client.from("expense_logs").select("*").eq("farm_id", farmId).order("expense_date"),
    client.from("weight_logs").select("*").eq("farm_id", farmId).order("local_date")
  ]);

  for (const result of [farm, animals, milk, breeding, health, expense, weight]) {
    if (result.error) throw result.error;
  }

  return {
    farm: farm.data || null,
    animals: animals.data || [],
    milk: milk.data || [],
    breeding: breeding.data || [],
    health: health.data || [],
    expense: expense.data || [],
    weight: weight.data || []
  };
}
