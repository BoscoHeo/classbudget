// Cloud receipts stay in memory. Settings remain read-only; no localStorage writes.
function receiptFields(data) {
  const clean = {};
  for (const key of ['id', 'date', 'amount', 'item', 'store', 'category', 'memo', 'createdAt', 'updatedAt']) {
    if (data[key] !== undefined) clean[key] = data[key];
  }
  return clean;
}

export async function writeCloudReceipt({ sdk, db, uid, operation, id, input, expected, assertCurrent }) {
  assertCurrent();
  if (!['create', 'update', 'delete'].includes(operation) || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('invalid-operation');
  const ref = sdk.doc(db, 'users', uid, 'receipts', id);
  let saved = null;
  await sdk.runTransaction(db, async transaction => {
    assertCurrent();
    const existing = await transaction.get(ref);
    assertCurrent();
    if (operation === 'create') {
      if (existing.exists()) throw new Error('already-exists');
    } else {
      if (!existing.exists() || !expected || JSON.stringify(receiptFields(existing.data())) !== JSON.stringify(receiptFields(expected))) throw new Error('conflict');
    }
    if (operation === 'delete') { transaction.delete(ref); return; }
    const now = new Date().toISOString();
    saved = receiptFields({ ...input, id, createdAt: operation === 'create' ? now : expected.createdAt, updatedAt: now });
    const limits = { date: 32, item: 1000, store: 1000, category: 100, memo: 10000 };
    for (const [key, max] of Object.entries(limits)) {
      if (typeof saved[key] !== 'string' || saved[key].length > max) throw new Error('invalid-field');
    }
    if (!Number.isFinite(saved.amount)) throw new Error('invalid-amount');
    transaction.set(ref, saved);
  });
  return saved;
}

export function selectCloudData(receiptDocs, settings) {
  const general = {};
  for (const key of ['budgetName', 'schoolName', 'teacherName', 'className']) {
    if (typeof settings[key] !== 'string') throw new Error('invalid-settings');
    general[key] = settings[key];
  }
  if (!Number.isFinite(settings.totalBudget)) throw new Error('invalid-budget');
  general.totalBudget = settings.totalBudget;
  const receipts = receiptDocs.map(document => {
    const data = document.data();
    const receipt = { id: document.id };
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(receipt.id) || !Number.isFinite(data.amount)) throw new Error('invalid-receipt');
    receipt.amount = data.amount;
    for (const key of ['date', 'item', 'store', 'category', 'memo']) {
      if (typeof data[key] !== 'string') throw new Error('invalid-receipt');
      receipt[key] = data[key];
    }
    for (const key of ['createdAt', 'updatedAt']) if (typeof data[key] === 'string') receipt[key] = data[key];
    return receipt; // Explicit whitelist excludes API keys and all attachments.
  });
  receipts.sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date) || a.id.localeCompare(b.id));
  return { receipts, general };
}

export function attachCloudReader({ app, auth }) {
  const status = document.getElementById('data-source-status');
  const localButton = document.getElementById('data-source-local');
  const cloudButton = document.getElementById('data-source-cloud');
  let generation = 0;
  const refresh = () => App.navigate(window.location.hash || '#/');
  function local(message) {
    Storage.setCloudView(null);
    status.textContent = message;
    refresh();
  }
  async function read(user) {
    const ticket = ++generation;
    cloudButton.hidden = !user;
    cloudButton.disabled = Boolean(user);
    local(user ? '이 기기 로컬 자료 표시 중 · 클라우드 완료 기록을 확인하고 있습니다.' : '이 기기 로컬 자료 · 로그인하지 않은 상태입니다.');
    if (!user) return;
    const current = () => ticket === generation && auth.currentUser?.uid === user.uid;
    try {
      const sdk = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js');
      if (!current()) return;
      const db = sdk.getFirestore(app);
      const marker = await sdk.getDocFromServer(sdk.doc(db, 'users', user.uid, 'migrations', 'initial-local'));
      if (!current()) return;
      if (!marker.exists() || marker.data().status !== 'complete') {
        status.textContent = '이 기기 로컬 자료 · 이 계정에는 최초 이전 완료 기록이 없습니다.';
        return;
      }
      const [receipts, settings] = await Promise.all([
        sdk.getDocsFromServer(sdk.collection(db, 'users', user.uid, 'receipts')),
        sdk.getDocFromServer(sdk.doc(db, 'users', user.uid, 'settings', 'general')),
      ]);
      if (!current()) return;
      if (!settings.exists()) throw new Error('missing-settings');
      const data = selectCloudData(receipts.docs, settings.data());
      let writing = false;
      const describe = () => {
        status.textContent = `${user.email || user.displayName || '현재 계정'} · 클라우드 영수증 ${data.receipts.length}건 · 영수증 등록/수정/삭제 가능, 설정은 읽기 전용. 첨부와 API Key는 저장하지 않습니다.`;
      };
      const writer = async (operation, receiptId, input) => {
        if (writing) throw new Error('busy');
        const assertCurrent = () => { if (!current() || !Storage.isCloudView()) throw new Error('account-changed'); };
        assertCurrent();
        const id = operation === 'create' ? crypto.randomUUID() : receiptId;
        const expected = data.receipts.find(receipt => receipt.id === id);
        writing = true;
        try {
          const saved = await writeCloudReceipt({ sdk, db, uid: user.uid, operation, id, input, expected, assertCurrent });
          // Never apply an old account's response to the newly selected view.
          if (!current() || !Storage.isCloudView()) return null;
          data.receipts = data.receipts.filter(receipt => receipt.id !== id);
          if (saved) data.receipts.unshift(saved);
          Storage.setCloudView(data, writer);
          describe();
          return saved || true;
        } finally { writing = false; }
      };
      Storage.setCloudView(data, writer);
      describe();
      refresh();
    } catch {
      if (current()) local('클라우드 자료를 불러오지 못해 이 기기 로컬 자료를 표시합니다. 연결 상태를 확인하고 ‘클라우드 자료 읽기’를 다시 눌러주세요.');
    } finally {
      if (ticket === generation) cloudButton.disabled = false;
    }
  }
  localButton.addEventListener('click', () => {
    generation++;
    cloudButton.disabled = false;
    local('이 기기 로컬 자료 · 등록/수정/OCR/백업·복원은 기존처럼 동작합니다. 로컬 변경은 클라우드에 반영되지 않습니다.');
  });
  cloudButton.addEventListener('click', () => { void read(auth.currentUser); });
  return read;
}
