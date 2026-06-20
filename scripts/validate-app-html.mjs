/**
 * Validates JavaScript syntax in public/app.html before deployment.
 * Extracts all <script> blocks and checks each with `node --check`.
 * Exit code 1 = syntax error → build fails → Vercel does not deploy.
 */
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

const htmlPath = new URL("../public/app.html", import.meta.url).pathname;
const html = readFileSync(htmlPath, "utf8");

const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let index = 0;
let hasError = false;

while ((match = scriptRegex.exec(html)) !== null) {
  const attrs = match[1];
  const code = match[2].trim();
  // Skip non-JS script blocks (JSON-LD, module imports with src, etc.)
  if (/type\s*=\s*["'][^"']*json[^"']*["']/i.test(attrs)) continue;
  if (/\bsrc\s*=/i.test(attrs)) continue;
  if (!code) continue;

  index++;
  const tmpFile = join(tmpdir(), `lp-validate-${index}.js`);
  writeFileSync(tmpFile, code);

  try {
    execSync(`node --check "${tmpFile}"`, { stdio: "pipe" });
    console.log(`✓ Script block ${index}: OK (${(code.length/1024).toFixed(0)}KB)`);
  } catch (err) {
    const msg = err.stderr?.toString() || err.message;
    console.error(`✗ Script block ${index}: SYNTAX ERROR`);
    console.error(msg.replace(tmpFile, `app.html <script #${index}>`));
    hasError = true;
  } finally {
    try { unlinkSync(tmpFile); } catch (_) {}
  }
}

if (index === 0) {
  console.error("✗ No <script> blocks found in app.html — file may be empty or broken");
  process.exit(1);
}

if (hasError) {
  console.error("\n🚫 Build aborted: fix syntax errors before deploying.");
  process.exit(1);
}

console.log(`\n✓ All ${index} script block(s) valid — safe to deploy.`);
