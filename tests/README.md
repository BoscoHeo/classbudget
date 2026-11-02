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
```

The browser test uses a fresh temporary browser context, intercepts all network
requests, and fulfills the synthetic page and Gemini response in memory. It first
proves that a harmless event marker can execute, then checks that application
output leaves the same marker inert. No production storage or account is used.

The DOM suite verifies restoration rollback on a simulated storage quota failure,
schema rejection without mutation, legacy roundtrips, UI actions, CSV quoting and
formula defenses, real SheetJS XLSX write/read, and the HTML XLS fallback.
It does not automate Microsoft Excel, K-Edufine, Firebase sign-in or live Firestore.
