/**
 * app.js - SPA Router & App Initialization for ClassBudget
 * Hash-based routing, navigation, toast notifications
 */

const App = (() => {
  let currentPage = '';

  // === Router ===
  const routes = {
    '/': {
      render: () =>
        Pages.renderDashboard(),
      init: () =>
        Pages.initDashboard(),
      nav: 'dashboard',
    },

    '/add': {
      render: () =>
        Pages.renderAddReceipt(),
      init: () =>
        Pages.initAddReceipt(),
      nav: 'add',
    },

    '/list': {
      render: () =>
        Pages.renderReceiptList(),
      init: () =>
        Pages.initReceiptList(),
      nav: 'list',
    },

    '/settings': {
      render: () =>
        Pages.renderSettings(),
      init: () =>
        Pages.initSettings(),
      nav: 'settings',
    },
  };

  function navigate(hash) {
    let path =
      (hash || '#/')
        .replace('#', '') ||
      '/';

    let editId = null;

    if (
      path.startsWith('/edit/')
    ) {
      editId =
        path.split(
          '/edit/'
        )[1];

      path = '/edit';
    }

    let route;

    if (
      path === '/edit' &&
      editId
    ) {
      route = {
        render: () =>
          Pages.renderAddReceipt(
            editId
          ),

        init: () =>
          Pages.initAddReceipt(),

        nav: 'add',
      };
    } else {
      route =
        routes[path] ||
        routes['/'];
    }

    const appEl =
      document.getElementById(
        'app'
      );

    if (!appEl) {
      return;
    }

    appEl.innerHTML =
      route.render();

    route.init();

    // Cloud settings mode:
    // general settings are editable,
    // Gemini key/local destructive actions remain local-only.
    if (
      Storage.isCloudView() &&
      path === '/settings'
    ) {
      appEl
        .querySelectorAll(
          '.settings-section'
        )
        .forEach(section => {
          if (
            section.querySelector(
              '#setting-gemini-key, #btn-clear-all'
            ) ||
            section.textContent.includes(
              '로컬 데이터 보관 안내'
            )
          ) {
            section.hidden = true;
          }
        });

      const importInput =
        appEl.querySelector(
          '#import-json-input'
        );

      const importLabel =
        appEl.querySelector(
          'label[for="import-json-input"]'
        );

      if (importInput) {
        importInput.hidden = true;
      }

      if (importLabel) {
        importLabel.hidden = true;
      }

      const form =
        appEl.querySelector(
          '#settings-form'
        );

      if (form) {
        form.addEventListener(
          'submit',
          async event => {
            // Prevent the existing local settings submit listener
            // registered by Pages.initSettings().
            event.preventDefault();
            event.stopImmediatePropagation();

            const submitButton =
              form.querySelector(
                'button[type="submit"]'
              );

            if (submitButton) {
              submitButton.disabled =
                true;
            }

            const current =
              Storage.getSettings();

            const settings = {
              ...current,

              budgetName:
                document
                  .getElementById(
                    'setting-budget-name'
                  )
                  .value.trim(),

              totalBudget:
                Number(
                  document
                    .getElementById(
                      'setting-total-budget'
                    )
                    .value
                ) || 0,

              schoolName:
                document
                  .getElementById(
                    'setting-school-name'
                  )
                  .value.trim(),

              className:
                document
                  .getElementById(
                    'setting-class-name'
                  )
                  .value.trim(),

              teacherName:
                document
                  .getElementById(
                    'setting-teacher-name'
                  )
                  .value.trim(),
            };

            try {
              await Storage.saveSettings(
                settings
              );

              showToast(
                '클라우드 설정이 저장되었습니다.',
                'success'
              );
            } catch {
              showToast(
                '클라우드 설정 저장에 실패했습니다. 다른 기기에서 변경했다면 최신 자료를 확인해주세요.',
                'error'
              );
            } finally {
              if (
                submitButton &&
                submitButton.isConnected
              ) {
                submitButton.disabled =
                  false;
              }
            }
          },
          true
        );
      }

      const info =
        appEl.querySelector(
          '.settings-info'
        );

      if (info) {
        info.innerHTML =
          '☁️ 현재 계정의 클라우드 자료입니다. 일반 설정은 실시간 동기화되며, Gemini API Key와 첨부파일은 기기 로컬에만 유지됩니다.';
      }
    }

    updateNav(route.nav);

    currentPage = path;

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  function updateNav(activePage) {
    document
      .querySelectorAll(
        '.nav__link'
      )
      .forEach(link => {
        link.classList.toggle(
          'active',
          link.dataset.page ===
            activePage
        );
      });
  }

  // === Toast ===
  function showToast(
    message,
    type = 'info'
  ) {
    const container =
      document.getElementById(
        'toast-container'
      );

    if (!container) {
      return;
    }

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
    };

    const toast =
      document.createElement(
        'div'
      );

    toast.className =
      `toast toast--${type}`;

    toast.innerHTML =
      `<span>${
        icons[type] ||
        icons.info
      }</span>` +
      `<span>${message}</span>`;

    container.appendChild(
      toast
    );

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(
          toast
        );
      }
    }, 3200);
  }

  // === Scroll shadow ===
  function initScrollShadow() {
    const nav =
      document.getElementById(
        'main-nav'
      );

    if (!nav) {
      return;
    }

    window.addEventListener(
      'scroll',
      () => {
        nav.classList.toggle(
          'nav--scrolled',
          window.scrollY > 10
        );
      },
      {
        passive: true,
      }
    );
  }

  // === Init ===
  function init() {
    window.addEventListener(
      'hashchange',
      () => {
        navigate(
          window.location.hash
        );
      }
    );

    initScrollShadow();

    if (
      typeof Storage !==
        'undefined' &&
      Storage.requestPersistStorage
    ) {
      Storage.requestPersistStorage();
    }

    navigate(
      window.location.hash ||
        '#/'
    );
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init
    );
  } else {
    init();
  }

  return {
    navigate,
    showToast,
  };
})();