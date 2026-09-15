// Cloud receipts/settings stay in memory.
// localStorage is never modified by cloud sync.

function receiptFields(data) {
  const clean = {};

  for (const key of [
    'id',
    'date',
    'amount',
    'item',
    'store',
    'category',
    'memo',
    'createdAt',
    'updatedAt',
  ]) {
    if (data[key] !== undefined) {
      clean[key] = data[key];
    }
  }

  return clean;
}

function generalSettings(data) {
  const general = {};

  for (const key of [
    'budgetName',
    'schoolName',
    'teacherName',
    'className',
  ]) {
    if (typeof data[key] !== 'string') {
      throw new Error('invalid-settings');
    }

    general[key] = data[key];
  }

  if (!Number.isFinite(data.totalBudget)) {
    throw new Error('invalid-budget');
  }

  general.totalBudget = data.totalBudget;

  return general;
}

export async function writeCloudReceipt({
  sdk,
  db,
  uid,
  operation,
  id,
  input,
  expected,
  assertCurrent,
}) {
  assertCurrent();

  if (
    !['create', 'update', 'delete'].includes(operation) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(id)
  ) {
    throw new Error('invalid-operation');
  }

  const ref = sdk.doc(
    db,
    'users',
    uid,
    'receipts',
    id
  );

  let saved = null;

  await sdk.runTransaction(
    db,
    async transaction => {
      assertCurrent();

      const existing =
        await transaction.get(ref);

      assertCurrent();

      if (operation === 'create') {
        if (existing.exists()) {
          throw new Error('already-exists');
        }
      } else {
        if (
          !existing.exists() ||
          !expected ||
          JSON.stringify(
            receiptFields(existing.data())
          ) !==
            JSON.stringify(
              receiptFields(expected)
            )
        ) {
          throw new Error('conflict');
        }
      }

      if (operation === 'delete') {
        transaction.delete(ref);
        return;
      }

      const now =
        new Date().toISOString();

      saved = receiptFields({
        ...input,
        id,
        createdAt:
          operation === 'create'
            ? now
            : expected.createdAt,
        updatedAt: now,
      });

      const limits = {
        date: 32,
        item: 1000,
        store: 1000,
        category: 100,
        memo: 10000,
      };

      for (const [key, max] of Object.entries(limits)) {
        if (
          typeof saved[key] !== 'string' ||
          saved[key].length > max
        ) {
          throw new Error('invalid-field');
        }
      }

      if (!Number.isFinite(saved.amount)) {
        throw new Error('invalid-amount');
      }

      transaction.set(ref, saved);
    }
  );

  return saved;
}

export function selectCloudData(
  receiptDocs,
  settings
) {
  const general =
    generalSettings(settings);

  const receipts =
    receiptDocs.map(document => {
      const source =
        document.data();

      const receipt = {
        id: document.id,
      };

      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(
          receipt.id
        ) ||
        !Number.isFinite(source.amount)
      ) {
        throw new Error('invalid-receipt');
      }

      receipt.amount = source.amount;

      for (const key of [
        'date',
        'item',
        'store',
        'category',
        'memo',
      ]) {
        if (typeof source[key] !== 'string') {
          throw new Error('invalid-receipt');
        }

        receipt[key] = source[key];
      }

      for (const key of [
        'createdAt',
        'updatedAt',
      ]) {
        if (typeof source[key] === 'string') {
          receipt[key] = source[key];
        }
      }

      return receipt;
    });

  receipts.sort(
    (a, b) =>
      (b.createdAt || b.date).localeCompare(
        a.createdAt || a.date
      ) ||
      a.id.localeCompare(b.id)
  );

  return {
    receipts,
    general,
  };
}

