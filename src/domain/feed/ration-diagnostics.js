function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(label + " must be a finite number.");
  return number;
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || !String(profile.id || "").trim() ||
      !Number.isSafeInteger(profile.version) || profile.version < 1) {
    throw new Error("A versioned diagnostic profile is required.");
  }
  const forage = finite(profile.minimumForageDMFraction, "Minimum forage DM fraction");
  const me = finite(profile.minimumMEDensityMJPerKgDM, "Minimum ME density");
  const cp = finite(profile.minimumCPPercentDM, "Minimum CP percentage");
  if (forage < 0 || forage > 1 || me < 0 || cp < 0 || cp > 100) {
    throw new Error("Diagnostic profile thresholds are outside supported ranges.");
  }
  return { forage, me, cp };
}

export function evaluateRation(ration, profile) {
  const thresholds = validateProfile(profile);
  const totalDMIKg = finite(ration?.totalDMIKg, "Total DMI");
  const forageDMKg = finite(ration?.forageDMKg, "Forage DM");
  const meDensity = finite(ration?.meDensityMJPerKgDM, "ME density");
  const cpPercent = finite(ration?.cpPercentDM, "CP percentage");
  if (totalDMIKg <= 0 || forageDMKg < 0 || forageDMKg > totalDMIKg || meDensity < 0 ||
      cpPercent < 0 || cpPercent > 100) {
    throw new Error("Ration diagnostics received invalid calculated values.");
  }

  const shared = { profileId: profile.id, profileVersion: profile.version };
  const findings = [];
  if (forageDMKg / totalDMIKg < thresholds.forage) {
    findings.push({ code: "LOW_FORAGE_DM_SHARE", severity: "warning", ...shared });
  }
  if (meDensity < thresholds.me) {
    findings.push({ code: "LOW_ME_DENSITY", severity: "warning", ...shared });
  }
  if (cpPercent < thresholds.cp) {
    findings.push({ code: "LOW_CP_PERCENT_DM", severity: "warning", ...shared });
  }
  if (findings.length === 0) {
    findings.push({ code: "NO_CONFIGURED_THRESHOLD_TRIGGERED", severity: "info", ...shared });
  }
  return Object.freeze(findings.map((finding) => Object.freeze(finding)));
}
