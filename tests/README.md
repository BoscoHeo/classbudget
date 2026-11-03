# SEC-2 regression tests

Synthetic data only. The suite never loads the Firebase module or contacts Gemini.
SheetJS 0.18.5 matches the production CDN version; these are test dependencies only.

From the repository root in PowerShell:

```powershell
npm install --prefix "$env:TEMP/classbudget-sec2-tests" --no-audit --no-fund jsdom@30.1.3 xlsx@0.18.5 playwright-core@1.64.1
$env:NODE_PATH = "$env:TEMP/classbudget-sec2-tests/node_modules"
node --test tests/sec2.test.cjs
# Chrome must be installed; set CHROME_PATH if it is elsewhere.
node tests/sec2-browser.cjs
node --test tests/sec3b.test.cjs
node tests/sec3b-browser.cjs
node tests/sec4a-browser.cjs
# Java 21+ and the cached Firestore Emulator JAR are required.
# Set FIRESTORE_EMULATOR_JAR if it is not under ~/.cache/firebase/emulators/.
node tests/sec3b-rules.cjs
```

The browser test uses a fresh temporary browser context, intercepts all network
requests, and fulfills the synthetic page and Gemini response in memory. It first
proves that a harmless event marker can execute, then checks that application
output leaves the same marker inert. No production storage or account is used.

The DOM suite verifies restoration rollback on a simulated storage quota failure,
schema rejection without mutation, legacy roundtrips, UI actions, CSV quoting and
formula defenses, real SheetJS XLSX write/read, and the HTML XLS fallback.
It does not automate Microsoft Excel, K-Edufine, Firebase sign-in or live Firestore.

SEC-3B uses the real application authentication/migration/cloud-reader modules
with synthetic SDK modules to test login/logout, not actual Google accounts.
Its Rules test starts only a `demo-` project on localhost and loads the separate
candidate. It never reads credentials or writes to a production database.

SEC-4A additionally verifies AI execution ownership, duplicate clicks (including
an accidentally enabled button), cancellation/file-replacement races, explicit
consent, error retry, logout and direct account switching with delayed responses.
