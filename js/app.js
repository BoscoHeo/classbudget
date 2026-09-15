/**
 * app.js - SPA Router & App Initialization for ClassBudget
 * Hash-based routing, navigation, toast notifications
 */

const App = (() => {
  let currentPage = '';

  // === Router ===
  const routes = {
    '/': { render: () => Pages.renderDashboard(), init: () => Pages.initDashboard(), nav: 'dashboard' },
    '/add': { render: () => Pages.renderAddReceipt(), init: () => Pages.initAddReceipt(), nav: 'add' },
    '/list': { render: () => Pages.renderReceiptList(), init: () => Pages.initReceiptList(), nav: 'list' },
    '/settings': { render: () => Pages.renderSettings(), init: () => Pages.initSettings(), nav: 'settings' },
  };

  function navigate(hash) {
    let path = (hash || '#/').replace('#', '') || '/';
    let editId = null;

    // Handle /edit/:id route
    if (path.startsWith('/edit/')) {
      editId = path.split('/edit/')[1];
      path = '/edit';
    }

    let route;
    if (path === '/edit' && editId) {
      route = {
        render: () => Pages.renderAddReceipt(editId),
        init: () => Pages.initAddReceipt(),
        nav: 'add',
      };
    } else {
      route = routes[path] || routes['/'];
    }

    const appEl = document.getElementById('app');
    if (!appEl) return;

    if (Storage.isCloudView() && (path === '/add' || path === '/edit')) {
      appEl.innerHTML = '<div class="card"><h1 class="section-title">클라우드 자료는 읽기 전용입니다</h1><p>등록·수정 및 OCR은 상단의 ‘이 기기 로컬 자료’로 전환해서 사용해주세요. 로컬 변경은 클라우드에 반영되지 않습니다.</p></div>';
      updateNav('add');
      return;
    }

    // Render page
    appEl.innerHTML = route.render();
    route.init();

    if (Storage.isCloudView() && path === '/settings') {
      appEl.querySelectorAll('input, select, textarea, button:not(#btn-export-json)').forEach(element => { element.disabled = true; });
      appEl.querySelectorAll('.settings-section').forEach(section => {
        if (section.querySelector('#setting-gemini-key, #btn-clear-all') || section.textContent.includes('로컬 데이터 보관 안내')) section.hidden = true;
      });
      const info = appEl.querySelector('.settings-info');
      if (info) info.textContent = '현재 계정의 클라우드 자료 · 읽기 전용. JSON 내보내기도 현재 클라우드 텍스트 자료를 사용합니다.';
    }

    // Update nav active state
    updateNav(route.nav);
    currentPage = path;

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateNav(activePage) {
    document.querySelectorAll('.nav__link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === activePage);
    });
  }

  // === Toast ===
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3200);
  }

  // === Scroll shadow for nav ===
  function initScrollShadow() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    window.addEventListener('scroll', () => {
      nav.classList.toggle('nav--scrolled', window.scrollY > 10);
    }, { passive: true });
  }

  // === Init ===
  function init() {
    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      navigate(window.location.hash);
    });

    // Init scroll shadow
    initScrollShadow();

    // Request permanent local storage permission (prevents automatic browser deletion)
    if (typeof Storage !== 'undefined' && Storage.requestPersistStorage) {
      Storage.requestPersistStorage();
    }

    // Initial route
    navigate(window.location.hash || '#/');
  }

  // Boot the app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    navigate,
    showToast,
  };
})();
