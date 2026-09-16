/**
 * storage.js - LocalStorage CRUD wrapper for ClassBudget
 * Manages receipts and settings data with JSON import/export
 */

const Storage = (() => {
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

  // --- Settings ---
  function getSettings() {
    if (cloudView) {
      return {
        ...structuredClone(cloudView.general),
        geminiApiKey: '',
      };
    }

    try {
      const data = localStorage.getItem(KEYS.SETTINGS);

      return data
        ? {
            ...DEFAULT_SETTINGS,
            ...JSON.parse(data),
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
      JSON.stringify(settings)
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
    try {
      const data = JSON.parse(jsonString);

      if (data.settings) {
        const currentSettings =
          getSettings();

        const {
          geminiApiKey,
          ...importedSettings
        } = data.settings;

        saveSettings({
          ...currentSettings,
          ...importedSettings,
          geminiApiKey:
            currentSettings.geminiApiKey ||
            '',
        });
      }

      if (data.receipts) {
        saveReceipts(data.receipts);
      }

      return {
        success: true,
        count:
          (data.receipts || []).length,
      };
    } catch (e) {
      return {
        success: false,
        error: e.message,
      };
    }
  }

  function clearAll() {
    requireLocal();

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
    getSettings,
    saveSettings,
    getStats,
    exportData,
    importData,
    clearAll,
    requestPersistStorage,
  };
})();
