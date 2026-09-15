// Explicit, one-time copy only. Never write to legacy localStorage.
const KEYS = ['classbudget_receipts', 'classbudget_settings'];
const DEFAULTS = { budgetName: '2026학년도 1학기 학급운영비', totalBudget: 500000, schoolName: '', teacherName: '', className: '' };
export const MAX_RECEIPTS = 450;
function fail(message) { throw new Error(message); }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function text(value, max) { return typeof value === 'string' && value.length <= max; }

export function readLocalSnapshot(storage) {
  const raw = KEYS.map(key => storage.getItem(key));
  if (raw.every(value => value === null)) fail('이 기기에 이전할 로컬 자료가 없습니다.');
  let receipts, settings;
  try {
    receipts = raw[0] === null ? [] : JSON.parse(raw[0]);
    settings = raw[1] === null ? {} : JSON.parse(raw[1]);
  } catch { fail('로컬 자료를 읽을 수 없습니다. JSON 백업을 확인해주세요. 원본은 변경하지 않았습니다.'); }
  if (!Array.isArray(receipts) || !record(settings)) fail('로컬 자료 형식이 올바르지 않습니다. 원본은 변경하지 않았습니다.');
  if (receipts.length > MAX_RECEIPTS) fail('안전한 일괄 이전은 최대 450건까지 지원합니다. 원본을 보존한 상태로 대량 이전 지원이 필요합니다.');
  const ids = new Set();
  const safeReceipts = receipts.map(receipt => {
    if (!record(receipt) || !text(receipt.id, 128) || !/^[A-Za-z0-9_-]+$/.test(receipt.id) || ids.has(receipt.id)) fail('영수증 ID가 없거나 중복/지원하지 않는 형식입니다. 이전을 중단했습니다.');
    ids.add(receipt.id);
    const limits = { date: 32, item: 1000, store: 1000, category: 100, memo: 10000 };
    const safe = { id: receipt.id, amount: receipt.amount };
    if (typeof safe.amount !== 'number' || !Number.isFinite(safe.amount)) fail('영수증 금액 형식을 확인해주세요.');
    for (const [key, max] of Object.entries(limits)) {
      if (!text(receipt[key], max)) fail('영수증 텍스트 형식 또는 길이를 확인해주세요.');
      safe[key] = receipt[key];
    }
    for (const key of ['createdAt', 'updatedAt']) {
      if (receipt[key] !== undefined) {
        if (!text(receipt[key], 64)) fail('영수증 날짜 형식을 확인해주세요.');
        safe[key] = receipt[key];
      }
    }
    return safe; // imageData, imageName, PDFs and unknown fields excluded.
  });
  const general = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = settings[key] === undefined ? fallback : settings[key];
    if (key === 'totalBudget' ? typeof value !== 'number' || !Number.isFinite(value) : !text(value, 1000)) fail('일반 설정 형식 또는 길이를 확인해주세요.');
    general[key] = value; // Gemini key is never included.
  }
  return { raw, receipts: safeReceipts, general };
}

export async function migrateLocalSnapshot({ sdk, db, auth, storage, snapshot, uid }) {
  const check = () => {
    if (!uid || auth.currentUser?.uid !== uid) fail('로그인 계정이 변경되었습니다. 다시 확인해주세요.');
    if (KEYS.some((key, index) => storage.getItem(key) !== snapshot.raw[index])) fail('확인 후 로컬 자료가 변경되었습니다. 건수를 다시 확인해주세요.');
  };
  check();
  const base = ['users', uid];
  // Server-only read: offline/cache must never be mistaken for an empty account.
  const existing = await sdk.getDocsFromServer(sdk.query(sdk.collection(db, ...base, 'receipts'), sdk.limit(1)));
  if (!existing.empty) fail('이 계정에 서버 영수증이 이미 있습니다. 덮어쓰지 않고 이전을 중단했습니다.');
  const marker = sdk.doc(db, ...base, 'migrations', 'initial-local');
  const general = sdk.doc(db, ...base, 'settings', 'general');
  const refs = snapshot.receipts.map(receipt => sdk.doc(db, ...base, 'receipts', receipt.id));
  await sdk.runTransaction(db, async transaction => {
    check();
    const documents = await Promise.all([marker, general, ...refs].map(ref => transaction.get(ref)));
    if (documents.some(document => document.exists())) fail('이전 기록이나 서버 자료가 이미 있습니다. 중복 저장/덮어쓰기 없이 중단했습니다.');
    check();
    transaction.set(marker, { status: 'complete', receiptCount: refs.length, createdAt: sdk.serverTimestamp() });
    transaction.set(general, snapshot.general);
    refs.forEach((ref, index) => transaction.set(ref, snapshot.receipts[index]));
  });
}

