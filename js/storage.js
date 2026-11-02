/**
 * storage.js - LocalStorage CRUD wrapper for ClassBudget
 * Manages receipts and settings data with JSON import/export
 */

const Storage = (() => {
  let activeUid = null;
  let memoryKey = '';
  let generation = 0;
  let localLocked = localStorage.getItem('classbudget_local_locked') === '1';
  const keyFlag = () => 'classbudget_key_remember:' + (activeUid || 'local');
  const scopeKey = name => activeUid ? 'classbudget_user:' + encodeURIComponent(activeUid) + ':' + name : 'classbudget_' + name;
  function isLocked() { return !activeUid && localLocked; }
  function switchAccount(uid) {
    const next = uid || null;
    if (activeUid === next) return;
    try {
      if (activeUid) clearAccount(activeUid);
      // Clear the legacy/device key too, without deleting local-only receipts.
      const legacy = localStorage.getItem('classbudget_settings');
      if (legacy) {
        const settings = JSON.parse(legacy); delete settings.geminiApiKey;
        localStorage.setItem('classbudget_settings', JSON.stringify(settings));
      }
      localStorage.removeItem('classbudget_key_remember:local');
      localStorage.setItem('classbudget_local_locked', '1');
    } finally {
      memoryKey = ''; generation++; activeUid = next; localLocked = true;
      KEYS.RECEIPTS = scopeKey('receipts'); KEYS.SETTINGS = scopeKey('settings');
      setCloudView(null);
    }
  }
  function clearAccount(uid) {
    const prefix = 'classbudget_user:' + encodeURIComponent(uid) + ':';
    const attachments = 'classbudget_cloud_attachment:' + encodeURIComponent(uid) + ':';
    const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix) || k.startsWith(attachments) || k === 'classbudget_key_remember:' + uid);
    keys.forEach(k => localStorage.removeItem(k));
  }
  function resumeLocalOnly() {
    if (activeUid) throw new Error('로그인 중에는 로컬 전용 자료를 열 수 없습니다.');
    localLocked = false; localStorage.removeItem('classbudget_local_locked'); generation++;
  }
  function migrationStorage() {
    const uid = activeUid, ticket = generation;
    return { getItem(key) {
      if (uid !== activeUid || ticket !== generation || isLocked()) throw new Error('계정이 변경되었습니다.');
      if (key === 'classbudget_receipts') return localStorage.getItem(KEYS.RECEIPTS);
      if (key === 'classbudget_settings') return localStorage.getItem(KEYS.SETTINGS);
      return null;
    }};
  }
  window.addEventListener('storage', event => {
    if (event.key === 'classbudget_local_locked' && event.newValue === '1' && !activeUid) {
      localLocked = true; memoryKey = ''; generation++;
      if (typeof Pages !== 'undefined') Pages.resetSensitiveState(true);
      if (typeof App !== 'undefined') App.navigate(window.location.hash);
    }
  });
  // Device-local attachments only. These helpers do not call cloud CRUD.
  function cloudAttachmentKey(uid, receiptId) {
    if (typeof uid !== 'string' || !uid.trim() ||
        typeof receiptId !== 'string' || !receiptId.trim()) {
      throw new Error('UID와 receiptId가 필요합니다.');
    }
    return 'classbudget_cloud_attachment:' +
      encodeURIComponent(uid) + ':' + encodeURIComponent(receiptId);
  }

  function saveCloudAttachment(uid, receiptId, attachment) {
    if (uid !== activeUid) throw new Error('현재 계정의 첨부만 저장할 수 있습니다.');
    const key = cloudAttachmentKey(uid, receiptId);
    if (!attachment || typeof attachment.imageData !== 'string' ||
        typeof attachment.imageName !== 'string') {
      throw new Error('첨부 데이터 형식이 올바르지 않습니다.');
    }
    // Keep an explicit allowlist; propagate quota/access errors to the caller.
    localStorage.setItem(key, JSON.stringify({
      imageData: attachment.imageData,
      imageName: attachment.imageName,
    }));
  }

  function getCloudAttachment(uid, receiptId) {
    if (uid !== activeUid) return null;
    const raw = localStorage.getItem(cloudAttachmentKey(uid, receiptId));
    if (raw === null) return null;
    try {
      const attachment = JSON.parse(raw);
      if (!attachment || typeof attachment.imageData !== 'string' ||
          typeof attachment.imageName !== 'string') return null;
      return {
        imageData: attachment.imageData,
        imageName: attachment.imageName,
      };
    } catch {
      return null;
    }
  }

  function deleteCloudAttachment(uid, receiptId) {
    if (uid !== activeUid) throw new Error('계정이 변경되었습니다.');
    localStorage.removeItem(cloudAttachmentKey(uid, receiptId));
  }

  let cloudView = null;
  let cloudWriter = null;
  let cloudSettingsWriter = null;

  function setCloudView(data, writer = null, settingsWriter = null) {
    cloudView = data ? structuredClone(data) : null;
    cloudWriter = data ? writer : null;
    cloudSettingsWriter = data ? settingsWriter : null;
  }

  function writeCloud(operation, id, data) {
    if (!cloudWriter) {
      throw new Error('클라우드 연결을 다시 확인해주세요.');
    }
    return cloudWriter(operation, id, data);
  }

  function isCloudView() {
    return cloudView !== null;
  }

  function requireLocal() {
    if (isLocked()) throw new Error('로컬 전용 자료 열기를 먼저 확인해주세요.');
    if (cloudView) {
      throw new Error(
        '현재 클라우드 자료를 사용 중입니다. 이 기기 로컬 자료로 전환해주세요.'
      );
    }
  }

  const KEYS = {
    RECEIPTS: 'classbudget_receipts',
    SETTINGS: 'classbudget_settings',
  };

  const DEFAULT_SETTINGS = {
    budgetName: '2026학년도 1학기 학급운영비',
    totalBudget: 500000,
    schoolName: '',
    teacherName: '',
    className: '',
    geminiApiKey: '',
  };

  const CATEGORIES = [
    { id: 'supplies', name: '학용품/문구류', icon: '✏️', color: 'blue' },
    { id: 'materials', name: '교육자료/인쇄', icon: '📚', color: 'purple' },
    { id: 'experience', name: '체험학습', icon: '🎨', color: 'green' },
    { id: 'equipment', name: '비품구입', icon: '🖥️', color: 'orange' },
    { id: 'cleaning', name: '청소/위생', icon: '🧹', color: 'blue' },
    { id: 'event', name: '학급행사', icon: '🎉', color: 'purple' },
    { id: 'food', name: '간식/음료', icon: '🍪', color: 'green' },
    { id: 'other', name: '기타', icon: '📦', color: 'gray' },
  ];

  // --- Receipts ---
  function getReceipts() {
    if (isLocked()) return [];
    if (cloudView) {
      return structuredClone(cloudView.receipts);
    }

    try {
      const data = localStorage.getItem(KEYS.RECEIPTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function saveReceipts(receipts) {
    requireLocal();
    localStorage.setItem(KEYS.RECEIPTS, JSON.stringify(receipts));
  }

  function addReceipt(receipt) {
    receipt = DataSafety.receipt(receipt, false);
    if (cloudView) {
      return writeCloud('create', null, receipt);
    }

    const receipts = getReceipts();

    receipt.id =
      Date.now().toString(36) +
      Math.random().toString(36).substr(2, 5);

    receipt.createdAt = new Date().toISOString();

    receipts.unshift(receipt);
    saveReceipts(receipts);

    return receipt;
  }

  function updateReceipt(id, updates) {
    updates = DataSafety.receipt(updates, false);
    if (cloudView) {
      return writeCloud('update', id, updates);
    }

    const receipts = getReceipts();
    const idx = receipts.findIndex(r => r.id === id);

    if (idx !== -1) {
      receipts[idx] = {
        ...receipts[idx],
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      saveReceipts(receipts);
      return receipts[idx];
    }

    return null;
  }

  function deleteReceipt(id) {
    if (cloudView) {
      return writeCloud('delete', id);
    }

    const receipts = getReceipts().filter(r => r.id !== id);
    saveReceipts(receipts);
  }

  function getReceiptById(id) {
    return getReceipts().find(r => r.id === id) || null;
  }

  // --- 기기 전용 로컬 Gemini API 키 관리 (클라우드로 절대 유출되지 않고 브라우저에만 보관) ---
  function getDeviceGeminiApiKey() {
    if (isLocked()) return '';
    if (memoryKey) return memoryKey;
    const raw = localStorage.getItem(KEYS.SETTINGS);
    const settings = raw ? JSON.parse(raw) : {};
    memoryKey = typeof settings.geminiApiKey === 'string' ? settings.geminiApiKey : '';
    if (memoryKey && localStorage.getItem(keyFlag()) !== '1') {
      // Migrate legacy persistent keys to this tab's memory, preserving all other data.
      delete settings.geminiApiKey;
      localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
    }
    return memoryKey;
  }
  function isKeyRemembered() { return localStorage.getItem(keyFlag()) === '1'; }
  function saveDeviceGeminiApiKey(key, remember = isKeyRemembered()) {
    if (isLocked()) throw new Error('로컬 자료가 잠겨 있습니다.');
    const raw = localStorage.getItem(KEYS.SETTINGS);
    const settings = raw ? JSON.parse(raw) : {};
    delete settings.geminiApiKey;
    if (remember && key) settings.geminiApiKey = String(key).trim();
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
    if (remember && key) localStorage.setItem(keyFlag(), '1');
    else localStorage.removeItem(keyFlag());
    memoryKey = typeof key === 'string' ? key.trim() : '';
  }

  // --- Settings ---
  function getSettings() {
    if (isLocked()) return { ...DEFAULT_SETTINGS };
    if (cloudView) {
      return {
        ...structuredClone(cloudView.general),
        // 클라우드 모드에서도 이 기기에 저장된 API 키를 안전하게 불러와 설정에 반영합니다.
        geminiApiKey: getDeviceGeminiApiKey(),
      };
    }

    try {
      const data = localStorage.getItem(KEYS.SETTINGS);

      return data
        ? {
            ...DEFAULT_SETTINGS,
            ...JSON.parse(data),
            geminiApiKey: getDeviceGeminiApiKey(),
          }
        : {
            ...DEFAULT_SETTINGS,
          };
    } catch {
      return {
        ...DEFAULT_SETTINGS,
      };
    }
  }

  function saveSettings(settings) {
    // API 키가 전달된 경우, 클라우드 모드 여부와 상관없이 항상 현재 기기의 브라우저에 안전하게 저장합니다.
    if (settings && typeof settings.geminiApiKey === 'string') {
      saveDeviceGeminiApiKey(settings.geminiApiKey);
    }

    if (cloudView) {
      if (!cloudSettingsWriter) {
        throw new Error(
          '클라우드 설정 연결을 다시 확인해주세요.'
        );
      }

      const general = {
        budgetName:
          typeof settings.budgetName === 'string'
            ? settings.budgetName
            : '',
        totalBudget:
          Number(settings.totalBudget) || 0,
        schoolName:
          typeof settings.schoolName === 'string'
            ? settings.schoolName
            : '',
        teacherName:
          typeof settings.teacherName === 'string'
            ? settings.teacherName
            : '',
        className:
          typeof settings.className === 'string'
            ? settings.className
            : '',
      };

      return cloudSettingsWriter(general);
    }

    localStorage.setItem(
      KEYS.SETTINGS,
      JSON.stringify({ ...settings, geminiApiKey: isKeyRemembered() ? getDeviceGeminiApiKey() : '' })
    );
  }

  // --- Statistics ---
  function getStats() {
    const receipts = getReceipts();
    const settings = getSettings();

    const totalSpent = receipts.reduce(
      (sum, r) => sum + (Number(r.amount) || 0),
      0
    );

    const remaining =
      settings.totalBudget - totalSpent;

    const usagePercent =
      settings.totalBudget > 0
        ? (totalSpent / settings.totalBudget) * 100
        : 0;

    const categoryMap = {};

    receipts.forEach(r => {
      const cat = r.category || 'other';

      categoryMap[cat] =
        (categoryMap[cat] || 0) +
        (Number(r.amount) || 0);
    });

    const categoryBreakdown = CATEGORIES
      .map(c => ({
        ...c,
        total: categoryMap[c.id] || 0,
        percent:
          totalSpent > 0
            ? ((categoryMap[c.id] || 0) /
                totalSpent) *
              100
            : 0,
      }))
      .filter(c => c.total > 0)
      .sort((a, b) => b.total - a.total);

    return {
      totalBudget: settings.totalBudget,
      totalSpent,
      remaining,
      usagePercent: Math.min(
        usagePercent,
        100
      ),
      receiptCount: receipts.length,
      categoryBreakdown,
    };
  }

  // --- Import / Export ---
  function exportData() {
    const settings = getSettings();

    const {
      geminiApiKey,
      ...safeSettings
    } = settings;

    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: safeSettings,
      receipts: getReceipts(),
    };

    return JSON.stringify(data, null, 2);
  }

  function importData(jsonString) {
    let data;
    try {
      requireLocal();
      data = DataSafety.backup(JSON.parse(jsonString));
    } catch (error) {
      return { success: false, error: error instanceof SyntaxError ? 'JSON 백업 파일을 읽을 수 없습니다. 파일 형식을 확인해주세요.' : error.message };
    }
    // Validate and serialize everything before touching either existing key.
    let previousReceipts;
    let wroteReceipts = false;
    try {
      previousReceipts = localStorage.getItem(KEYS.RECEIPTS);
      const settingsJSON = data.settings === undefined ? null : JSON.stringify({
        ...getSettings(), ...data.settings, geminiApiKey: isKeyRemembered() ? getDeviceGeminiApiKey() : '',
      });
      const receiptsJSON = data.receipts === undefined ? null : JSON.stringify(data.receipts);
      if (receiptsJSON !== null) {
        localStorage.setItem(KEYS.RECEIPTS, receiptsJSON);
        wroteReceipts = true;
      }
      if (settingsJSON !== null) localStorage.setItem(KEYS.SETTINGS, settingsJSON);
      return { success: true, count: data.receipts?.length || 0 };
    } catch {
      if (wroteReceipts) {
        try {
          if (previousReceipts === null) localStorage.removeItem(KEYS.RECEIPTS);
          else localStorage.setItem(KEYS.RECEIPTS, previousReceipts);
        } catch {
          return { success: false, error: '복원과 원상 복구에 실패했습니다. 창을 닫지 말고 기존 백업을 보관해주세요.' };
        }
      }
      return { success: false, error: '저장 공간 또는 브라우저 권한 문제로 복원하지 못했습니다. 기존 자료는 유지됩니다.' };
    }
  }

  function clearAll() {
    requireLocal();

    memoryKey = ''; localStorage.removeItem(keyFlag());
    if (activeUid) clearAccount(activeUid);
    localStorage.removeItem(
      KEYS.RECEIPTS
    );

    localStorage.removeItem(
      KEYS.SETTINGS
    );
  }

  // --- Permanent Storage Request ---
  async function requestPersistStorage() {
    if (
      navigator.storage &&
      navigator.storage.persist
    ) {
      try {
        const isPersisted =
          await navigator.storage.persist();

        console.log(
          `[Storage] Permanent storage persistence: ${
            isPersisted
              ? 'Active'
              : 'Default'
          }`
        );

        return isPersisted;
      } catch (e) {
        console.warn(
          '[Storage] Could not request persistence:',
          e
        );
      }
    }

    return false;
  }

  return {
    switchAccount, resumeLocalOnly, isLocked, migrationStorage, isKeyRemembered,
    sessionVersion: () => generation,
    currentUid: () => activeUid,
    saveCloudAttachment,
    getCloudAttachment,
    deleteCloudAttachment,
    setCloudView,
    isCloudView,
    CATEGORIES,
    getReceipts,
    addReceipt,
    updateReceipt,
    deleteReceipt,
    getReceiptById,
    getDeviceGeminiApiKey,
    saveDeviceGeminiApiKey,
    getSettings,
    saveSettings,
    getStats,
    exportData,
    importData,
    clearAll,
    requestPersistStorage,
  };
})();
