import { firebaseConfig } from './firebase-config.js';
import { attachMigration } from './local-migration.js';
import { attachCloudReader } from './cloud-reader.js';

// Login never migrates data. The separate migration UI requires confirmation.
const status = document.getElementById('account-status');
const identity = document.getElementById('account-identity');
const uidRow = document.getElementById('account-uid-row');
const uid = document.getElementById('account-uid');
const login = document.getElementById('account-login');
const logout = document.getElementById('account-logout');

function errorMessage(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '로그인이 취소되었습니다. 기존 로컬 기능은 계속 사용할 수 있습니다.';
    case 'auth/popup-blocked':
      return '브라우저에서 팝업을 허용한 뒤 Google 로그인을 다시 눌러주세요.';
    case 'auth/unauthorized-domain':
      return 'Firebase Authentication의 승인된 도메인에 현재 사이트를 등록해주세요.';
    case 'auth/operation-not-allowed':
      return 'Firebase 콘솔에서 Google 로그인 제공자를 활성화해주세요.';
    case 'auth/network-request-failed':
      return '인터넷 연결을 확인해주세요. 기존 로컬 자료는 그대로 유지됩니다.';
    case 'auth/invalid-api-key':
    case 'auth/invalid-app-credential':
      return 'Firebase 웹 앱 설정을 확인해주세요.';
    default:
      return '계정 연결을 완료하지 못했습니다. 연결 상태와 Firebase 설정을 확인하고 다시 시도해주세요.';
  }
}

async function initializeAuthentication() {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  if (!required.every(key => typeof firebaseConfig[key] === 'string' && firebaseConfig[key].trim())) {
    status.textContent = 'Firebase 연결 설정 전입니다. 현재는 기존 로컬 모드로 사용할 수 있습니다.';
    return;
  }

  try {
    const [appSdk, authSdk] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
    ]);
    const app = appSdk.initializeApp(firebaseConfig, 'classbudget-auth');
    const auth = authSdk.getAuth(app);
    const renderMigration = attachMigration({ app, auth });
    const readCloud = attachCloudReader({ app, auth });
    auth.languageCode = 'ko';
    const provider = new authSdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    let ready = false;
    let busy = false;

    function renderAccount(user) {
      login.hidden = Boolean(user);
      logout.hidden = !user;
      login.disabled = !ready || busy;
      logout.disabled = !ready || busy;
      identity.hidden = !user;
      uidRow.hidden = !user;
      identity.textContent = user ? (user.email || user.displayName || 'Google 사용자') : '';
      uid.textContent = user ? user.uid : '';
    }

    // Account transitions clear only that account's device scope; legacy local data stays separate.
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    authSdk.onAuthStateChanged(auth, user => {
      ready = true;
      Pages.resetSensitiveState(true);
      const previousSession = Storage.sessionVersion();
      try { Storage.switchAccount(user?.uid); }
      catch {
        renderAccount(null); renderMigration(null); void readCloud(null);
        status.textContent = '기기 자료 정리에 실패했습니다. 공용 PC 사용을 마치기 전에 브라우저 사이트 데이터를 삭제해주세요.';
        document.getElementById('app').replaceChildren(); return;
      }
      if (previousSession !== Storage.sessionVersion()) window.history.replaceState(null, '', '#/');
      renderAccount(user);
      renderMigration(user);
      void readCloud(user);
      status.textContent = user ? '로그인되었습니다. 최초 이전은 버튼을 눌러 확인한 경우에만 실행됩니다.' : '로그아웃 상태입니다. 기존 로컬 기능을 사용할 수 있습니다.';
    }, error => {
      ready = false;
      Pages.resetSensitiveState(true);
      try { Storage.switchAccount(null); } catch { document.getElementById('app').replaceChildren(); }
      renderAccount(null);
      renderMigration(null);
      void readCloud(null);
      status.textContent = errorMessage(error);
    });

    login.addEventListener('click', async () => {
      if (!ready || busy) return;
      if (!confirm('로그인 중에는 계정별 기기 자료를 사용합니다. 기존 로컬 전용 자료는 자동으로 가져오지 않습니다. 이전하려면 먼저 JSON 백업을 받으세요. 계정의 기기 자료는 로그아웃 시 삭제되며 클라우드 문서는 유지됩니다. 계속할까요?')) return;
      busy = true;
      renderAccount(auth.currentUser);
      status.textContent = 'Google 로그인을 진행하고 있습니다.';
      try {
        await authSdk.signInWithPopup(auth, provider);
      } catch (error) {
        status.textContent = errorMessage(error);
      } finally {
        busy = false;
        renderAccount(auth.currentUser);
      }
    });

    logout.addEventListener('click', async () => {
      if (!ready || busy) return;
      busy = true;
      renderAccount(auth.currentUser);
      if (!confirm('이 계정의 기기 영수증·설정·첨부·API 키를 삭제하고 로그아웃합니다. 클라우드 문서와 기존 로컬 전용 자료, 이미 내려받은 파일은 삭제하지 않습니다. 필요한 기기 자료는 먼저 JSON 백업하세요. 계속할까요?')) { busy = false; renderAccount(auth.currentUser); return; }
      status.textContent = '로그아웃하고 있습니다.';
      try {
        await authSdk.signOut(auth);
      } catch (error) {
        status.textContent = errorMessage(error);
      } finally {
        busy = false;
        renderAccount(auth.currentUser);
      }
    });
  } catch (error) {
    login.disabled = true;
    logout.hidden = true;
    status.textContent = errorMessage(error);
  }
}

void initializeAuthentication();