export function attachMigration({ app, auth }) {
  const button = document.getElementById('account-migrate');
  const panel = document.getElementById('migration-confirmation');
  const summary = document.getElementById('migration-summary');
  const status = document.getElementById('migration-status');
  const confirm = document.getElementById('migration-confirm');
  const cancel = document.getElementById('migration-cancel');
  let pending = null;
  let busy = false;
  function render(user) {
    button.hidden = !user;
    button.disabled = busy;
    confirm.disabled = busy;
    cancel.disabled = busy;
    if (!busy) { pending = null; panel.hidden = true; status.textContent = ''; }
  }
  button.addEventListener('click', async () => {
    if (busy || !auth.currentUser) return;
    const user = auth.currentUser;
    pending = null;
    panel.hidden = true;
    busy = true;
    button.disabled = confirm.disabled = cancel.disabled = true;
    status.textContent = '이 계정의 최초 이전 완료 여부를 확인하고 있습니다.';
    try {
      const sdk = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
      const marker = await sdk.getDocFromServer(sdk.doc(sdk.getFirestore(app), 'users', user.uid, 'migrations', 'initial-local'));
      if (auth.currentUser?.uid !== user.uid) throw new Error('로그인 계정이 변경되었습니다. 다시 확인해주세요.');
      if (marker.exists() && marker.data().status === 'complete') {
        status.textContent = '이 계정은 이미 최초 이전이 완료되었습니다.';
        return;
      }
      pending = { uid: user.uid, snapshot: readLocalSnapshot(localStorage) };
      summary.textContent = `${user.email || user.displayName || '현재 Google 계정'} 계정으로 로컬 영수증 ${pending.snapshot.receipts.length}건과 일반 설정을 최초 이전합니다.`;
      panel.hidden = false;
      status.textContent = '';
    } catch (error) {
      status.textContent = error.code ? '최초 이전 완료 여부를 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.' : error.message;
    } finally {
      busy = false;
      button.hidden = !auth.currentUser;
      button.disabled = confirm.disabled = cancel.disabled = false;
      if (!panel.hidden) confirm.focus();
    }
  });
  cancel.addEventListener('click', () => { if (!busy) { pending = null; panel.hidden = true; } });
  confirm.addEventListener('click', async () => {
    if (busy || !pending) return;
    const request = pending;
    busy = true;
    button.disabled = confirm.disabled = cancel.disabled = true;
    status.textContent = '서버의 기존 자료를 확인하고 최초 이전 중입니다. 창을 닫지 마세요.';
    try {
      const sdk = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
      await migrateLocalSnapshot({ sdk, db: sdk.getFirestore(app), auth, storage: localStorage, ...request });
      status.textContent = '확인한 계정으로 최초 이전이 완료되었습니다. 로컬 원본은 그대로입니다. 이후 수정은 자동 동기화되지 않습니다.';
    } catch (error) {
      status.textContent = error.code ? '이전을 확인하지 못했습니다. 네트워크와 Firestore Rules를 확인해주세요. 로컬 원본은 그대로이며, 재시도 시 서버 자료가 있으면 중단합니다.' : error.message;
    } finally {
      busy = false;
      pending = null;
      panel.hidden = true;
      button.hidden = !auth.currentUser;
      button.disabled = confirm.disabled = cancel.disabled = false;
    }
  });
  return render;
}
