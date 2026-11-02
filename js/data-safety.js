/* Shared input/output boundaries. Stored text stays raw; escape only on display. */
const DataSafety = (() => {
  const fail = message => { throw new Error(message); };
  const record = value => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  function fields(value, allowed) {
    if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) {
      fail('백업에 지원하지 않는 항목이나 객체가 있습니다.');
    }
  }
  function text(value, name, max = 10000) {
    if (typeof value !== 'string' || value.length > max) fail(`${name}의 문자 형식이나 길이를 확인해주세요.`);
    return value;
  }
  function money(value) {
    // Earlier backups may contain numeric strings. Never coerce objects/booleans.
    if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) value = Number(value);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      fail('금액은 0 이상의 유한한 숫자로 입력해주세요.');
    }
    return value;
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        value.startsWith('0000') || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value) fail('날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 합니다.');
    return value;
  }
  function escapeHTML(value) {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
  }
  function image(value) {
    return typeof value === 'string' && /^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
  }
  function receipt(value, requireId = true) {
    fields(value, ['id', 'date', 'amount', 'item', 'store', 'category', 'memo', 'proofType', 'imageData', 'imageName', 'createdAt', 'updatedAt']);
    const result = { date: date(value.date), amount: money(value.amount), item: text(value.item, '품명') };
    if (!result.item.trim()) fail('품명을 입력해주세요.');
    if (requireId || value.id !== undefined) {
      result.id = text(value.id, '영수증 ID', 128);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) fail('영수증 ID 형식이 올바르지 않습니다.');
    }
    result.store = text(value.store ?? '', '사용처');
    result.memo = text(value.memo ?? '', '메모');
    result.category = text(value.category ?? 'other', '분류', 100);
    if (!['supplies', 'materials', 'experience', 'equipment', 'cleaning', 'event', 'food', 'other'].includes(result.category)) fail('분류를 확인해주세요.');
    if (value.proofType !== undefined) result.proofType = text(value.proofType, '증빙구분', 100);
    for (const key of ['createdAt', 'updatedAt']) {
      if (value[key] !== undefined) {
        result[key] = text(value[key], '저장 시각', 64);
        if (!Number.isFinite(Date.parse(result[key]))) fail('저장 시각 형식을 확인해주세요.');
      }
    }
    if (value.imageData !== undefined && value.imageData !== null && value.imageData !== '') {
      if (value.imageData !== 'PDF_FILE' && !image(value.imageData)) fail('백업의 첨부 이미지 형식을 확인해주세요.');
      result.imageData = value.imageData;
    }
    if (value.imageName !== undefined && value.imageName !== null) result.imageName = text(value.imageName, '첨부 이름');
    return result;
  }
  function receipts(values) {
    if (!Array.isArray(values) || values.length > 10000) fail('영수증 목록은 최대 10,000건의 배열이어야 합니다.');
    const ids = new Set();
    return values.map(value => {
      const clean = receipt(value);
      if (ids.has(clean.id)) fail('중복된 영수증 ID가 있습니다.');
      ids.add(clean.id);
      return clean;
    });
  }
  function settings(value) {
    fields(value, ['budgetName', 'totalBudget', 'schoolName', 'teacherName', 'className', 'geminiApiKey']);
    const clean = {};
    for (const key of ['budgetName', 'schoolName', 'teacherName', 'className']) {
      if (value[key] !== undefined) clean[key] = text(value[key], '설정', 1000);
    }
    if (value.totalBudget !== undefined) clean.totalBudget = money(value.totalBudget);
    if (value.geminiApiKey !== undefined) text(value.geminiApiKey, 'API 키', 1000); // Legacy key is validated, never imported.
    return clean;
  }
  function backup(value) {
    fields(value, ['version', 'exportedAt', 'settings', 'receipts']);
    if (value.version !== undefined && value.version !== 1) fail('지원하지 않는 백업 버전입니다.');
    if (value.exportedAt !== undefined && (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt)))) fail('백업 생성 시각이 올바르지 않습니다.');
    if (value.settings === undefined && value.receipts === undefined) fail('백업에 설정이나 영수증 목록이 없습니다.');
    const clean = {};
    if (value.settings !== undefined) clean.settings = settings(value.settings);
    if (value.receipts !== undefined) clean.receipts = receipts(value.receipts);
    return clean;
  }
  function csv(value) {
    let result = text(value, '내보내기 텍스트', 100000);
    if (/^[\s\u0000-\u001f\u007f]*[=+@-]/.test(result) || /^[\t\r\n]/.test(result)) result = "'" + result;
    return '"' + result.replace(/"/g, '""') + '"';
  }
  return { escapeHTML, image, receipt, receipts, settings, backup, money, date, csv };
})();