export function attachCloudReader({
  app,
  auth,
}) {
  const status =
    document.getElementById(
      'data-source-status'
    );

  const localButton =
    document.getElementById(
      'data-source-local'
    );

  const cloudButton =
    document.getElementById(
      'data-source-cloud'
    );

  let generation = 0;

  let unsubscribeReceipts = null;
  let unsubscribeSettings = null;

  // 수정/설정 입력 중 들어온 서버 최신값은
  // 사용자가 화면을 벗어날 때 반영한다.
  let pendingReceipts = null;
  let pendingGeneral = null;

  let activeData = null;
  let activeWriter = null;
  let activeSettingsWriter = null;

  const route = () =>
    window.location.hash || '#/';

  const isEditRoute = () =>
    route().startsWith('#/edit/');

  const isAddRoute = () =>
    route().startsWith('#/add');

  const isSettingsRoute = () =>
    route().startsWith('#/settings');

  const isInputRoute = () =>
    isEditRoute() ||
    isAddRoute() ||
    isSettingsRoute();

  const refresh = () =>
    App.navigate(
      window.location.hash || '#/'
    );

  function setCloudMemory() {
    if (!activeData) return;

    Storage.setCloudView(
      activeData,
      activeWriter,
      activeSettingsWriter
    );
  }

  function stopCloudListeners() {
    if (unsubscribeReceipts) {
      unsubscribeReceipts();
      unsubscribeReceipts = null;
    }

    if (unsubscribeSettings) {
      unsubscribeSettings();
      unsubscribeSettings = null;
    }

    pendingReceipts = null;
    pendingGeneral = null;

    activeData = null;
    activeWriter = null;
    activeSettingsWriter = null;
  }

  function local(message) {
    stopCloudListeners();

    Storage.setCloudView(null);

    status.textContent = message;

    refresh();
  }

  function applyPendingAfterRouteChange() {
    if (!activeData) return;

    let changed = false;

    // 편집 화면을 떠났다면 보류했던
    // 최신 영수증 목록을 반영한다.
    if (
      pendingReceipts &&
      !isEditRoute()
    ) {
      activeData.receipts =
        pendingReceipts;

      pendingReceipts = null;
      changed = true;
    }

    // 설정 화면을 떠났다면 보류했던
    // 최신 설정을 반영한다.
    if (
      pendingGeneral &&
      !isSettingsRoute()
    ) {
      activeData.general =
        pendingGeneral;

      pendingGeneral = null;
      changed = true;
    }

    if (!changed) return;

    setCloudMemory();

    // hashchange 자체에서도 페이지 렌더가 일어나므로
    // 다음 tick에서 최신 메모리 기준으로 한 번 정리한다.
    if (!isInputRoute()) {
      setTimeout(() => {
        if (
          activeData &&
          Storage.isCloudView()
        ) {
          refresh();
        }
      }, 0);
    }
  }

  window.addEventListener(
    'hashchange',
    applyPendingAfterRouteChange
  );

  async function read(user) {
    const ticket =
      ++generation;

    stopCloudListeners();

    cloudButton.hidden = !user;

    cloudButton.disabled =
      Boolean(user);

    Storage.setCloudView(null);

    status.textContent =
      user
        ? '이 기기 로컬 자료 표시 중 · 클라우드 완료 기록을 확인하고 있습니다.'
        : '이 기기 로컬 자료 · 로그인하지 않은 상태입니다.';

    refresh();

    if (!user) {
      return;
    }

    const current = () =>
      ticket === generation &&
      auth.currentUser?.uid ===
        user.uid;

    try {
      const sdk = await import(
        'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'
      );

      if (!current()) return;

      const db =
        sdk.getFirestore(app);

      const marker =
        await sdk.getDocFromServer(
          sdk.doc(
            db,
            'users',
            user.uid,
            'migrations',
            'initial-local'
          )
        );

      if (!current()) return;

      if (
        !marker.exists() ||
        marker.data().status !== 'complete'
      ) {
        status.textContent =
          '이 기기 로컬 자료 · 이 계정에는 최초 이전 완료 기록이 없습니다.';

        return;
      }

      const settingsRef =
        sdk.doc(
          db,
          'users',
          user.uid,
          'settings',
          'general'
        );

      const settings =
        await sdk.getDocFromServer(
          settingsRef
        );

      if (!current()) return;

      if (!settings.exists()) {
        throw new Error(
          'missing-settings'
        );
      }

      let data =
        selectCloudData(
          [],
          settings.data()
        );

      activeData = data;

      let writing = false;
      let settingsWriting = false;

      let initialSnapshotLoaded =
        false;

      const describe = message => {
        const suffix =
          message
            ? ` · ${message}`
            : '';

        status.textContent =
          `${
            user.email ||
            user.displayName ||
            '현재 계정'
          } · ` +
          `클라우드 영수증 ${data.receipts.length}건 · ` +
          `실시간 동기화 중 · 영수증 등록/수정/삭제 가능 · ` +
          `일반 설정도 실시간 동기화 중. ` +
          `첨부와 API Key는 저장하지 않습니다.` +
          suffix;
      };

      const writer = async (
        operation,
        receiptId,
        input
      ) => {
        if (writing) {
          throw new Error('busy');
        }

        const assertCurrent = () => {
          if (
            !current() ||
            !Storage.isCloudView()
          ) {
            throw new Error(
              'account-changed'
            );
          }
        };

        assertCurrent();

        const id =
          operation === 'create'
            ? crypto.randomUUID()
            : receiptId;

        // 수정 화면에서 snapshot이 들어와도
        // data.receipts는 편집 시작 당시 값을 보존하므로
        // 이 expected가 실제 충돌 기준점이 된다.
        const expected =
          data.receipts.find(
            receipt =>
              receipt.id === id
          );

        writing = true;

        try {
          const saved =
            await writeCloudReceipt({
              sdk,
              db,
              uid: user.uid,
              operation,
              id,
              input,
              expected,
              assertCurrent,
            });

          if (
            !current() ||
            !Storage.isCloudView()
          ) {
            return null;
          }

          // 성공한 내 쓰기 이후에는
          // 이전에 대기 중이던 snapshot은 곧
          // 최신 snapshot으로 다시 오므로 폐기한다.
          pendingReceipts = null;

          data.receipts =
            data.receipts.filter(
              receipt =>
                receipt.id !== id
            );

          if (saved) {
            data.receipts.push(saved);
          }

          data.receipts.sort(
            (a, b) =>
              (
                b.createdAt ||
                b.date
              ).localeCompare(
                a.createdAt ||
                  a.date
              ) ||
              a.id.localeCompare(
                b.id
              )
          );

          activeData = data;

          setCloudMemory();

          describe();

          return saved || true;
        } finally {
          writing = false;
        }
      };

      const settingsWriter =
        async input => {
          if (settingsWriting) {
            throw new Error('busy');
          }

          const assertCurrent = () => {
            if (
              !current() ||
              !Storage.isCloudView()
            ) {
              throw new Error(
                'account-changed'
              );
            }
          };

          assertCurrent();

          const clean =
            generalSettings(input);

          settingsWriting = true;

          try {
            await sdk.runTransaction(
              db,
              async transaction => {
                assertCurrent();

                const existing =
                  await transaction.get(
                    settingsRef
                  );

                if (!existing.exists()) {
                  throw new Error(
                    'missing-settings'
                  );
                }

                const currentGeneral =
                  generalSettings(
                    existing.data()
                  );

                // 설정 화면을 열어둔 동안
                // snapshot으로 data.general을 바꾸지 않으므로
                // 다른 기기 변경은 여기서 conflict가 된다.
                if (
                  JSON.stringify(
                    currentGeneral
                  ) !==
                  JSON.stringify(
                    data.general
                  )
                ) {
                  throw new Error(
                    'conflict'
                  );
                }

                transaction.update(
                  settingsRef,
                  clean
                );
              }
            );

            if (
              !current() ||
              !Storage.isCloudView()
            ) {
              return null;
            }

            pendingGeneral = null;

            data.general = clean;
            activeData = data;

            setCloudMemory();

            describe();

            return clean;
          } finally {
            settingsWriting = false;
          }
        };

      activeWriter = writer;
      activeSettingsWriter =
        settingsWriter;

      const receiptsRef =
        sdk.collection(
          db,
          'users',
          user.uid,
          'receipts'
        );

      unsubscribeReceipts =
        sdk.onSnapshot(
          receiptsRef,

          snapshot => {
            if (!current()) return;

            try {
              const next =
                selectCloudData(
                  snapshot.docs,
                  data.general
                );

              const previousReceipts =
                JSON.stringify(
                  data.receipts
                );

              const nextReceipts =
                JSON.stringify(
                  next.receipts
                );

              const changed =
                !initialSnapshotLoaded ||
                previousReceipts !==
                  nextReceipts;

              initialSnapshotLoaded =
                true;

              // 수정 화면에서는 기존 data.receipts를
              // 절대로 최신 snapshot으로 덮지 않는다.
              // 그래야 사용자가 저장할 때 서버 변경을
              // conflict로 정확히 감지할 수 있다.
              if (isEditRoute()) {
                pendingReceipts =
                  next.receipts;

                describe(
                  '다른 기기의 변경이 감지되었습니다. 현재 수정 중인 내용은 유지됩니다.'
                );

                return;
              }

              data.receipts =
                next.receipts;

              activeData = data;

              setCloudMemory();

              describe();

              // 등록/설정 화면에서는 메모리만 최신화하고
              // 입력 폼은 다시 그리지 않는다.
              if (
                changed &&
                !isInputRoute()
              ) {
                refresh();
              }
            } catch {
              status.textContent =
                '클라우드 실시간 자료를 처리하지 못했습니다. 현재 화면 자료는 유지됩니다.';
            }
          },

          () => {
            if (!current()) return;

            if (
              initialSnapshotLoaded
            ) {
              status.textContent =
                '클라우드 영수증 실시간 연결이 끊어졌습니다. 현재 표시된 자료는 유지됩니다.';
            } else {
              status.textContent =
                '클라우드 자료를 불러오지 못했습니다. 이 기기 로컬 자료를 사용할 수 있습니다.';
            }
          }
        );

      unsubscribeSettings =
        sdk.onSnapshot(
          settingsRef,

          snapshot => {
            if (!current()) return;

            if (!snapshot.exists()) {
              status.textContent =
                '클라우드 일반 설정을 찾을 수 없습니다.';

              return;
            }

            try {
              const nextGeneral =
                generalSettings(
                  snapshot.data()
                );

              const changed =
                JSON.stringify(
                  data.general
                ) !==
                JSON.stringify(
                  nextGeneral
                );

              if (!changed) {
                pendingGeneral = null;
                describe();
                return;
              }

              // 설정 입력 중에는 서버 최신값으로
              // 현재 입력 화면/충돌 기준을 덮지 않는다.
              if (isSettingsRoute()) {
                pendingGeneral =
                  nextGeneral;

                describe(
                  '다른 기기의 설정 변경이 감지되었습니다. 현재 입력 중인 내용은 유지됩니다.'
                );

                return;
              }

              data.general =
                nextGeneral;

              activeData = data;

              setCloudMemory();

              describe();

              if (!isInputRoute()) {
                refresh();
              }
            } catch {
              status.textContent =
                '클라우드 설정 자료를 처리하지 못했습니다. 현재 화면 자료는 유지됩니다.';
            }
          },

          () => {
            if (!current()) return;

            status.textContent =
              '클라우드 설정 실시간 연결이 끊어졌습니다. 현재 표시된 자료는 유지됩니다.';
          }
        );

      activeData = data;
      activeWriter = writer;
      activeSettingsWriter =
        settingsWriter;

      setCloudMemory();
    } catch {
      if (current()) {
        local(
          '클라우드 자료를 불러오지 못해 이 기기 로컬 자료를 표시합니다. 연결 상태를 확인하고 ‘클라우드 자료 읽기’를 다시 눌러주세요.'
        );
      }
    } finally {
      if (
        ticket === generation
      ) {
        cloudButton.disabled =
          false;
      }
    }
  }

  localButton.addEventListener(
    'click',
    () => {
      generation++;

      stopCloudListeners();

      cloudButton.disabled =
        false;

      Storage.setCloudView(null);

      status.textContent =
        '이 기기 로컬 자료 · 등록/수정/OCR/백업·복원은 기존처럼 동작합니다. 로컬 변경은 클라우드에 반영되지 않습니다.';

      refresh();
    }
  );

  cloudButton.addEventListener(
    'click',
    () => {
      void read(
        auth.currentUser
      );
    }
  );

  return read;
}