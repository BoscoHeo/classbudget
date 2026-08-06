/**
 * ClassBudget - Firebase Sync Module
 * Handles cloud synchronization with Firebase Firestore using PIN-based access.
 */
const FirebaseSync = (function() {
    // Firebase Configuration
    const firebaseConfig = {
        apiKey: "AIzaSyBr-8m2OI_WNVdWzFn4Pwjo7ZG4Ul-VBbM",
        authDomain: "classbudget-31df5.firebaseapp.com",
        projectId: "classbudget-31df5",
        storageBucket: "classbudget-31df5.firebasestorage.app",
        messagingSenderId: "645436560495",
        appId: "1:645436560495:web:a9030382af88cc9810a99a"
    };

    let db = null;
    let currentPinHash = null;
    let isSyncing = false;
    let syncTimer = null;
    let lastSyncTime = null;

    const PIN_HASH_KEY = 'classbudget_pin_hash';
    const LAST_SYNC_KEY = 'classbudget_last_sync';
    const RECEIPTS_KEY = 'classbudget_receipts';
    const SETTINGS_KEY = 'classbudget_settings';

    /**
     * 간단한 해시 함수 생성 (Java의 String.hashCode()와 유사)
     * @param {string} str 
     * @returns {number}
     */
    function simpleHash(str) {
        let hash = 0;
        if (str.length === 0) return hash;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }

    /**
     * PIN 번호를 기반으로 고유한 문서 ID(해시) 생성
     * @param {string} pin 
     * @returns {string}
     */
    function hashPin(pin) {
        const rawString = 'classbudget_' + pin;
        const hash = Math.abs(simpleHash(rawString));
        return 'budget_' + hash.toString(36);
    }

    /**
     * PIN 번호 유효성 검사 (4~8자리 영문/숫자)
     * @param {string} pin 
     * @returns {boolean}
     */
    function validatePin(pin) {
        const regex = /^[a-zA-Z0-9]{4,8}$/;
        return regex.test(pin);
    }

    /**
     * UI 오류 메시지 표시
     * @param {string} message 
     */
    function showError(message) {
        const errorEl = document.getElementById('pin-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    /**
     * UI 오류 메시지 숨기기
     */
    function hideError() {
        const errorEl = document.getElementById('pin-error');
        if (errorEl) {
            errorEl.style.display = 'none';
            errorEl.textContent = '';
        }
    }

    /**
     * Toast 메시지 표시 (임시 구현, 앱의 Toast 함수 호출 권장)
     * @param {string} message 
     */
    function showToast(message) {
        if (window.App && App.showToast) {
            App.showToast(message);
        } else {
            console.log('Toast:', message);
            // alert(message); // 방해가 될 수 있으므로 생략
        }
    }

    /**
     * Firebase 및 동기화 초기화
     * @returns {boolean} 저장된 PIN이 있어 자동 동기화를 시작했는지 여부
     */
    function init() {
        try {
            // Firebase 앱 초기화 확인
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            db = firebase.firestore();
            
            // 로컬 스토리지에서 PIN 해시 및 마지막 동기화 시간 확인
            const savedPinHash = localStorage.getItem(PIN_HASH_KEY);
            const savedSyncTime = localStorage.getItem(LAST_SYNC_KEY);
            
            if (savedSyncTime) {
                lastSyncTime = new Date(parseInt(savedSyncTime, 10));
            }

            if (savedPinHash) {
                currentPinHash = savedPinHash;
                syncFromCloud(); // 비동기 호출 (결과 기다리지 않음)
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Firebase 초기화 오류:', error);
            return false;
        }
    }

    /**
     * PIN 입력 화면 표시 및 이벤트 바인딩
     */
    function showPinScreen() {
        const overlay = document.getElementById('pin-overlay');
        if (!overlay) return;
        
        overlay.style.display = 'flex';
        overlay.style.opacity = '1';
        hideError();

        // 약간의 딜레이 후 이벤트 바인딩 및 포커스
        setTimeout(() => {
            const input = document.getElementById('pin-input');
            const btnAccess = document.getElementById('btn-pin-access');
            const btnCreate = document.getElementById('btn-pin-create');
            const btnSkip = document.getElementById('btn-pin-skip');

            if (input) {
                input.value = '';
                input.focus();
                
                // Enter 키 이벤트 바인딩 해제 후 재바인딩
                input.onkeypress = null;
                input.onkeypress = function(e) {
                    if (e.key === 'Enter') {
                        btnAccess.click();
                    }
                };
            }

            if (btnAccess) {
                btnAccess.onclick = async function() {
                    const pin = input ? input.value.trim() : '';
                    if (!validatePin(pin)) {
                        showError('PIN 번호는 4~8자리의 영문 또는 숫자여야 합니다.');
                        return;
                    }

                    hideError();
                    const hash = hashPin(pin);
                    const originalText = btnAccess.textContent;
                    
                    try {
                        btnAccess.disabled = true;
                        if (btnCreate) btnCreate.disabled = true;
                        btnAccess.textContent = '🔄 확인 중...';

                        // Firestore에서 문서 존재 여부 확인
                        const docRef = db.collection('classbudget_data').doc(hash);
                        const docSnap = await docRef.get();

                        if (docSnap.exists) {
                            currentPinHash = hash;
                            localStorage.setItem(PIN_HASH_KEY, currentPinHash);
                            
                            // 클라우드에서 데이터 가져오기
                            await syncFromCloud();
                            
                            hidePinScreen();
                            showToast('클라우드 데이터와 동기화되었습니다.');
                            
                            if (window.App && App.navigate) {
                                App.navigate('#/');
                            }
                        } else {
                            if (confirm(`PIN [${pin}]으로 저장된 클라우드 데이터가 없습니다.\n지금 이 PIN으로 새 클라우드 공간을 생성하시겠습니까?`)) {
                                currentPinHash = hash;
                                localStorage.setItem(PIN_HASH_KEY, currentPinHash);
                                await syncToCloud();
                                hidePinScreen();
                                showToast('새 클라우드 공간이 생성되었습니다.');
                                if (window.App && App.navigate) App.navigate('#/');
                            }
                        }
                    } catch (error) {
                        console.error('데이터 접근 오류:', error);
                        const msg = error && error.message ? error.message : '데이터에 접근하는 중 오류가 발생했습니다.';
                        showError('오류: ' + msg);
                    } finally {
                        btnAccess.disabled = false;
                        if (btnCreate) btnCreate.disabled = false;
                        btnAccess.textContent = originalText;
                    }
                };
            }

            if (btnCreate) {
                btnCreate.onclick = async function() {
                    const pin = input ? input.value.trim() : '';
                    if (!validatePin(pin)) {
                        showError('PIN 번호는 4~8자리의 영문 또는 숫자여야 합니다.');
                        return;
                    }

                    hideError();
                    const hash = hashPin(pin);
                    const originalText = btnCreate.textContent;
                    
                    try {
                        if (btnAccess) btnAccess.disabled = true;
                        btnCreate.disabled = true;
                        btnCreate.textContent = '🔄 생성 중...';

                        // Firestore에서 문서 존재 여부 확인
                        const docRef = db.collection('classbudget_data').doc(hash);
                        const docSnap = await docRef.get();

                        if (docSnap.exists) {
                            currentPinHash = hash;
                            localStorage.setItem(PIN_HASH_KEY, currentPinHash);
                            await syncFromCloud();
                            hidePinScreen();
                            showToast('클라우드 데이터와 동기화되었습니다.');
                            if (window.App && App.navigate) App.navigate('#/');
                        } else {
                            currentPinHash = hash;
                            localStorage.setItem(PIN_HASH_KEY, currentPinHash);
                            await syncToCloud();
                            hidePinScreen();
                            showToast('새 클라우드 공간이 생성되었습니다.');
                            if (window.App && App.navigate) App.navigate('#/');
                        }
                    } catch (error) {
                        console.error('데이터 생성 오류:', error);
                        const msg = error && error.message ? error.message : '데이터를 생성하는 중 오류가 발생했습니다.';
                        showError('오류: ' + msg);
                    } finally {
                        if (btnAccess) btnAccess.disabled = false;
                        btnCreate.disabled = false;
                        btnCreate.textContent = originalText;
                    }
                };
            }

            if (btnSkip) {
                btnSkip.onclick = function() {
                    hidePinScreen();
                    showToast('오프라인 모드로 시작합니다.');
                };
            }
            
        }, 100);
    }

    /**
     * PIN 입력 화면 숨기기
     */
    function hidePinScreen() {
        const overlay = document.getElementById('pin-overlay');
        if (!overlay) return;
        
        overlay.style.opacity = '0';
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'auto';
    }

    /**
     * 클라우드(Firestore)로 데이터 동기화
     */
    async function syncToCloud() {
        if (!db || !currentPinHash || isSyncing) return;
        
        isSyncing = true;
        
        try {
            // 로컬 데이터 읽기
            const rawReceipts = localStorage.getItem(RECEIPTS_KEY);
            const rawSettings = localStorage.getItem(SETTINGS_KEY);
            
            let receipts = [];
            if (rawReceipts) {
                try {
                    receipts = JSON.parse(rawReceipts);
                } catch (e) {
                    console.error('영수증 데이터 파싱 오류', e);
                }
            }
            
            let settings = {};
            if (rawSettings) {
                try {
                    settings = JSON.parse(rawSettings);
                } catch (e) {
                    console.error('설정 데이터 파싱 오류', e);
                }
            }

            // 클라우드 업로드를 위해 크기가 큰 데이터(이미지) 및 민감한 데이터(API키) 제거
            const strippedReceipts = receipts.map(receipt => {
                const cloned = { ...receipt };
                if (cloned.imageData) {
                    cloned.hasImage = true;
                    delete cloned.imageData;
                }
                return cloned;
            });
            
            const strippedSettings = { ...settings };
            if (strippedSettings.geminiApiKey) {
                delete strippedSettings.geminiApiKey;
            }

            const payload = {
                receipts: JSON.stringify(strippedReceipts),
                settings: JSON.stringify(strippedSettings),
                lastSync: firebase.firestore.Timestamp.now(),
                receiptCount: strippedReceipts.length,
                updatedAt: firebase.firestore.Timestamp.now()
            };

            // Firestore에 저장 (병합 모드)
            await db.collection('classbudget_data').doc(currentPinHash).set(payload, { merge: true });
            
            // 마지막 동기화 시간 업데이트
            lastSyncTime = new Date();
            localStorage.setItem(LAST_SYNC_KEY, lastSyncTime.getTime().toString());
            
            updateSyncStatusUI();
            
        } catch (error) {
            console.error('클라우드 동기화 오류:', error);
        } finally {
            isSyncing = false;
        }
    }

    /**
     * 클라우드(Firestore)에서 데이터 가져오기
     */
    async function syncFromCloud() {
        if (!db || !currentPinHash || isSyncing) return;
        
        isSyncing = true;
        
        try {
            const docRef = db.collection('classbudget_data').doc(currentPinHash);
            const docSnap = await docRef.get();
            
            if (docSnap.exists) {
                const data = docSnap.data();
                
                // 로컬 데이터 준비 (이미지 및 API 키 보존용)
                const rawLocalReceipts = localStorage.getItem(RECEIPTS_KEY);
                const rawLocalSettings = localStorage.getItem(SETTINGS_KEY);
                
                let localReceiptMap = {};
                if (rawLocalReceipts) {
                    try {
                        const localReceipts = JSON.parse(rawLocalReceipts);
                        localReceipts.forEach(r => {
                            if (r.imageData) {
                                localReceiptMap[r.id] = r.imageData;
                            }
                        });
                    } catch (e) {}
                }
                
                let localGeminiKey = '';
                if (rawLocalSettings) {
                    try {
                        const localSettings = JSON.parse(rawLocalSettings);
                        if (localSettings.geminiApiKey) {
                            localGeminiKey = localSettings.geminiApiKey;
                        }
                    } catch (e) {}
                }

                // 클라우드 데이터 파싱 및 로컬 데이터와 병합
                if (data.receipts) {
                    try {
                        const cloudReceipts = JSON.parse(data.receipts);
                        // 이미지 데이터 복원
                        const mergedReceipts = cloudReceipts.map(r => {
                            if (r.hasImage && localReceiptMap[r.id]) {
                                r.imageData = localReceiptMap[r.id];
                            }
                            return r;
                        });
                        localStorage.setItem(RECEIPTS_KEY, JSON.stringify(mergedReceipts));
                    } catch (e) {
                        console.error('클라우드 영수증 데이터 파싱 오류:', e);
                    }
                }
                
                if (data.settings) {
                    try {
                        const cloudSettings = JSON.parse(data.settings);
                        // API 키 복원
                        if (localGeminiKey) {
                            cloudSettings.geminiApiKey = localGeminiKey;
                        }
                        localStorage.setItem(SETTINGS_KEY, JSON.stringify(cloudSettings));
                    } catch (e) {
                        console.error('클라우드 설정 데이터 파싱 오류:', e);
                    }
                }

                lastSyncTime = new Date();
                localStorage.setItem(LAST_SYNC_KEY, lastSyncTime.getTime().toString());
                
                updateSyncStatusUI();
                
                // 데이터가 변경되었으므로 화면 갱신 (Storage 모듈이 있다면 loadData 호출)
                if (window.Storage && typeof Storage.loadData === 'function') {
                    Storage.loadData();
                }
            }
        } catch (error) {
            console.error('클라우드 데이터 다운로드 오류:', error);
        } finally {
            isSyncing = false;
        }
    }

    /**
     * 클라우드 동기화 예약 (디바운싱 적용)
     */
    function scheduleSyncToCloud() {
        if (!currentPinHash) return; // 연결되지 않은 경우 무시
        
        if (syncTimer) {
            clearTimeout(syncTimer);
        }
        
        syncTimer = setTimeout(() => {
            syncToCloud();
        }, 1500);
    }

    /**
     * 동기화 상태 UI 업데이트
     */
    function updateSyncStatusUI() {
        const statusTextEl = document.getElementById('sync-status-text');
        const indicatorEl = document.getElementById('sync-indicator');
        
        if (statusTextEl && lastSyncTime) {
            statusTextEl.textContent = lastSyncTime.toLocaleString('ko-KR');
        }
        
        if (indicatorEl) {
            indicatorEl.classList.add('sync-indicator--synced');
            
            // 약간의 딜레이 후 클래스 제거 (필요시)
            setTimeout(() => {
                indicatorEl.classList.remove('sync-indicator--synced');
            }, 2000);
        }
    }

    /**
     * 현재 동기화 정보 반환
     * @returns {Object} 동기화 상태 및 정보
     */
    function getSyncInfo() {
        return {
            isConnected: !!currentPinHash,
            lastSyncTime: lastSyncTime,
            pinHash: currentPinHash
        };
    }

    /**
     * 동기화 연결 해제 (PIN 정보 삭제)
     */
    function disconnect() {
        currentPinHash = null;
        localStorage.removeItem(PIN_HASH_KEY);
        // lastSyncTime = null; 
        // localStorage.removeItem(LAST_SYNC_KEY); // 기존 동기화 시간 유지 가능
        
        const statusTextEl = document.getElementById('sync-status-text');
        if (statusTextEl) {
            statusTextEl.textContent = '연결 해제됨';
        }
    }

    /**
     * 수동으로 강제 동기화 실행
     * @returns {Promise<Object>} 성공 여부와 에러 객체
     */
    async function forceSync() {
        if (!currentPinHash) {
            return { success: false, error: '동기화가 설정되어 있지 않습니다.' };
        }
        
        try {
            await syncToCloud();
            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: error };
        }
    }

    // Public API 반환
    return {
        init,
        showPinScreen,
        hidePinScreen,
        syncToCloud,
        syncFromCloud,
        scheduleSyncToCloud,
        updateSyncStatusUI,
        getSyncInfo,
        disconnect,
        forceSync,
        // 테스트/디버깅 용도
        validatePin,
        hashPin
    };
})();
