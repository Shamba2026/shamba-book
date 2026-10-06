const REQUIRED_TABLES = Object.freeze({
  animals: ["farm_id", "animal_id", "client_id"],
  milk_logs: ["farm_id", "animal_id", "client_id", "local_date", "session", "yield_liters"],
  weight_logs: ["farm_id", "animal_id", "client_id", "local_date", "kilograms"],
  breeding_logs: ["farm_id", "animal_id", "client_id", "event_type", "event_date"],
  health_logs: ["farm_id", "animal_id", "client_id", "treatment_type", "treatment_date"],
  expense_logs: ["farm_id", "client_id", "category", "amount", "expense_date"],
  income_logs: ["farm_id", "client_id", "category", "amount", "income_date"],
  payment_logs: ["farm_id", "client_id", "payment_type", "amount", "payment_date"]
});

function issue(code, table, detail) { return Object.freeze({ code, table, detail }); }

export function assessCloudReadiness(evidence) {
  const tables = new Map((evidence?.tables || []).map((table) => [table.name, table]));
  const policies = evidence?.policies || [];
  const issues = [];
  for (const [name, requiredColumns] of Object.entries(REQUIRED_TABLES)) {
    const table = tables.get(name);
    if (!table) { issues.push(issue("MISSING_TABLE", name, "Required by the current cloud adapter.")); continue; }
    if (table.rlsEnabled !== true) issues.push(issue("RLS_NOT_VERIFIED", name, "RLS-enabled status must be explicitly verified."));
    const columns = new Set(table.columns || []);
    for (const column of requiredColumns) if (!columns.has(column)) issues.push(issue("MISSING_COLUMN", name, column));
    if (!policies.some((policy) => policy.table === name && policy.roles?.includes("authenticated") &&
      ["ALL", "INSERT"].includes(policy.command))) {
      issues.push(issue("WRITE_POLICY_NOT_VERIFIED", name, "Authenticated farm-member write policy is not evidenced."));
    }
  }
  const membership = tables.get("farm_members");
  if (!membership) issues.push(issue("MISSING_TABLE", "farm_members", "Membership gate cannot be verified."));
  else {
    if (membership.rlsEnabled !== true) issues.push(issue("RLS_NOT_VERIFIED", "farm_members", "RLS-enabled status must be explicitly verified."));
    if (!policies.some((policy) => policy.table === "farm_members" && policy.roles?.includes("authenticated") &&
      ["ALL", "SELECT"].includes(policy.command))) {
      issues.push(issue("MEMBERSHIP_POLICY_NOT_VERIFIED", "farm_members", "Authenticated users need a constrained membership read policy."));
    }
  }
  return Object.freeze({ ready: issues.length === 0, issues: Object.freeze(issues) });
}

export const CLOUD_ADAPTER_TABLES = Object.freeze(Object.keys(REQUIRED_TABLES));
