#!/usr/bin/env bash
# Regenerate supabase/functions/_shared/email-templates.gen.ts from the
# source .txt and .html files under _shared/email-templates/.
#
# Run this whenever you edit any file under _shared/email-templates/.
# Then redeploy the affected functions (stripe-webhook, send-email).
#
# Usage:
#   bash supabase/scripts/regen-email-templates.sh
set -euo pipefail

cd "$(dirname "$0")/../functions/_shared/email-templates"

OUT="../email-templates.gen.ts"

python3 - <<'PYEOF' > "$OUT"
import os, json

names = ['welcome', 'payment-receipt', 'plan-ready', 'block-delivered', 'payment-failed', 'upcoming-renewal',
         'subscription-pause-scheduled', 'subscription-resuming-soon', 'subscription-resumed',
         'subscription-cancel-scheduled', 'subscription-canceled', 'subscription-cancel-reversed']
print("// ============================================================")
print("// supabase/functions/_shared/email-templates.gen.ts")
print("//")
print("// Auto-generated from _shared/email-templates/*/{subject.txt,html.html,text.txt}.")
print("// DO NOT EDIT BY HAND — regenerate with supabase/scripts/regen-email-templates.sh")
print("// after editing the source files.")
print("//")
print("// Inlined here because Supabase functions deploy only bundles .ts files")
print("// in the dependency graph. Reading templates via Deno.readTextFile() at")
print("// runtime fails with NotFound because the .txt/.html assets aren't")
print("// shipped. Inlining as TS strings ships them with the deploy.")
print("// ============================================================")
print()
print("export interface InlinedTemplate {")
print("  subject: string;")
print("  html: string;")
print("  text: string;")
print("}")
print()
print("export const TEMPLATES: Record<string, InlinedTemplate> = {")
for name in names:
    sub = open(f"{name}/subject.txt").read().rstrip()
    html = open(f"{name}/html.html").read()
    txt = open(f"{name}/text.txt").read()
    print(f"  {json.dumps(name)}: {{")
    print(f"    subject: {json.dumps(sub)},")
    print(f"    html: {json.dumps(html)},")
    print(f"    text: {json.dumps(txt)},")
    print(f"  }},")
print("};")
PYEOF

echo "✓ Wrote $OUT"
echo "Next: redeploy stripe-webhook + send-email functions."
