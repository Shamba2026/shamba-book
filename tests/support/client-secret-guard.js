import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const DEPLOYABLE_EXTENSIONS = new Set([".html", ".js", ".json", ".css", ".webmanifest"]);
const EXCLUDED_DIRECTORIES = new Set([".git", ".github", "node_modules", "test-artifacts", "tests"]);
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const PRIVILEGED_ASSIGNMENT = /(?:service[_-]?role[_-]?key|supabase[_-]?service[_-]?key|secret[_-]?access[_-]?key)\s*[:=]\s*["'`]([^"'`\s]+)/i;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

async function deployableFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await deployableFiles(filename));
    else if (entry.isFile() && DEPLOYABLE_EXTENSIONS.has(path.extname(entry.name))) files.push(filename);
  }
  return files;
}

function jwtRole(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8")).role || null;
  } catch {
    return null;
  }
}

export async function scanClientFiles(root) {
  const findings = [];
  for (const filename of await deployableFiles(root)) {
    const source = await readFile(filename, "utf8");
    const relative = path.relative(root, filename);
    if (PRIVATE_KEY.test(source)) findings.push(`${relative}: embedded private key`);
    if (PRIVILEGED_ASSIGNMENT.test(source)) findings.push(`${relative}: privileged credential assignment`);
    for (const token of source.match(JWT) || []) {
      const role = jwtRole(token);
      if (role && role !== "anon") findings.push(`${relative}: embedded ${role} JWT`);
    }
  }
  return findings.sort();
}
