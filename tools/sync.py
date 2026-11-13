# Keeps the browser copies of the report parser identical to api/_report.js, and refreshes the CSP script hashes.
import re, json, hashlib, base64, glob
src = open('api/_report.js').read().replace('export const ', 'const ').replace('export function ', 'function ')
for p in ['public/apply.html', 'public/account.html']:
    s = open(p).read()
    i = s.index('<script>// Reads a Shopify'); j = s.index('</script>', i)
    old = s[i+8:j]
    # the inlined block may be followed by page code in the same script; replace only the parser part (ends after summarize)
    end = old.index('    flags, required: R,\n  };\n}\n') + len('    flags, required: R,\n  };\n}\n')
    s = s[:i+8] + src.rstrip('\n') + '\n' + old[end:] + s[j:]
    open(p, 'w').write(s)
hashes = set()
for p in glob.glob('public/**/*.html', recursive=True):
    for m in re.finditer(r'<script>([\s\S]*?)</script>', open(p).read()):
        hashes.add("'sha256-" + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode() + "'")
vj = json.load(open('vercel.json'))
for rule in vj['headers']:
    for h in rule['headers']:
        if h['key'] == 'Content-Security-Policy':
            h['value'] = re.sub(r"script-src 'self'( 'sha256-[^']+')*", "script-src 'self' " + " ".join(sorted(hashes)), h['value'])
json.dump(vj, open('vercel.json', 'w'), indent=2)
print('hashes', len(hashes))
