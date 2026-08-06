/**
 * pages.js - Page renderers for ClassBudget SPA
 * Each page exports a render() function (returns HTML) and an init() function (binds events)
 */

const Pages = (() => {

  // === Helpers ===
  function fmt(n) { return ExcelExport.formatNumber(n); }
  function fmtDate(d) { return ExcelExport.formatDate(d); }

  function getCategoryInfo(id) {
    return Storage.CATEGORIES.find(c => c.id === id) || Storage.CATEGORIES[Storage.CATEGORIES.length - 1];
  }

  // Temporary storage for uploaded image data (base64)
  let _pendingImageData = null;
  let _pendingImageName = null;

  /**
   * Resize image to max dimension and return base64 JPEG
   */
  function resizeImage(file, maxSize = 800) {
    return new Promise((resolve, reject) => {
      if (file.type === 'application/pdf') {
        // Read PDF as base64 for AI analysis, but store as marker for LocalStorage
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({ data: 'PDF_FILE', aiData: e.target.result, name: file.name, type: 'pdf' });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width;
          let h = img.height;

          // Scale down if larger than maxSize
          if (w > maxSize || h > maxSize) {
            if (w > h) {
              h = Math.round((h * maxSize) / w);
              w = maxSize;
            } else {
              w = Math.round((w * maxSize) / h);
              h = maxSize;
            }
          }

          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          // Compress as JPEG (0.7 quality)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve({ data: dataUrl, name: file.name, type: 'image' });
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Show image in lightbox modal
   */
  function showImageModal(imageData, imageName) {
    const existing = document.getElementById('image-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'image-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:700px;">
        <div class="modal__header">
          <span class="modal__title">📷 ${imageName || '영수증 이미지'}</span>
          <button class="modal__close" id="close-image-modal">&times;</button>
        </div>
        <div class="modal__body" style="padding:0;text-align:center;background:#f0f0f0;">
          <img src="${imageData}" alt="영수증" style="max-width:100%;max-height:70vh;display:block;margin:0 auto;">
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'close-image-modal') {
        overlay.remove();
      }
    });
  }

  /**
   * Analyze receipt image using Gemini Vision API
   * Returns extracted data: { date, amount, item, store, category }
   */
  async function analyzeReceiptWithGemini(base64DataUrl) {
    const settings = Storage.getSettings();
    const apiKey = settings.geminiApiKey;
    if (!apiKey) {
      return { success: false, error: 'API_KEY_MISSING' };
    }

    // Extract base64 data (remove data:image/jpeg;base64, prefix)
    const base64Data = base64DataUrl.split(',')[1];
    const mimeType = base64DataUrl.split(';')[0].split(':')[1] || 'image/jpeg';

    const prompt = `이 영수증/거래내역 이미지를 분석하여 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 순수 JSON만 출력하세요.

{
  "date": "YYYY-MM-DD 형식의 날짜",
  "amount": 숫자(원 단위, 쉼표 없이),
  "item": "구매한 품목 이름 (여러 개면 대표 품목 또는 쉼표로 구분)",
  "store": "상호명/사용처",
  "category": "다음 중 하나: supplies, materials, experience, equipment, cleaning, event, food, other"
}

카테고리 기준:
- supplies: 학용품, 문구, 종이
- materials: 교육자료, 인쇄물, 책
- experience: 체험학습, 현장학습
- equipment: 비품, 전자기기
- cleaning: 청소용품, 위생용품
- event: 학급행사, 파티용품
- food: 간식, 음료, 식품
- other: 위에 해당없는 것

금액이 여러 개 있으면 총 합계(결제금액)를 사용하세요. 정보를 파악할 수 없는 항목은 빈 문자열("")로 남겨두세요. 금액을 파악할 수 없으면 0으로 하세요.`;

    // Try multiple models for compatibility (2026.03 updated)
    const modelsToTry = ['gemini-2.5-flash', 'gemini-3-flash-preview'];

    for (const model of modelsToTry) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: mimeType,
                      data: base64Data
                    }
                  }
                ]
              }]
            })
          }
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          // If model not found, try next model
          if (response.status === 404) continue;
          const errMsg = errData?.error?.message || response.statusText;
          return { success: false, error: errMsg };
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return { success: false, error: 'AI 응답에서 데이터를 추출할 수 없습니다.' };
        }

        const parsed = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          data: {
            date: parsed.date || '',
            amount: Number(parsed.amount) || 0,
            item: parsed.item || '',
            store: parsed.store || '',
            category: parsed.category || 'other',
          }
        };
      } catch (err) {
        // Network/CORS error - don't try other models
        if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
          return { success: false, error: 'CORS/네트워크 차단: file:// 프로토콜에서는 API 호출이 차단될 수 있습니다.' };
        }
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: '사용 가능한 AI 모델을 찾을 수 없습니다. API 키를 확인해주세요.' };
  }

  /**
   * Fill form fields with AI-extracted data
   */
  function fillFormWithAIData(data) {
    if (data.date) {
      const dateInput = document.getElementById('receipt-date');
      if (dateInput) dateInput.value = data.date;
    }
    if (data.amount) {
      const amountInput = document.getElementById('receipt-amount');
      if (amountInput) amountInput.value = data.amount;
    }
    if (data.item) {
      const itemInput = document.getElementById('receipt-item');
      if (itemInput) itemInput.value = data.item;
    }
    if (data.store) {
      const storeInput = document.getElementById('receipt-store');
      if (storeInput) storeInput.value = data.store;
    }
    if (data.category) {
      const catSelect = document.getElementById('receipt-category');
      if (catSelect) {
        // Check if the category value exists in our options
        const validCats = Storage.CATEGORIES.map(c => c.id);
        if (validCats.includes(data.category)) {
          catSelect.value = data.category;
        }
      }
    }
  }

  // =====================
  //  DASHBOARD PAGE
  // =====================
  function renderDashboard() {
    const stats = Storage.getStats();
    const settings = Storage.getSettings();
    const receipts = Storage.getReceipts();
    const recent = receipts.slice(0, 5);

    const budgetStatus = stats.usagePercent >= 90 ? 'danger' : stats.usagePercent >= 70 ? 'warning' : 'blue';
    const remainClass = stats.remaining < 0 ? 'stat-card__value--danger' : stats.remaining < stats.totalBudget * 0.1 ? 'stat-card__value--warning' : 'stat-card__value--success';

    return `
      <div class="page-enter">
        <div class="dashboard-welcome">
          <h1 class="dashboard-welcome__title">📋 ${settings.budgetName || '학급비 정리'}</h1>
          <p class="dashboard-welcome__sub">${settings.schoolName ? settings.schoolName + ' ' : ''}${settings.className ? settings.className + ' · ' : ''}영수증 ${stats.receiptCount}건 관리 중</p>
        </div>

        <!-- Stat Cards -->
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-card__icon stat-card__icon--blue">💰</div>
            <div class="stat-card__content">
              <div class="stat-card__label">총 예산</div>
              <div class="stat-card__value">${fmt(stats.totalBudget)}원</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-card__icon stat-card__icon--purple">🧾</div>
            <div class="stat-card__content">
              <div class="stat-card__label">총 지출</div>
              <div class="stat-card__value">${fmt(stats.totalSpent)}원</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-card__icon stat-card__icon--green">💵</div>
            <div class="stat-card__content">
              <div class="stat-card__label">잔액</div>
              <div class="stat-card__value ${remainClass}">${fmt(stats.remaining)}원</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-card__icon stat-card__icon--orange">📊</div>
            <div class="stat-card__content">
              <div class="stat-card__label">집행률</div>
              <div class="stat-card__value">${stats.usagePercent.toFixed(1)}%</div>
            </div>
          </div>
        </div>

        <!-- Budget overview -->
        <div class="budget-overview">
          <div class="budget-overview__row">
            <span class="budget-overview__label">예산 집행 현황</span>
            <span class="budget-overview__amount">${fmt(stats.totalSpent)} / ${fmt(stats.totalBudget)}원</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar__fill progress-bar__fill--${budgetStatus}" style="width: ${Math.min(stats.usagePercent, 100)}%"></div>
          </div>
        </div>

        <div class="dashboard-grid">
          <!-- Recent Receipts -->
          <div class="recent-section">
            <div class="section-header">
              <div>
                <h2 class="section-title">최근 영수증</h2>
                <p class="section-subtitle">최근 등록된 영수증 ${Math.min(recent.length, 5)}건</p>
              </div>
              ${receipts.length > 0 ? `<a href="#/list" class="btn btn--secondary btn--sm">전체보기</a>` : ''}
            </div>
            ${recent.length > 0 ? `
              <div class="recent-list">
                ${recent.map(r => {
                  const cat = getCategoryInfo(r.category);
                  return `
                    <div class="recent-item">
                      <div class="recent-item__icon">${cat.icon}</div>
                      <div class="recent-item__info">
                        <div class="recent-item__name">${r.item || r.store || '(미입력)'}</div>
                        <div class="recent-item__date">${fmtDate(r.date)} · ${cat.name}</div>
                      </div>
                      <div class="recent-item__amount">-${fmt(r.amount)}원</div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div class="empty-state">
                <div class="empty-state__icon">🧾</div>
                <div class="empty-state__title">아직 영수증이 없습니다</div>
                <div class="empty-state__description">영수증을 등록하고 학급비를 체계적으로 관리해보세요.</div>
                <a href="#/add" class="btn btn--primary btn--lg">영수증 등록하기</a>
              </div>
            `}
          </div>

          <!-- Category Chart -->
          <div class="category-chart-section">
            <div class="section-header">
              <div>
                <h2 class="section-title">카테고리별 지출</h2>
                <p class="section-subtitle">분류별 지출 비율</p>
              </div>
            </div>
            ${stats.categoryBreakdown.length > 0 ? `
              <div class="card">
                <div class="chart-bar-container">
                  ${stats.categoryBreakdown.map(c => `
                    <div class="chart-bar-row">
                      <span class="chart-bar-label">${c.icon} ${c.name}</span>
                      <div class="chart-bar-track">
                        <div class="chart-bar-fill" style="width: ${c.percent}%"></div>
                      </div>
                      <span class="chart-bar-value">${fmt(c.total)}원</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : `
              <div class="card" style="text-align:center;padding:var(--space-2xl);color:var(--color-text-muted);">
                <p>지출 데이터가 없습니다</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function initDashboard() {
    // No special event bindings needed for dashboard
  }

  // =====================
  //  ADD RECEIPT PAGE
  // =====================
  function renderAddReceipt(editId) {
    const isEdit = !!editId;
    const receipt = isEdit ? Storage.getReceiptById(editId) : null;

    const categoryOptions = Storage.CATEGORIES.map(c =>
      `<option value="${c.id}" ${receipt && receipt.category === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>`
    ).join('');

    const today = new Date().toISOString().slice(0, 10);

    return `
      <div class="page-enter add-receipt-form">
        <div class="add-receipt-header">
          <div class="add-receipt-header__icon">🧾</div>
          <h1 class="add-receipt-header__title">${isEdit ? '영수증 수정' : '영수증 등록'}</h1>
          <p class="add-receipt-header__sub">${isEdit ? '영수증 정보를 수정합니다' : '학급비 사용 내역을 등록하세요'}</p>
        </div>

        <div class="card">
          <form id="receipt-form">
            ${isEdit ? `<input type="hidden" id="receipt-id" value="${editId}">` : ''}

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="receipt-date">사용 날짜 <span>*</span></label>
                <input type="date" id="receipt-date" class="form-input" value="${receipt ? receipt.date : today}" required>
              </div>
              <div class="form-group">
                <label class="form-label" for="receipt-amount">금액 (원) <span>*</span></label>
                <input type="number" id="receipt-amount" class="form-input" placeholder="예: 35000" value="${receipt ? receipt.amount : ''}" min="0" required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="receipt-item">품명/사용목적 <span>*</span></label>
                <input type="text" id="receipt-item" class="form-input" placeholder="예: A4용지, 색종이" value="${receipt ? (receipt.item || '') : ''}" required>
              </div>
              <div class="form-group">
                <label class="form-label" for="receipt-store">사용처(구입처)</label>
                <input type="text" id="receipt-store" class="form-input" placeholder="예: 다이소, 쿠팡" value="${receipt ? (receipt.store || '') : ''}">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="receipt-category">분류</label>
              <select id="receipt-category" class="form-input">
                ${categoryOptions}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="receipt-memo">메모</label>
              <textarea id="receipt-memo" class="form-input" placeholder="추가 메모 사항 (선택)">${receipt ? (receipt.memo || '') : ''}</textarea>
            </div>

            <!-- Image Upload -->
            <div class="form-group">
              <label class="form-label">영수증 이미지/PDF (선택)</label>
              <div class="upload-dropzone" id="upload-dropzone">
                <input type="file" id="receipt-file" accept="image/*,.pdf" style="display:none;">
                <div class="upload-dropzone__content" id="upload-placeholder">
                  <div class="upload-dropzone__icon">📎</div>
                  <div class="upload-dropzone__text">클릭하거나 파일을 여기에 드래그하세요</div>
                  <div class="upload-dropzone__hint">이미지(JPG, PNG) 또는 PDF · 자동 리사이징됨</div>
                </div>
                <div class="upload-preview" id="upload-preview" style="display:none;">
                  <img id="upload-preview-img" src="" alt="미리보기">
                  <div class="upload-preview__info">
                    <span id="upload-preview-name"></span>
                    <button type="button" class="btn btn--danger btn--sm" id="btn-remove-file">🗑️ 삭제</button>
                  </div>
                </div>
              </div>
              ${receipt && receipt.imageData && receipt.imageData !== 'PDF_FILE' ? `
                <div class="upload-existing" style="margin-top:var(--space-sm);">
                  <p style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-bottom:var(--space-xs);">현재 첨부된 이미지:</p>
                  <img src="${receipt.imageData}" alt="기존 영수증" class="upload-existing__thumb" id="existing-image-thumb" style="max-width:200px;border-radius:var(--radius-sm);cursor:pointer;border:1px solid var(--color-border);">
                </div>
              ` : ''}
              ${receipt && receipt.imageData === 'PDF_FILE' ? `
                <div class="upload-existing" style="margin-top:var(--space-sm);">
                  <p style="font-size:var(--font-size-xs);color:var(--color-text-muted);">📄 PDF 파일 첨부됨: ${receipt.imageName || 'document.pdf'}</p>
                </div>
              ` : ''}
            </div>

            <div class="add-receipt-actions">
              <button type="button" class="btn btn--secondary" id="btn-cancel-receipt">취소</button>
              <button type="submit" class="btn btn--primary btn--lg" id="btn-save-receipt">
                ${isEdit ? '✏️ 수정 완료' : '💾 저장하기'}
              </button>
              ${!isEdit ? '<button type="button" class="btn btn--success btn--lg" id="btn-save-and-new">💾 저장 & 새 영수증</button>' : ''}
            </div>
          </form>
        </div>
      </div>
    `;
  }

  function initAddReceipt() {
    const form = document.getElementById('receipt-form');
    if (!form) return;

    // Reset pending image
    _pendingImageData = null;
    _pendingImageName = null;

    // Load existing image data if editing
    const idField = document.getElementById('receipt-id');
    if (idField) {
      const existing = Storage.getReceiptById(idField.value);
      if (existing && existing.imageData) {
        _pendingImageData = existing.imageData;
        _pendingImageName = existing.imageName || '';
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveReceipt(false);
    });

    const btnSaveNew = document.getElementById('btn-save-and-new');
    if (btnSaveNew) {
      btnSaveNew.addEventListener('click', () => saveReceipt(true));
    }

    const btnCancel = document.getElementById('btn-cancel-receipt');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        window.location.hash = '#/';
      });
    }

    // === File Upload ===
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('receipt-file');
    const placeholder = document.getElementById('upload-placeholder');
    const preview = document.getElementById('upload-preview');
    const previewImg = document.getElementById('upload-preview-img');
    const previewName = document.getElementById('upload-preview-name');
    const btnRemove = document.getElementById('btn-remove-file');

    if (dropzone && fileInput) {
      // Click to select file
      dropzone.addEventListener('click', (e) => {
        if (e.target.closest('#btn-remove-file')) return;
        fileInput.click();
      });

      // Drag & drop
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('upload-dropzone--active');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('upload-dropzone--active');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('upload-dropzone--active');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
      });

      // File input change
      fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
      });

      // Remove file
      if (btnRemove) {
        btnRemove.addEventListener('click', (e) => {
          e.stopPropagation();
          _pendingImageData = null;
          _pendingImageName = null;
          placeholder.style.display = '';
          preview.style.display = 'none';
          fileInput.value = '';
        });
      }
    }

    async function handleFileSelect(file) {
      // Validate file type
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        App.showToast('이미지 또는 PDF 파일만 업로드 가능합니다.', 'error');
        return;
      }
      // Validate file size (max 10MB before resize)
      if (file.size > 10 * 1024 * 1024) {
        App.showToast('파일 크기는 10MB 이하만 가능합니다.', 'error');
        return;
      }

      try {
        const result = await resizeImage(file);
        _pendingImageData = result.data;
        _pendingImageName = result.name;

        if (placeholder && preview && previewImg && previewName) {
          placeholder.style.display = 'none';
          preview.style.display = 'flex';
          previewName.textContent = result.name;

          if (result.type === 'pdf') {
            previewImg.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSI4IiBmaWxsPSIjZWYzMDMwIi8+PHRleHQgeD0iMzIiIHk9IjQwIiBmb250LXNpemU9IjIwIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSJib2xkIj5QREY8L3RleHQ+PC9zdmc+';
          } else {
            previewImg.src = result.data;
          }
        }
        App.showToast('파일이 첨부되었습니다. AI 분석 중...', 'info');

        // === AI Receipt Recognition ===
        const aiDataUrl = result.aiData || result.data; // PDF uses aiData, images use data
        if (aiDataUrl && aiDataUrl !== 'PDF_FILE') {
          // Show loading state on dropzone
          if (dropzone) dropzone.classList.add('upload-dropzone--analyzing');
          if (previewName) previewName.textContent = result.name + ' 🔍 AI 분석 중...';

          const aiResult = await analyzeReceiptWithGemini(aiDataUrl);

          if (dropzone) dropzone.classList.remove('upload-dropzone--analyzing');
          if (previewName) previewName.textContent = result.name;

          if (aiResult.success) {
            fillFormWithAIData(aiResult.data);
            App.showToast('✨ AI가 영수증을 성공적으로 인식했습니다!', 'success');
          } else if (aiResult.error === 'API_KEY_MISSING') {
            App.showToast('🔑 AI 인식을 사용하려면 설정 페이지에서 Gemini API 키를 입력하세요.', 'warning');
          } else {
            App.showToast(`AI 분석 실패: ${aiResult.error}`, 'error');
          }
        }
      } catch (err) {
        App.showToast('파일 처리 중 오류가 발생했습니다.', 'error');
      }
    }

    // Existing image thumbnail click
    const existingThumb = document.getElementById('existing-image-thumb');
    if (existingThumb) {
      existingThumb.addEventListener('click', () => {
        showImageModal(existingThumb.src, '기존 영수증');
      });
    }

    // Format amount with commas on blur
    const amountInput = document.getElementById('receipt-amount');
    if (amountInput) {
      amountInput.addEventListener('focus', () => {
        amountInput.type = 'number';
      });
    }
  }

  function saveReceipt(continueAdding) {
    const idField = document.getElementById('receipt-id');
    const date = document.getElementById('receipt-date').value;
    const amount = document.getElementById('receipt-amount').value;
    const item = document.getElementById('receipt-item').value.trim();
    const store = document.getElementById('receipt-store').value.trim();
    const category = document.getElementById('receipt-category').value;
    const memo = document.getElementById('receipt-memo').value.trim();

    if (!date || !amount || !item) {
      App.showToast('날짜, 금액, 품명은 필수 입력입니다.', 'error');
      return;
    }

    const data = { date, amount: Number(amount), item, store, category, memo };

    // Attach image data if present
    if (_pendingImageData) {
      data.imageData = _pendingImageData;
      data.imageName = _pendingImageName;
    }

    if (idField) {
      // Edit mode
      Storage.updateReceipt(idField.value, data);
      App.showToast('영수증이 수정되었습니다.', 'success');
      window.location.hash = '#/list';
    } else {
      // New
      Storage.addReceipt(data);
      App.showToast('영수증이 저장되었습니다!', 'success');

      if (continueAdding) {
        // Reset form but keep date & category
        document.getElementById('receipt-amount').value = '';
        document.getElementById('receipt-item').value = '';
        document.getElementById('receipt-store').value = '';
        document.getElementById('receipt-memo').value = '';
        // Reset file upload
        _pendingImageData = null;
        _pendingImageName = null;
        const placeholder = document.getElementById('upload-placeholder');
        const preview = document.getElementById('upload-preview');
        if (placeholder) placeholder.style.display = '';
        if (preview) preview.style.display = 'none';
        document.getElementById('receipt-item').focus();
      } else {
        window.location.hash = '#/';
      }
    }
  }

  // =====================
  //  RECEIPT LIST PAGE
  // =====================
  function renderReceiptList() {
    const receipts = Storage.getReceipts();
    const stats = Storage.getStats();

    const categoryFilterOpts = Storage.CATEGORIES.map(c =>
      `<option value="${c.id}">${c.icon} ${c.name}</option>`
    ).join('');

    return `
      <div class="page-enter">
        <div class="section-header">
          <div>
            <h1 class="section-title">🧾 영수증 목록</h1>
            <p class="section-subtitle">총 ${receipts.length}건 · 합계 ${fmt(stats.totalSpent)}원</p>
          </div>
          <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap;">
            <button class="btn btn--primary btn--sm" id="btn-export-edufine" title="에듀파인 정산양식 XLS 내보내기">📊 에듀파인 정산</button>
            <button class="btn btn--success btn--sm" id="btn-export-csv" title="NEIS 정산 CSV 내보내기">📄 정산 내보내기</button>
            <button class="btn btn--secondary btn--sm" id="btn-export-list" title="영수증 목록 CSV">📋 목록 내보내기</button>
            <a href="#/add" class="btn btn--primary btn--sm">➕ 등록</a>
          </div>
        </div>

        <div class="table-wrapper">
          <div class="table-header">
            <div class="table-header__title">지출 내역</div>
            <div class="table-header__actions filter-bar">
              <select id="filter-category" class="form-input">
                <option value="">전체 분류</option>
                ${categoryFilterOpts}
              </select>
              <select id="filter-sort" class="form-input">
                <option value="newest">최신순</option>
                <option value="oldest">오래된순</option>
                <option value="amount-desc">금액 높은순</option>
                <option value="amount-asc">금액 낮은순</option>
              </select>
            </div>
          </div>
          <div class="table-scroll">
            <table class="table" id="receipts-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>품명</th>
                  <th>사용처</th>
                  <th>분류</th>
                  <th>첨부</th>
                  <th>금액</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody id="receipts-tbody">
                ${renderReceiptRows(receipts)}
              </tbody>
            </table>
          </div>
          ${receipts.length === 0 ? `
            <div class="table-empty">
              <div class="table-empty__icon">📭</div>
              <div class="table-empty__text">등록된 영수증이 없습니다</div>
              <div class="table-empty__sub">영수증을 등록하면 여기에 표시됩니다</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderReceiptRows(receipts) {
    if (receipts.length === 0) return '';
    return receipts.map(r => {
      const cat = getCategoryInfo(r.category);
      let attachCol = '<td style="text-align:center;color:var(--color-text-muted);">-</td>';
      if (r.imageData && r.imageData !== 'PDF_FILE') {
        attachCol = `<td style="text-align:center;"><img src="${r.imageData}" alt="영수증" class="receipt-thumb" data-id="${r.id}" style="width:36px;height:36px;object-fit:cover;border-radius:var(--radius-sm);cursor:pointer;border:1px solid var(--color-border);"></td>`;
      } else if (r.imageData === 'PDF_FILE') {
        attachCol = `<td style="text-align:center;"><span class="badge badge--red" style="cursor:default;" title="${r.imageName || 'PDF'}">📄 PDF</span></td>`;
      }
      return `
        <tr data-id="${r.id}">
          <td>${fmtDate(r.date)}</td>
          <td><strong>${r.item || '(미입력)'}</strong>${r.memo ? `<br><small style="color:var(--color-text-muted)">${r.memo}</small>` : ''}</td>
          <td>${r.store || '-'}</td>
          <td><span class="badge badge--${cat.color}">${cat.icon} ${cat.name}</span></td>
          ${attachCol}
          <td class="table__amount">${fmt(r.amount)}원</td>
          <td>
            <div class="table__actions">
              <button class="btn btn--secondary btn--icon btn--sm btn-edit-receipt" data-id="${r.id}" title="수정">✏️</button>
              <button class="btn btn--danger btn--icon btn--sm btn-delete-receipt" data-id="${r.id}" title="삭제">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function initReceiptList() {
    // Filter events
    const filterCategory = document.getElementById('filter-category');
    const filterSort = document.getElementById('filter-sort');

    function applyFilters() {
      let receipts = Storage.getReceipts();
      const cat = filterCategory ? filterCategory.value : '';
      const sort = filterSort ? filterSort.value : 'newest';

      if (cat) {
        receipts = receipts.filter(r => r.category === cat);
      }

      switch (sort) {
        case 'oldest':
          receipts.sort((a, b) => new Date(a.date) - new Date(b.date));
          break;
        case 'newest':
          receipts.sort((a, b) => new Date(b.date) - new Date(a.date));
          break;
        case 'amount-desc':
          receipts.sort((a, b) => b.amount - a.amount);
          break;
        case 'amount-asc':
          receipts.sort((a, b) => a.amount - b.amount);
          break;
      }

      const tbody = document.getElementById('receipts-tbody');
      if (tbody) tbody.innerHTML = renderReceiptRows(receipts);
      bindReceiptRowActions();
    }

    if (filterCategory) filterCategory.addEventListener('change', applyFilters);
    if (filterSort) filterSort.addEventListener('change', applyFilters);

    // Export buttons
    const btnExport = document.getElementById('btn-export-csv');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const result = ExcelExport.downloadSettlement();
        if (result.success) {
          App.showToast(`NEIS 정산 CSV가 다운로드되었습니다. (${result.count}건)`, 'success');
        } else {
          App.showToast(result.error, 'error');
        }
      });
    }

    const btnExportList = document.getElementById('btn-export-list');
    if (btnExportList) {
      btnExportList.addEventListener('click', () => {
        const result = ExcelExport.downloadReceiptList();
        if (result.success) {
          App.showToast(`영수증 목록이 다운로드되었습니다. (${result.count}건)`, 'success');
        } else {
          App.showToast(result.error, 'error');
        }
      });
    }

    const btnEdufine = document.getElementById('btn-export-edufine');
    if (btnEdufine) {
      btnEdufine.addEventListener('click', () => {
        const result = ExcelExport.downloadEdufineXLS();
        if (result.success) {
          App.showToast(`에듀파인 정산양식이 다운로드되었습니다. (${result.count}건)`, 'success');
        } else {
          App.showToast(result.error, 'error');
        }
      });
    }

    bindReceiptRowActions();
  }

  function bindReceiptRowActions() {
    // Edit buttons
    document.querySelectorAll('.btn-edit-receipt').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.hash = `#/edit/${btn.dataset.id}`;
      });
    });

    // Delete buttons
    document.querySelectorAll('.btn-delete-receipt').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (confirm('이 영수증을 삭제하시겠습니까?')) {
          Storage.deleteReceipt(id);
          App.showToast('영수증이 삭제되었습니다.', 'warning');
          App.navigate(window.location.hash);
        }
      });
    });

    // Image thumbnail clicks
    document.querySelectorAll('.receipt-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const receipt = Storage.getReceiptById(thumb.dataset.id);
        if (receipt && receipt.imageData) {
          showImageModal(receipt.imageData, receipt.imageName || receipt.item);
        }
      });
    });
  }

  // =====================
  //  SETTINGS PAGE
  // =====================
  function renderSettings() {
    const settings = Storage.getSettings();
    const stats = Storage.getStats();

    return `
      <div class="page-enter">
        <div class="section-header">
          <div>
            <h1 class="section-title">⚙️ 설정</h1>
            <p class="section-subtitle">학급비 관리 설정 및 데이터 관리</p>
          </div>
        </div>

        <!-- Cloud Sync Settings -->
        ${typeof FirebaseSync !== 'undefined' ? (() => {
          const syncInfo = FirebaseSync.getSyncInfo();
          const syncTime = syncInfo.lastSyncTime ? new Date(syncInfo.lastSyncTime).toLocaleString('ko-KR') : '없음';
          return `
        <div class="settings-section">
          <div class="card" style="border:1px solid rgba(74,123,247,0.2);">
            <h2 class="settings-section__title">☁️ 클라우드 동기화</h2>
            <p class="settings-section__description">PIN 코드 기반 클라우드 저장소로 데이터를 자동 백업합니다. 브라우저 데이터가 삭제되어도 PIN만 기억하면 복원됩니다.</p>

            <div class="sync-status-card">
              <div class="sync-status-card__icon">${syncInfo.isConnected ? '🟢' : '🔴'}</div>
              <div class="sync-status-card__info">
                <div class="sync-status-card__title">${syncInfo.isConnected ? '클라우드 연결됨' : '연결 안 됨'}</div>
                <div class="sync-status-card__detail" id="sync-status-text">마지막 동기화: ${syncTime}</div>
              </div>
            </div>

            <div class="settings-actions">
              ${syncInfo.isConnected ? `
                <button class="btn btn--primary btn--sm" id="btn-force-sync">🔄 수동 동기화</button>
                <button class="btn btn--danger btn--sm" id="btn-disconnect-cloud">🔌 연결 해제</button>
              ` : `
                <button class="btn btn--primary btn--sm" id="btn-connect-cloud">☁️ 클라우드 연결</button>
              `}
            </div>
          </div>
        </div>
          `;
        })() : ''}

        <!-- AI Recognition Settings -->
        <div class="settings-section">
          <div class="card" style="border:1px solid rgba(124,91,240,0.2);">
            <h2 class="settings-section__title">🤖 AI 영수증 인식 설정</h2>
            <p class="settings-section__description">Google Gemini API 키를 입력하면 영수증 이미지를 업로드할 때 자동으로 날짜, 금액, 품목, 사용처를 인식합니다.</p>

            <div class="form-group">
              <label class="form-label" for="setting-gemini-key">Gemini API Key</label>
              <input type="password" id="setting-gemini-key" class="form-input" placeholder="AIzaSy..." value="${settings.geminiApiKey || ''}">
              <p class="form-hint">💡 <a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--color-primary);text-decoration:underline;">Google AI Studio</a>에서 무료로 API 키를 발급받을 수 있습니다. 키는 브라우저에만 저장되며 외부로 전송되지 않습니다.</p>
            </div>

            <div style="display:flex;gap:var(--space-sm);align-items:center;">
              <button type="button" class="btn btn--primary btn--sm" id="btn-save-apikey">💾 키 저장</button>
              <button type="button" class="btn btn--secondary btn--sm" id="btn-test-apikey">🧪 테스트</button>
              <span id="apikey-status" style="font-size:var(--font-size-xs);color:var(--color-text-muted);"></span>
            </div>
          </div>
        </div>

        <!-- Budget Settings -->
        <div class="settings-section">
          <div class="card">
            <h2 class="settings-section__title">💰 예산 설정</h2>
            <p class="settings-section__description">학급비 예산 정보를 설정합니다. NEIS 정산 내보내기에도 사용됩니다.</p>

            <form id="settings-form">
              <div class="form-group">
                <label class="form-label" for="setting-budget-name">건명 (예산 이름)</label>
                <input type="text" id="setting-budget-name" class="form-input" placeholder="예: 2026학년도 1학기 학급운영비" value="${settings.budgetName || ''}">
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="setting-total-budget">총 예산 (원) <span>*</span></label>
                  <input type="number" id="setting-total-budget" class="form-input" placeholder="500000" value="${settings.totalBudget || ''}" min="0" required>
                </div>
                <div class="form-group">
                  <label class="form-label" for="setting-school-name">학교명</label>
                  <input type="text" id="setting-school-name" class="form-input" placeholder="○○초등학교" value="${settings.schoolName || ''}">
                </div>
              </div>

              <div class="form-row">
                <div class="form-group">
                  <label class="form-label" for="setting-class-name">학급</label>
                  <input type="text" id="setting-class-name" class="form-input" placeholder="3학년 2반" value="${settings.className || ''}">
                </div>
                <div class="form-group">
                  <label class="form-label" for="setting-teacher-name">담당교사</label>
                  <input type="text" id="setting-teacher-name" class="form-input" placeholder="홍길동" value="${settings.teacherName || ''}">
                </div>
              </div>

              <div style="margin-top:var(--space-lg);display:flex;justify-content:flex-end;">
                <button type="submit" class="btn btn--primary">💾 설정 저장</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Data Management -->
        <div class="settings-section">
          <div class="card">
            <h2 class="settings-section__title">📂 데이터 관리</h2>
            <p class="settings-section__description">데이터를 JSON 파일로 내보내거나 가져올 수 있습니다. 브라우저 데이터 삭제 시 데이터가 유실될 수 있으니 정기적으로 백업하세요.</p>

            <div class="settings-actions">
              <button class="btn btn--success" id="btn-export-json">📤 JSON 내보내기</button>
              <label class="btn btn--secondary" for="import-json-input" style="margin:0;">📥 JSON 가져오기</label>
              <input type="file" id="import-json-input" accept=".json" style="display:none;">
            </div>

            <div class="settings-info">
              💡 현재 저장된 영수증: <strong>${stats.receiptCount}건</strong> · 
              데이터는 이 브라우저의 LocalStorage에 저장됩니다.
            </div>
          </div>
        </div>

        <!-- Danger Zone -->
        <div class="settings-section">
          <div class="card" style="border:1px solid rgba(239,68,68,0.2);">
            <h2 class="settings-section__title" style="color:var(--color-danger);">⚠️ 위험 구역</h2>
            <p class="settings-section__description">모든 데이터(영수증 및 설정)를 삭제합니다. 이 작업은 되돌릴 수 없습니다.</p>
            <div class="settings-actions">
              <button class="btn btn--danger" id="btn-clear-all">🗑️ 모든 데이터 삭제</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function initSettings() {
    // Settings form
    const form = document.getElementById('settings-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const current = Storage.getSettings();
        const settings = {
          ...current,
          budgetName: document.getElementById('setting-budget-name').value.trim(),
          totalBudget: Number(document.getElementById('setting-total-budget').value) || 0,
          schoolName: document.getElementById('setting-school-name').value.trim(),
          className: document.getElementById('setting-class-name').value.trim(),
          teacherName: document.getElementById('setting-teacher-name').value.trim(),
        };
        Storage.saveSettings(settings);
        App.showToast('설정이 저장되었습니다.', 'success');
      });
    }

    // Export JSON
    const btnExport = document.getElementById('btn-export-json');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        const json = Storage.exportData();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `학급비_백업_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        App.showToast('데이터가 JSON으로 내보내졌습니다.', 'success');
      });
    }

    // Import JSON
    const importInput = document.getElementById('import-json-input');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const result = Storage.importData(ev.target.result);
          if (result.success) {
            App.showToast(`데이터를 가져왔습니다! (영수증 ${result.count}건)`, 'success');
            App.navigate('#/settings');
          } else {
            App.showToast(`가져오기 실패: ${result.error}`, 'error');
          }
        };
        reader.readAsText(file);
      });
    }

    // === API Key Management ===
    const btnSaveKey = document.getElementById('btn-save-apikey');
    if (btnSaveKey) {
      btnSaveKey.addEventListener('click', () => {
        const key = document.getElementById('setting-gemini-key').value.trim();
        const current = Storage.getSettings();
        Storage.saveSettings({ ...current, geminiApiKey: key });
        App.showToast(key ? 'API 키가 저장되었습니다.' : 'API 키가 삭제되었습니다.', 'success');
      });
    }

    const btnTestKey = document.getElementById('btn-test-apikey');
    if (btnTestKey) {
      btnTestKey.addEventListener('click', async () => {
        const key = document.getElementById('setting-gemini-key').value.trim();
        const statusEl = document.getElementById('apikey-status');
        if (!key) {
          App.showToast('API 키를 입력해주세요.', 'error');
          return;
        }
        if (statusEl) {
          statusEl.textContent = '🔄 테스트 중...';
          statusEl.style.color = 'var(--color-text-muted)';
        }
        btnTestKey.disabled = true;

        // Try multiple model names for compatibility (2026.03 updated)
        const modelsToTry = [
          'gemini-2.5-flash',
          'gemini-3-flash-preview'
        ];

        let lastError = '';
        let success = false;

        for (const model of modelsToTry) {
          try {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: '안녕' }] }] })
              }
            );
            if (res.ok) {
              if (statusEl) {
                statusEl.textContent = `✅ 연결 성공! (${model})`;
                statusEl.style.color = 'var(--color-success)';
              }
              App.showToast(`API 키가 정상 작동합니다! (모델: ${model})`, 'success');
              success = true;
              break;
            } else {
              const errData = await res.json().catch(() => ({}));
              const errMsg = errData?.error?.message || '';
              const errStatus = errData?.error?.status || res.status;

              // If it's an auth error, no point trying other models
              if (res.status === 400 || res.status === 401 || res.status === 403) {
                lastError = `[${errStatus}] ${errMsg || '인증 실패'}`;
                break;
              }
              // Model not found (404) - try next model
              if (res.status === 404) {
                lastError = `모델 '${model}' 사용 불가`;
                continue;
              }
              // Rate limit or other errors
              lastError = `[${errStatus}] ${errMsg || '알 수 없는 오류'}`;
              break;
            }
          } catch (err) {
            // Network/CORS error
            if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
              lastError = 'CORS/네트워크 차단: file:// 프로토콜에서는 API 호출이 차단될 수 있습니다. 로컬 서버로 실행해 주세요.';
            } else {
              lastError = err.message || '네트워크 오류';
            }
            break;
          }
        }

        if (!success) {
          if (statusEl) {
            statusEl.textContent = '❌ 연결 실패';
            statusEl.style.color = 'var(--color-danger)';
          }
          App.showToast(`API 테스트 실패: ${lastError}`, 'error');
          console.error('API Test Error:', lastError);
        }
        btnTestKey.disabled = false;
      });
    }

    // Clear all
    const btnClear = document.getElementById('btn-clear-all');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm('정말로 모든 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) {
          if (confirm('최종 확인: 모든 영수증과 설정이 삭제됩니다.')) {
            Storage.clearAll();
            App.showToast('모든 데이터가 삭제되었습니다.', 'warning');
            App.navigate('#/');
          }
        }
      });
    }

    // === Cloud Sync Buttons ===
    const btnForceSync = document.getElementById('btn-force-sync');
    if (btnForceSync) {
      btnForceSync.addEventListener('click', async () => {
        btnForceSync.disabled = true;
        btnForceSync.textContent = '🔄 동기화 중...';
        const result = await FirebaseSync.forceSync();
        if (result.success) {
          App.showToast('☁️ 클라우드 동기화 완료!', 'success');
          FirebaseSync.updateSyncStatusUI();
        } else {
          App.showToast(`동기화 실패: ${result.error}`, 'error');
        }
        btnForceSync.disabled = false;
        btnForceSync.textContent = '🔄 수동 동기화';
      });
    }

    const btnDisconnect = document.getElementById('btn-disconnect-cloud');
    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', () => {
        if (confirm('클라우드 연결을 해제하시겠습니까?\n로컬 데이터는 유지되지만 자동 백업이 중단됩니다.')) {
          FirebaseSync.disconnect();
          App.showToast('클라우드 연결이 해제되었습니다.', 'warning');
          App.navigate('#/settings');
        }
      });
    }

    const btnConnect = document.getElementById('btn-connect-cloud');
    if (btnConnect) {
      btnConnect.addEventListener('click', () => {
        FirebaseSync.showPinScreen();
      });
    }
  }

  return {
    renderDashboard,
    initDashboard,
    renderAddReceipt,
    initAddReceipt,
    renderReceiptList,
    initReceiptList,
    renderSettings,
    initSettings,
  };
})();
