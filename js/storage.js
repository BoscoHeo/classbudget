/**
 * storage.js - LocalStorage CRUD wrapper for ClassBudget
 * Manages receipts and settings data with JSON import/export
 */

const Storage = (() => {
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
    try {
      const data = localStorage.getItem(KEYS.RECEIPTS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function saveReceipts(receipts) {
    localStorage.setItem(KEYS.RECEIPTS, JSON.stringify(receipts));
  }

  function addReceipt(receipt) {
    const receipts = getReceipts();
    receipt.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    receipt.createdAt = new Date().toISOString();
    receipts.unshift(receipt);
    saveReceipts(receipts);
    return receipt;
  }

  function updateReceipt(id, updates) {
    const receipts = getReceipts();
    const idx = receipts.findIndex(r => r.id === id);
    if (idx !== -1) {
      receipts[idx] = { ...receipts[idx], ...updates, updatedAt: new Date().toISOString() };
      saveReceipts(receipts);
      return receipts[idx];
    }
    return null;
  }

  function deleteReceipt(id) {
    const receipts = getReceipts().filter(r => r.id !== id);
    saveReceipts(receipts);
  }

  function getReceiptById(id) {
    return getReceipts().find(r => r.id === id) || null;
  }

  // --- Settings ---
  function getSettings() {
    try {
      const data = localStorage.getItem(KEYS.SETTINGS);
      return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  }

  // --- Statistics ---
  function getStats() {
    const receipts = getReceipts();
    const settings = getSettings();
    const totalSpent = receipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const remaining = settings.totalBudget - totalSpent;
    const usagePercent = settings.totalBudget > 0 ? (totalSpent / settings.totalBudget) * 100 : 0;

    // Category breakdown
    const categoryMap = {};
    receipts.forEach(r => {
      const cat = r.category || 'other';
      categoryMap[cat] = (categoryMap[cat] || 0) + (Number(r.amount) || 0);
    });

    const categoryBreakdown = CATEGORIES.map(c => ({
      ...c,
      total: categoryMap[c.id] || 0,
      percent: totalSpent > 0 ? ((categoryMap[c.id] || 0) / totalSpent) * 100 : 0,
    })).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

    return {
      totalBudget: settings.totalBudget,
      totalSpent,
      remaining,
      usagePercent: Math.min(usagePercent, 100),
      receiptCount: receipts.length,
      categoryBreakdown,
    };
  }

  // --- Import/Export ---
  function exportData() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      receipts: getReceipts(),
    };
    return JSON.stringify(data, null, 2);
  }

  function importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.settings) saveSettings(data.settings);
      if (data.receipts) saveReceipts(data.receipts);
      return { success: true, count: (data.receipts || []).length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function clearAll() {
    localStorage.removeItem(KEYS.RECEIPTS);
    localStorage.removeItem(KEYS.SETTINGS);
  }

  // --- Permanent Storage Request ---
  async function requestPersistStorage() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        console.log(`[Storage] Permanent storage persistence: ${isPersisted ? 'Active' : 'Default'}`);
        return isPersisted;
      } catch (e) {
        console.warn('[Storage] Could not request persistence:', e);
      }
    }
    return false;
  }

  return {
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
