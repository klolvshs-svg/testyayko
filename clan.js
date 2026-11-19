// clan.js — Модуль кланов (шторка, порядок кнопок, баланс 90 мл, чат + точки непрочитанных, live-онлайн)

(function () {
    const FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
    const AUTH_URL = "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    let fsApi = null;
    let authApi = null;
    let clanPageOpen = false;
    let currentClanUnsub = null;
    let chatUnsub = null;
    let membersLiveUnsubs = [];
    let heartbeatTimer = null;
    let currentClanData = null;
    let currentClanId = null;
    let viewedOtherClanId = null;
    let clanSubView = "hub"; // "hub" | "settings" | "chat" | "donate"
    let membersCache = new Map();
    let userClanCache = new Map();
    let pendingClanLookups = new Set();
    let createAvatarDataUrl = "";
    let editAvatarDataUrl = null;
    let liveTimerInterval = null;
    let decorAnimId = null;
    let friendsObserverAttached = false;

    // Состояние непрочитанных сообщений чата клана
    let unreadChatCount = 0;
    let knownMessageIds = new Set();
    let initialChatLoaded = false;

    function getActiveNick() {
        return (
            localStorage.getItem("egg_logged_in_nick") ||
            localStorage.getItem("egg_current_user") ||
            window.currentUserNick ||
            ""
        )
            .trim()
            .toLowerCase();
    }

    function getUnreadStorageKey(nick, clanId) {
        return `clan_unread_${nick || "anon"}_${clanId || "none"}`;
    }

    function loadSavedUnreadCount(nick, clanId) {
        try {
            const raw = localStorage.getItem(getUnreadStorageKey(nick, clanId));
            const num = parseInt(raw || "0", 10);
            return Number.isFinite(num) && num > 0 ? num : 0;
        } catch (_) {
            return 0;
        }
    }

    function saveUnreadCount(nick, clanId, count) {
        try {
            const safe = Math.max(0, parseInt(count || 0, 10) || 0);
            localStorage.setItem(getUnreadStorageKey(nick, clanId), String(safe));
        } catch (_) {}
    }

    async function getAuthMod() {
        if (authApi) return authApi;
        const mod = await import(AUTH_URL);
        authApi = {
            getAuth: mod.getAuth,
            signInAnonymously: mod.signInAnonymously
        };
        return authApi;
    }

    async function getFs() {
        if (fsApi) return fsApi;
        const mod = await import(FIRESTORE_URL);
        fsApi = {
            db: mod.getFirestore(),
            doc: mod.doc,
            getDoc: mod.getDoc,
            setDoc: mod.setDoc,
            addDoc: mod.addDoc,
            updateDoc: mod.updateDoc,
            deleteDoc: mod.deleteDoc,
            collection: mod.collection,
            query: mod.query,
            where: mod.where,
            orderBy: mod.orderBy,
            limit: mod.limit,
            getDocs: mod.getDocs,
            onSnapshot: mod.onSnapshot,
            runTransaction: mod.runTransaction,
            arrayUnion: mod.arrayUnion,
            arrayRemove: mod.arrayRemove,
            increment: mod.increment,
            serverTimestamp: mod.serverTimestamp
        };
        return fsApi;
    }

    async function ensureAuthSession() {
        const { getAuth, signInAnonymously } = await getAuthMod();
        const auth = getAuth();
        if (!auth.currentUser) {
            await signInAnonymously(auth);
        }
    }

    function isElementVisible(el) {
        if (!el) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) === 0) {
            return false;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        // Если элемент явно выдвинут за пределы экрана слева (закрытая шторка)
        if (rect.right <= 8) return false;
        return true;
    }

    function isProfileDrawerOpen() {
        const drawer = document.getElementById("profileDrawer");
        if (!drawer) return false;
        const hasOpenClass =
            drawer.classList.contains("open") ||
            drawer.classList.contains("active") ||
            drawer.classList.contains("show") ||
            drawer.classList.contains("visible");
        if (hasOpenClass) return true;
        return isElementVisible(drawer) && drawer.getBoundingClientRect().left >= -10;
    }

    function isShopOpen() {
        const candidates = [
            document.getElementById("shopModal"),
            document.getElementById("shopOverlay"),
            document.getElementById("shopScreen"),
            document.getElementById("storeModal"),
            document.getElementById("storeOverlay")
        ];
        for (const el of candidates) {
            if (el && isElementVisible(el)) return true;
        }
        return false;
    }

    function parseMlFromText(txt) {
        if (!txt) return null;
        const match = String(txt).replace(",", ".").match(/(-?\d+(?:\.\d+)?)\s*мл/i);
        if (match) {
            const val = parseFloat(match[1]);
            if (Number.isFinite(val)) return val;
        }
        return null;
    }

    function detectLocalPlayerMl(fsUserData = null) {
        const candidates = [];

        const winKeys = ["ml", "playerMl", "userMl", "currentMl", "mlBalance", "waterMl", "balanceMl"];
        for (const k of winKeys) {
            if (typeof window[k] === "number" && Number.isFinite(window[k])) {
                candidates.push(window[k]);
            }
        }

        if (fsUserData) {
            const fsKeys = ["ml", "milliliters", "mlBalance", "water", "balance"];
            for (const k of fsKeys) {
                if (typeof fsUserData[k] === "number" && Number.isFinite(fsUserData[k])) {
                    candidates.push(fsUserData[k]);
                }
            }
        }

        const lsKeys = ["egg_ml", "player_ml", "user_ml", "ml_balance", "ml"];
        for (const k of lsKeys) {
            const raw = localStorage.getItem(k);
            if (raw !== null && raw !== "") {
                const n = parseFloat(String(raw).replace(",", "."));
                if (Number.isFinite(n)) candidates.push(n);
            }
        }

        // Поиск в элементах HUD/профиля с подписью «мл»
        const selectors = [
            "#mlDisplay",
            "#playerMl",
            "#userMl",
            "#balanceMl",
            "#mlValue",
            ".ml-value",
            ".player-ml",
            "[data-ml]"
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const attrVal = el.getAttribute("data-ml");
                if (attrVal !== null) {
                    const n = parseFloat(String(attrVal).replace(",", "."));
                    if (Number.isFinite(n)) candidates.push(n);
                }
                const parsed = parseMlFromText(el.textContent);
                if (parsed !== null) candidates.push(parsed);
            }
        }

        // Если в кэшированных полях есть точное число больше 0 — берём его
        for (const v of candidates) {
            if (v > 0) return Math.round(v * 1000) / 1000;
        }
        if (candidates.length > 0) {
            return Math.max(0, Math.round(candidates[0] * 1000) / 1000);
        }
        return 0;
    }

    function syncLocalPlayerMlDown(amount, fsUserData = null) {
        const winKeys = ["ml", "playerMl", "userMl", "currentMl", "mlBalance", "waterMl", "balanceMl"];
        for (const k of winKeys) {
            if (typeof window[k] === "number" && Number.isFinite(window[k])) {
                window[k] = Math.max(0, Math.round((window[k] - amount) * 1000) / 1000);
            }
        }
        const lsKeys = ["egg_ml", "player_ml", "user_ml", "ml_balance", "ml"];
        for (const k of lsKeys) {
            const raw = localStorage.getItem(k);
            if (raw !== null && raw !== "") {
                const n = parseFloat(String(raw).replace(",", "."));
                if (Number.isFinite(n)) {
                    localStorage.setItem(k, String(Math.max(0, Math.round((n - amount) * 1000) / 1000)));
                }
            }
        }
        if (fsUserData) {
            const fsKeys = ["ml", "milliliters", "mlBalance", "water", "balance"];
            for (const k of fsKeys) {
                if (typeof fsUserData[k] === "number") {
                    fsUserData[k] = Math.max(0, Math.round((fsUserData[k] - amount) * 1000) / 1000);
                }
            }
        }
    }

    function injectStyles() {
        if (document.getElementById("clanModuleStyles")) return;
        const style = document.createElement("style");
        style.id = "clanModuleStyles";
        style.textContent = `
            #openClanBtn {
                position: fixed;
                top: 15px;
                right: 15px;
                background: rgba(24, 34, 45, 0.72);
                color: #e2e8f0;
                border: 1px solid rgba(148, 163, 184, 0.28);
                height: 44px;
                padding: 0 16px;
                border-radius: 12px;
                cursor: pointer;
                z-index: 25;
                display: none;
                align-items: center;
                justify-content: center;
                gap: 6px;
                font-size: 14px;
                font-weight: bold;
                outline: none;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
                transition: transform 0.1s, background 0.2s, border-color 0.2s;
                -webkit-tap-highlight-color: transparent;
            }
            #openClanBtn:active {
                transform: scale(0.95);
            }
            #openClanBtn.has-unread {
                border-color: #ef4444;
                box-shadow: 0 0 12px rgba(239, 68, 68, 0.55);
            }
            .clan-red-dot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: #ef4444;
                box-shadow: 0 0 6px rgba(239, 68, 68, 0.9);
                display: inline-block;
                flex-shrink: 0;
            }

            /* Карточка друга */
            #friendsResultsContainer .user-result-card {
                min-height: 78px !important;
                padding: 10px 12px !important;
                align-items: center !important;
                box-sizing: border-box !important;
            }
            .clan-badge-link {
                display: inline-block;
                margin-top: 5px;
                padding: 3px 9px;
                border-radius: 7px;
                background: rgba(56, 189, 248, 0.16);
                border: 1px solid rgba(56, 189, 248, 0.45);
                color: #7dd3fc;
                font-size: 11px;
                font-weight: bold;
                cursor: pointer;
                line-height: 1.2;
                max-width: 100%;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .clan-badge-link:hover {
                background: rgba(56, 189, 248, 0.28);
            }
            .clan-badge-none {
                display: inline-block;
                margin-top: 5px;
                padding: 3px 9px;
                border-radius: 7px;
                background: rgba(148, 163, 184, 0.12);
                border: 1px solid rgba(148, 163, 184, 0.25);
                color: #94a3b8;
                font-size: 11px;
                font-weight: 600;
                line-height: 1.2;
            }
            @media (max-width: 480px) {
                #friendsResultsContainer .user-result-card {
                    min-height: 84px !important;
                    padding: 9px 10px !important;
                }
                .clan-badge-link,
                .clan-badge-none {
                    font-size: 10px;
                    padding: 2px 7px;
                }
            }

            #clanPageOverlay {
                position: fixed;
                inset: 0;
                width: 100vw;
                height: 100vh;
                background: #0f1721;
                z-index: 60;
                display: none;
                flex-direction: column;
                overflow: hidden;
                color: #fff;
                box-sizing: border-box;
            }
            #clanBgCanvas {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 1;
            }
            #clanBackBtn {
                position: fixed;
                top: 16px;
                left: 16px;
                z-index: 70;
                background: rgba(55, 65, 81, 0.65);
                color: #f3f4f6;
                border: 1px solid rgba(255, 255, 255, 0.16);
                padding: 9px 16px;
                border-radius: 10px;
                font-size: 14px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
                transition: transform 0.1s, background 0.2s;
            }
            #clanBackBtn:active {
                transform: scale(0.95);
                background: rgba(75, 85, 99, 0.8);
            }

            .clan-scroll-container {
                position: relative;
                z-index: 5;
                width: 100%;
                height: 100%;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                padding: 68px 14px 28px 14px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
            }

            .clan-no-clan-box {
                width: 100%;
                max-width: 440px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 14px;
                margin-top: 24px;
            }

            .clan-search-panel {
                width: 100%;
                background: rgba(15, 23, 33, 0.72);
                border: 1px solid rgba(148, 163, 184, 0.25);
                border-radius: 14px;
                padding: 14px;
                box-sizing: border-box;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
            }

            .clan-input {
                width: 100%;
                box-sizing: border-box;
                background: rgba(15, 23, 33, 0.78);
                border: 1px solid rgba(148, 163, 184, 0.32);
                color: #fff;
                padding: 11px 13px;
                border-radius: 10px;
                font-size: 14px;
                outline: none;
            }
            .clan-input:focus {
                border-color: rgba(148, 163, 184, 0.7);
            }

            .clan-create-btn {
                width: 100%;
                background: rgba(30, 41, 59, 0.72);
                color: #f1f5f9;
                border: 1px solid rgba(148, 163, 184, 0.3);
                padding: 14px 20px;
                border-radius: 12px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 6px 18px rgba(0, 0, 0, 0.38);
                transition: transform 0.1s, background 0.2s, border-color 0.2s;
            }
            .clan-create-btn:hover {
                background: rgba(51, 65, 85, 0.82);
                border-color: rgba(148, 163, 184, 0.48);
            }
            .clan-create-btn:active {
                transform: scale(0.97);
            }

            .clan-card-item {
                background: rgba(24, 34, 45, 0.82);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 10px;
                margin-top: 8px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                cursor: pointer;
                transition: background 0.15s;
            }
            .clan-card-item:hover {
                background: rgba(30, 41, 59, 0.92);
            }

            .clan-square-ava {
                width: 92px;
                height: 92px;
                border-radius: 0 !important;
                object-fit: cover;
                border: 2px solid rgba(148, 163, 184, 0.45);
                background: rgba(24, 34, 45, 0.82);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 38px;
                flex-shrink: 0;
            }
            .clan-square-ava-sm {
                width: 44px;
                height: 44px;
                border-radius: 0 !important;
                object-fit: cover;
                border: 1px solid rgba(255, 255, 255, 0.22);
                background: rgba(15, 23, 33, 0.82);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                flex-shrink: 0;
            }

            .clan-hub-box {
                width: 100%;
                max-width: 460px;
                background: rgba(15, 23, 33, 0.82);
                border: 1px solid rgba(148, 163, 184, 0.25);
                border-radius: 16px;
                padding: 16px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
            }

            .clan-name-green {
                color: #4ade80;
                font-size: 23px;
                font-weight: bold;
                margin: 10px 0 4px 0;
                text-align: center;
                word-break: break-word;
            }
            .clan-ml-blue {
                color: #38bdf8;
                font-size: 16px;
                font-weight: bold;
                margin-bottom: 6px;
                text-align: center;
            }
            .clan-desc-text {
                color: #cbd5e1;
                font-size: 13px;
                text-align: center;
                margin-bottom: 12px;
                line-height: 1.4;
                word-break: break-word;
            }

            /* Горизонтальный ряд кнопок: [⚙️] [Вложить] [Чат] [Выйти] */
            .clan-toolbar-row {
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                flex-wrap: nowrap;
                margin-bottom: 12px;
            }
            .clan-mini-btn {
                position: relative;
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 9px;
                padding: 7px 9px;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                color: #fff;
                white-space: nowrap;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                transition: transform 0.1s, opacity 0.2s;
            }
            .clan-mini-btn:active {
                transform: scale(0.95);
            }
            .clan-gear-btn {
                width: 34px;
                height: 32px;
                padding: 0;
                font-size: 15px;
                flex-shrink: 0;
            }
            .clan-chat-corner-dot {
                position: absolute;
                top: -3px;
                right: -3px;
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: #ef4444;
                border: 1px solid #0f1721;
                box-shadow: 0 0 6px rgba(239, 68, 68, 0.95);
                display: none;
            }

            .clan-members-box {
                width: 100%;
                background: rgba(51, 65, 85, 0.42);
                border: 1px solid rgba(148, 163, 184, 0.22);
                border-radius: 12px;
                padding: 10px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-top: 6px;
            }
            .clan-member-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                background: rgba(15, 23, 33, 0.7);
                border-radius: 10px;
                padding: 8px 10px;
                text-align: left;
            }
            .clan-member-ava {
                width: 34px;
                height: 34px;
                border-radius: 50%;
                object-fit: cover;
                border: 1px solid #94a3b8;
                flex-shrink: 0;
            }

            .clan-action-btn {
                border: none;
                border-radius: 10px;
                padding: 9px 14px;
                font-size: 13px;
                font-weight: bold;
                cursor: pointer;
                color: #fff;
                transition: transform 0.1s, opacity 0.2s;
            }
            .clan-action-btn:active {
                transform: scale(0.96);
            }

            /* Групповой чат клана */
            .clan-chat-header {
                width: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 3px;
                margin-bottom: 10px;
            }
            .clan-chat-title {
                font-size: 19px;
                font-weight: bold;
                color: #4ade80;
                text-align: center;
                word-break: break-word;
            }
            .clan-chat-online {
                font-size: 12px;
                font-weight: bold;
                color: #38bdf8;
                text-align: center;
            }
            .clan-chat-messages {
                width: 100%;
                height: 320px;
                max-height: 52vh;
                overflow-y: auto;
                background: rgba(10, 16, 24, 0.75);
                border: 1px solid rgba(148, 163, 184, 0.22);
                border-radius: 12px;
                padding: 10px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                gap: 9px;
                margin-bottom: 10px;
            }
            .clan-chat-msg {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                background: rgba(30, 41, 59, 0.65);
                border-radius: 10px;
                padding: 7px 9px;
                text-align: left;
            }
            .clan-chat-msg.mine {
                background: rgba(14, 116, 144, 0.35);
                border: 1px solid rgba(56, 189, 248, 0.28);
            }
            .clan-chat-ava {
                width: 30px;
                height: 30px;
                border-radius: 50%;
                object-fit: cover;
                border: 1px solid rgba(148, 163, 184, 0.5);
                flex-shrink: 0;
                margin-top: 2px;
            }
            .clan-chat-form {
                width: 100%;
                display: flex;
                gap: 8px;
            }
            .clan-preset-grid {
                width: 100%;
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 6px;
                margin-bottom: 10px;
            }
        `;
        document.head.appendChild(style);
    }

    function createUiElements() {
        if (!document.getElementById("openClanBtn")) {
            const btn = document.createElement("button");
            btn.id = "openClanBtn";
            btn.innerHTML = `Клан <span id="clanBtnUnreadDot" class="clan-red-dot" style="display:none;"></span>`;
            btn.onclick = () => openClanPage(null);
            document.body.appendChild(btn);
        }

        if (!document.getElementById("clanPageOverlay")) {
            const overlay = document.createElement("div");
            overlay.id = "clanPageOverlay";
            overlay.innerHTML = `
                <canvas id="clanBgCanvas"></canvas>
                <button id="clanBackBtn" onclick="clanHandleBack()">Назад</button>
                <div id="clanScrollView" class="clan-scroll-container"></div>
            `;
            document.body.appendChild(overlay);
            startClanBgCanvas();
        }
    }

    function startClanBgCanvas() {
        const cvs = document.getElementById("clanBgCanvas");
        if (!cvs) return;
        const c = cvs.getContext("2d");

        const bombImg = new Image();
        bombImg.src = "item/batyabomb.png";

        const isMobile = window.innerWidth <= 768;
        const symbols = ["🗡", "🛡", "💧", "❄️"];
        const count = isMobile ? 10 : 14;

        const items = Array.from({ length: count }, (_, idx) => {
            const isBomb = idx < 3 || Math.random() < 0.3;
            const speed = isMobile ? 1.15 + Math.random() * 0.85 : 2.3 + Math.random() * 2.1;
            const vRot = isMobile ? (Math.random() - 0.5) * 0.015 : (Math.random() - 0.5) * 0.03;
            const size = isBomb ? (isMobile ? 74 : 64) : isMobile ? 38 : 36;
            return {
                x: Math.random() * Math.max(320, window.innerWidth),
                y: Math.random() * Math.max(480, window.innerHeight),
                speed,
                rot: Math.random() * Math.PI * 2,
                vRot,
                isBomb,
                sym: symbols[Math.floor(Math.random() * symbols.length)],
                size
            };
        });

        let lastTime = performance.now();

        function resizeCvs() {
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const w = window.innerWidth;
            const h = window.innerHeight;
            cvs.width = w * dpr;
            cvs.height = h * dpr;
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        resizeCvs();
        window.addEventListener("resize", resizeCvs);

        function tick(now) {
            const rawDt = (now - lastTime) / 16.667;
            const dt = Math.min(2.5, Math.max(0.25, rawDt));
            lastTime = now;

            if (clanPageOpen) {
                const w = window.innerWidth;
                const h = window.innerHeight;
                c.clearRect(0, 0, w, h);
                for (const it of items) {
                    it.y += it.speed * dt;
                    it.rot += it.vRot * dt;
                    if (it.y > h + 70) {
                        it.y = -70;
                        it.x = Math.random() * w;
                    }
                    c.save();
                    c.translate(it.x, it.y);
                    c.rotate(it.rot);

                    if (it.isBomb) {
                        if (bombImg.complete && bombImg.naturalWidth !== 0) {
                            const aspect = bombImg.naturalWidth / bombImg.naturalHeight;
                            let drawW = it.size;
                            let drawH = it.size;
                            if (aspect > 1) drawH = drawW / aspect;
                            else drawW = drawH * aspect;
                            c.drawImage(bombImg, -drawW / 2, -drawH / 2, drawW, drawH);
                        } else {
                            c.font = `${it.size}px 'Segoe UI Emoji', 'Apple Color Emoji', Arial, sans-serif`;
                            c.textAlign = "center";
                            c.textBaseline = "middle";
                            c.fillText("💣", 0, 0);
                        }
                    } else {
                        c.font = `${it.size}px 'Segoe UI Emoji', 'Apple Color Emoji', Arial, sans-serif`;
                        c.textAlign = "center";
                        c.textBaseline = "middle";
                        c.fillText(it.sym, 0, 0);
                    }
                    c.restore();
                }
            }
            decorAnimId = requestAnimationFrame(tick);
        }
        if (decorAnimId) cancelAnimationFrame(decorAnimId);
        decorAnimId = requestAnimationFrame(tick);
    }

    function updateUnreadIndicators() {
        const nick = getActiveNick();
        const hasUnread = Boolean(nick && currentClanId && unreadChatCount > 0);

        const mainBtn = document.getElementById("openClanBtn");
        const mainDot = document.getElementById("clanBtnUnreadDot");
        if (mainBtn && mainDot) {
            mainDot.style.display = hasUnread ? "inline-block" : "none";
            mainBtn.classList.toggle("has-unread", hasUnread);
        }

        const chatDot = document.getElementById("clanChatBtnRedDot");
        if (chatDot) {
            chatDot.style.display = hasUnread ? "block" : "none";
        }
    }

    function markChatAsRead() {
        const nick = getActiveNick();
        unreadChatCount = 0;
        if (nick && currentClanId) {
            saveUnreadCount(nick, currentClanId, 0);
        }
        updateUnreadIndicators();
    }

    function updateOpenClanBtnVisibility() {
        const btn = document.getElementById("openClanBtn");
        if (!btn) return;
        const nick = getActiveNick();
        const startScreen = document.getElementById("startScreen");
        const startVisible = startScreen && isElementVisible(startScreen);
        const drawerOpen = isProfileDrawerOpen();
        const shopOpen = isShopOpen();

        const hide =
            !nick ||
            clanPageOpen ||
            drawerOpen ||
            shopOpen ||
            !startVisible ||
            window.gameStarted === true ||
            window.isPaused === true ||
            window.gameOver === true;

        btn.style.display = hide ? "none" : "flex";
        updateUnreadIndicators();
    }

    // --- ПОДДЕРЖКА СТАТУСА «В СЕТИ» В РЕАЛЬНОМ ВРЕМЕНИ ---
    async function touchOnlinePresence(isOnlineFlag = true) {
        const nick = getActiveNick();
        if (!nick) return;
        try {
            await ensureAuthSession();
            const { db, doc, setDoc } = await getFs();
            const nowMs = Date.now();
            await setDoc(
                doc(db, "users", nick),
                {
                    lastActive: nowMs,
                    lastSeenMs: nowMs,
                    isOnline: Boolean(isOnlineFlag),
                    online: Boolean(isOnlineFlag)
                },
                { merge: true }
            );
            const prev = membersCache.get(nick) || {};
            membersCache.set(nick, {
                ...prev,
                lastActive: nowMs,
                lastSeenMs: nowMs,
                isOnline: Boolean(isOnlineFlag),
                online: Boolean(isOnlineFlag)
            });
        } catch (_) {}
    }

    function startPresenceHeartbeat() {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        touchOnlinePresence(true);
        heartbeatTimer = setInterval(() => {
            if (document.hidden) return;
            touchOnlinePresence(true);
        }, 3000);

        window.addEventListener("beforeunload", () => {
            const nick = getActiveNick();
            if (!nick || !fsApi) return;
            try {
                const { db, doc, setDoc } = fsApi;
                setDoc(doc(db, "users", nick), { isOnline: false, online: false, lastActive: Date.now() }, { merge: true }).catch(() => {});
            } catch (_) {}
        });
    }

    function clearMemberLiveListeners() {
        for (const unsub of membersLiveUnsubs) {
            try {
                unsub();
            } catch (_) {}
        }
        membersLiveUnsubs = [];
    }

    function subscribeMembersLive(memberNicks) {
        clearMemberLiveListeners();
        if (!Array.isArray(memberNicks) || !memberNicks.length) return;

        getFs().then(({ db, doc, onSnapshot }) => {
            for (const mNick of memberNicks) {
                const clean = String(mNick).toLowerCase();
                const unsub = onSnapshot(doc(db, "users", clean), (snap) => {
                    if (snap.exists()) {
                        membersCache.set(clean, snap.data());
                    } else {
                        membersCache.set(clean, { username: clean });
                    }
                    if (clanPageOpen && currentClanData) {
                        if (clanSubView === "hub") {
                            paintMembersRows(currentClanData.members || [], currentClanData.leader || "");
                        } else if (clanSubView === "chat") {
                            updateChatOnlineCounter();
                        }
                    }
                });
                membersLiveUnsubs.push(unsub);
            }
        }).catch(() => {});
    }

    // --- ПОСТОЯННЫЙ СЛУШАТЕЛЬ ЧАТА ДЛЯ НЕПРОЧИТАННЫХ СООБЩЕНИЙ ---
    async function attachBackgroundChatWatcher(nick, clanId) {
        stopChatListener();
        knownMessageIds = new Set();
        initialChatLoaded = false;
        unreadChatCount = loadSavedUnreadCount(nick, clanId);
        updateUnreadIndicators();

        if (!nick || !clanId) return;

        try {
            await ensureAuthSession();
            const { db, collection, query, orderBy, limit, onSnapshot } = await getFs();
            const msgsCol = collection(db, "clans", clanId, "messages");
            const q = query(msgsCol, orderBy("createdAt", "asc"), limit(80));

            chatUnsub = onSnapshot(
                q,
                (snap) => {
                    const docs = [];
                    snap.forEach((docSnap) => {
                        docs.push({ id: docSnap.id, ...docSnap.data() });
                    });

                    if (!initialChatLoaded) {
                        initialChatLoaded = true;
                        for (const d of docs) {
                            knownMessageIds.add(d.id);
                        }
                    } else {
                        let newFromOthers = 0;
                        for (const d of docs) {
                            if (!knownMessageIds.has(d.id)) {
                                knownMessageIds.add(d.id);
                                const sender = String(d.sender || "").toLowerCase();
                                if (sender && sender !== nick) {
                                    newFromOthers += 1;
                                }
                            }
                        }
                        if (newFromOthers > 0) {
                            if (clanPageOpen && clanSubView === "chat") {
                                markChatAsRead();
                            } else {
                                unreadChatCount += newFromOthers;
                                saveUnreadCount(nick, clanId, unreadChatCount);
                                updateUnreadIndicators();
                            }
                        }
                    }

                    if (clanPageOpen && clanSubView === "chat") {
                        renderChatMessagesList(docs, nick);
                    }
                },
                (err) => {
                    if (clanPageOpen && clanSubView === "chat") {
                        const box = document.getElementById("clanChatMessages");
                        if (box) {
                            box.innerHTML = `<div style="font-size:12px; color:#f87171; text-align:center; margin-top:20px;">Ошибка чата: ${escapeHtml(err.message || "")}</div>`;
                        }
                    }
                }
            );
        } catch (err) {
            if (clanPageOpen && clanSubView === "chat") {
                const box = document.getElementById("clanChatMessages");
                if (box) {
                    box.innerHTML = `<div style="font-size:12px; color:#f87171; text-align:center; margin-top:20px;">Ошибка чата: ${escapeHtml(err.message || "")}</div>`;
                }
            }
        }
    }

    function stopChatListener() {
        if (chatUnsub) {
            chatUnsub();
            chatUnsub = null;
        }
    }

    window.openClanPage = async function (targetClanId = null) {
        const nick = getActiveNick();
        if (!nick) {
            alert("Сначала войдите в аккаунт в боковом меню!");
            return;
        }

        const profileDrawer = document.getElementById("profileDrawer");
        if (profileDrawer) profileDrawer.classList.remove("open");

        clanPageOpen = true;
        clanSubView = "hub";
        viewedOtherClanId = targetClanId;
        const overlay = document.getElementById("clanPageOverlay");
        if (overlay) overlay.style.display = "flex";
        updateOpenClanBtnVisibility();
        touchOnlinePresence(true);

        try {
            await ensureAuthSession();
        } catch (_) {}

        await syncUserClanAndRender(nick, targetClanId);
    };

    window.clanHandleBack = function () {
        const view = document.getElementById("clanScrollView");
        if (view && view.dataset.mode === "create") {
            viewedOtherClanId = null;
            renderNoClanView("");
            return;
        }
        if (clanSubView !== "hub" && currentClanData) {
            clanSubView = "hub";
            renderClanHubView(currentClanData, getActiveNick());
            return;
        }
        if (viewedOtherClanId) {
            viewedOtherClanId = null;
            clanSubView = "hub";
            const nick = getActiveNick();
            syncUserClanAndRender(nick, null);
            return;
        }
        closeClanPage();
    };

    function closeClanPage() {
        clanPageOpen = false;
        viewedOtherClanId = null;
        clanSubView = "hub";
        clearMemberLiveListeners();
        if (currentClanUnsub) {
            currentClanUnsub();
            currentClanUnsub = null;
        }
        if (liveTimerInterval) {
            clearInterval(liveTimerInterval);
            liveTimerInterval = null;
        }
        currentClanData = null;
        const overlay = document.getElementById("clanPageOverlay");
        if (overlay) overlay.style.display = "none";
        updateOpenClanBtnVisibility();
    }

    async function syncUserClanAndRender(nick, targetClanId = null) {
        await ensureAuthSession();
        const { db, doc, getDoc, updateDoc, onSnapshot } = await getFs();

        if (currentClanUnsub) {
            currentClanUnsub();
            currentClanUnsub = null;
        }

        if (targetClanId) {
            currentClanId = targetClanId;
            currentClanUnsub = onSnapshot(doc(db, "clans", targetClanId), async (snap) => {
                if (!clanPageOpen) return;
                if (!snap.exists()) {
                    alert("Этот клан был удалён.");
                    viewedOtherClanId = null;
                    clanSubView = "hub";
                    await syncUserClanAndRender(nick, null);
                    return;
                }
                currentClanData = { id: snap.id, ...snap.data() };
                subscribeMembersLive(currentClanData.members || []);
                if (clanSubView === "hub") {
                    renderClanHubView(currentClanData, nick);
                } else if (clanSubView === "chat") {
                    updateChatOnlineCounter();
                }
            });
            return;
        }

        const userSnap = await getDoc(doc(db, "users", nick));
        const userClanId = userSnap.exists() ? (userSnap.data().clanId || null) : null;

        if (!userClanId) {
            currentClanId = null;
            currentClanData = null;
            unreadChatCount = 0;
            clearMemberLiveListeners();
            updateUnreadIndicators();
            renderNoClanView("");
            return;
        }

        const prevClanId = currentClanId;
        currentClanId = userClanId;
        if (prevClanId !== userClanId || !chatUnsub) {
            attachBackgroundChatWatcher(nick, userClanId);
        }

        currentClanUnsub = onSnapshot(doc(db, "clans", userClanId), async (snap) => {
            if (!clanPageOpen) return;
            if (!snap.exists()) {
                await updateDoc(doc(db, "users", nick), { clanId: null, clanName: null }).catch(() => {});
                userClanCache.set(nick, null);
                currentClanId = null;
                currentClanData = null;
                clanSubView = "hub";
                unreadChatCount = 0;
                clearMemberLiveListeners();
                updateUnreadIndicators();
                renderNoClanView("");
                return;
            }
            const data = snap.data();
            const members = Array.isArray(data.members) ? data.members : [];
            if (!members.includes(nick)) {
                await updateDoc(doc(db, "users", nick), { clanId: null, clanName: null }).catch(() => {});
                userClanCache.set(nick, null);
                currentClanId = null;
                currentClanData = null;
                clanSubView = "hub";
                unreadChatCount = 0;
                clearMemberLiveListeners();
                updateUnreadIndicators();
                renderNoClanView("");
                return;
            }
            currentClanData = { id: snap.id, ...data };
            userClanCache.set(nick, { clanId: snap.id, clanName: data.name || snap.id });
            subscribeMembersLive(members);
            if (clanSubView === "hub") {
                renderClanHubView(currentClanData, nick);
            } else if (clanSubView === "chat") {
                updateChatOnlineCounter();
            }
        });
    }

    function renderNoClanView(searchQuery = "") {
        const view = document.getElementById("clanScrollView");
        if (!view) return;
        view.dataset.mode = "list";
        if (liveTimerInterval) {
            clearInterval(liveTimerInterval);
            liveTimerInterval = null;
        }

        view.innerHTML = `
            <div class="clan-no-clan-box">
                <div class="clan-search-panel">
                    <input id="clanSearchInput" type="text" class="clan-input" placeholder="Поиск кланов..." value="${escapeHtml(searchQuery)}" oninput="clanSearchClans(this.value)">
                    <div id="clanSearchResults"></div>
                </div>

                <button class="clan-create-btn" onclick="clanShowCreateForm()">Создать клан</button>
            </div>
        `;

        clanSearchClans(searchQuery);
    }

    window.clanSearchClans = async function (queryText) {
        const container = document.getElementById("clanSearchResults");
        if (!container) return;
        const qClean = (queryText || "").trim().toLowerCase();

        try {
            await ensureAuthSession();
            const { db, collection, getDocs } = await getFs();
            const snap = await getDocs(collection(db, "clans"));
            const allClans = [];
            snap.forEach((d) => {
                const data = d.data();
                const name = data.name || d.id;
                if (!qClean || name.toLowerCase().includes(qClean)) {
                    allClans.push({ id: d.id, ...data });
                }
            });

            if (allClans.length === 0) {
                container.innerHTML = `<div style="font-size:12px; color:#94a3b8; margin-top:10px; text-align:center;">Кланы не найдены</div>`;
                return;
            }

            container.innerHTML = allClans
                .slice(0, 12)
                .map((c) => {
                    const mCount = Array.isArray(c.members) ? c.members.length : 0;
                    const modeLabel =
                        c.accessType === "open"
                            ? "Открытый"
                            : c.accessType === "invite"
                            ? "По приглашению"
                            : "Закрытый";
                    const avaHtml = c.avatarUrl
                        ? `<img src="${c.avatarUrl}" class="clan-square-ava-sm" alt="ava">`
                        : `<div class="clan-square-ava-sm"></div>`;
                    return `
                        <div class="clan-card-item" onclick="openClanPage('${escapeAttr(c.id)}')">
                            <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                                ${avaHtml}
                                <div style="overflow:hidden; text-align:left;">
                                    <div style="font-size:14px; font-weight:bold; color:#4ade80; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(c.name || c.id)}</div>
                                    <div style="font-size:11px; color:#94a3b8;">Участников: ${mCount} • ${modeLabel}</div>
                                </div>
                            </div>
                            <span style="font-size:12px; color:#38bdf8; font-weight:bold;">Открыть</span>
                        </div>
                    `;
                })
                .join("");
        } catch (err) {
            container.innerHTML = `<div style="font-size:12px; color:#f87171; margin-top:10px; text-align:center;">Ошибка поиска (${escapeHtml(err.code || "")}): ${escapeHtml(err.message || "")}</div>`;
        }
    };

    window.clanShowCreateForm = function () {
        const view = document.getElementById("clanScrollView");
        if (!view) return;
        view.dataset.mode = "create";
        createAvatarDataUrl = "";

        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 12px;">
                <h3 style="margin: 0 0 14px 0; color: #e2e8f0;">Создание клана</h3>

                <label style="font-size:12px; color:#cbd5e1; margin-bottom:6px;">Аватарка клана</label>
                <div id="clanCreateAvaPreview" class="clan-square-ava" style="margin-bottom:8px;"></div>
                <input type="file" id="clanCreateAvaFile" accept="image/*" class="clan-input" style="padding:7px; font-size:12px; margin-bottom:12px;" onchange="clanOnCreateAvaChange(this)">

                <label style="font-size:12px; color:#cbd5e1; align-self:flex-start; margin-bottom:4px;">Название клана</label>
                <input type="text" id="clanCreateName" class="clan-input" maxlength="24" placeholder="" style="margin-bottom:12px;">

                <label style="font-size:12px; color:#cbd5e1; align-self:flex-start; margin-bottom:4px;">Описание клана</label>
                <textarea id="clanCreateDesc" class="clan-input" rows="3" maxlength="160" style="resize:none; margin-bottom:12px;"></textarea>

                <label style="font-size:12px; color:#cbd5e1; align-self:flex-start; margin-bottom:4px;">Тип доступа</label>
                <select id="clanCreateAccess" class="clan-input" style="margin-bottom:16px;">
                    <option value="open">Открытый</option>
                    <option value="closed">Закрытый</option>
                    <option value="invite">По приглашению</option>
                </select>

                <button class="clan-create-btn" onclick="clanSubmitCreate()">Создать клан</button>
            </div>
        `;
    };

    window.clanOnCreateAvaChange = function (input) {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            createAvatarDataUrl = ev.target.result;
            const prev = document.getElementById("clanCreateAvaPreview");
            if (prev) {
                prev.innerHTML = `<img src="${createAvatarDataUrl}" style="width:100%; height:100%; object-fit:cover; display:block;">`;
            }
        };
        reader.readAsDataURL(file);
    };

    window.clanSubmitCreate = async function () {
        const nick = getActiveNick();
        if (!nick) return;

        const nameInput = document.getElementById("clanCreateName");
        const descInput = document.getElementById("clanCreateDesc");
        const accessSelect = document.getElementById("clanCreateAccess");

        const rawName = (nameInput ? nameInput.value : "").trim();
        const desc = (descInput ? descInput.value : "").trim();
        const accessType = accessSelect ? accessSelect.value : "open";

        if (rawName.length < 2) {
            alert("Название клана должно быть не короче 2 символов!");
            return;
        }

        const nameLower = rawName.toLowerCase();
        const clanId = "clan_" + nameLower.replace(/[^a-zа-яё0-9_-]/gi, "_") + "_" + Date.now().toString(36).slice(-4);

        try {
            await ensureAuthSession();
            const { db, doc, runTransaction } = await getFs();
            const userRef = doc(db, "users", nick);
            const nameLockRef = doc(db, "clanNames", nameLower);
            const clanRef = doc(db, "clans", clanId);

            await runTransaction(db, async (tx) => {
                const userSnap = await tx.get(userRef);
                if (userSnap.exists() && userSnap.data().clanId) {
                    throw new Error("Вы уже состоите в клане!");
                }
                const lockSnap = await tx.get(nameLockRef);
                if (lockSnap.exists()) {
                    throw new Error("Клан с таким названием уже существует!");
                }

                tx.set(nameLockRef, {
                    clanId,
                    name: rawName,
                    createdBy: nick,
                    createdAt: Date.now()
                });

                tx.set(clanRef, {
                    name: rawName,
                    nameLower,
                    description: desc,
                    avatarUrl: createAvatarDataUrl || "",
                    accessType,
                    leader: nick,
                    members: [nick],
                    joinRequests: [],
                    mlBalance: 0.0,
                    createdAt: Date.now()
                });

                if (userSnap.exists()) {
                    tx.update(userRef, {
                        clanId,
                        clanName: rawName
                    });
                } else {
                    tx.set(
                        userRef,
                        {
                            username: nick,
                            username_lower: nick,
                            clanId,
                            clanName: rawName,
                            members: []
                        },
                        { merge: true }
                    );
                }
            });

            userClanCache.set(nick, { clanId, clanName: rawName });
            viewedOtherClanId = null;
            clanSubView = "hub";
            await syncUserClanAndRender(nick, null);
        } catch (err) {
            alert(`${err.message || "Ошибка создания клана"} ${err.code ? "[" + err.code + "]" : ""}`);
        }
    };

    function extractTimestampMs(val) {
        if (!val) return 0;
        if (typeof val === "number") return val;
        if (typeof val.toMillis === "function") return val.toMillis();
        if (val.seconds) return val.seconds * 1000;
        return 0;
    }

    function isMemberOnlineNow(cleanNick, data) {
        const myNick = getActiveNick();
        // Текущий пользователь, находясь на экране клана или в активной вкладке игры, всегда в сети
        if (cleanNick === myNick && !document.hidden && (clanPageOpen || window.gameStarted === true || isElementVisible(document.getElementById("startScreen")))) {
            return true;
        }
        if (!data) return false;
        if (data.isOnline === false || data.online === false) return false;
        const lastActive = Math.max(extractTimestampMs(data.lastActive), extractTimestampMs(data.lastSeenMs));
        return Boolean(lastActive && Date.now() - lastActive < 18000);
    }

    function countOnlineMembers(memberNicks) {
        if (!Array.isArray(memberNicks)) return 0;
        let count = 0;
        for (const m of memberNicks) {
            const clean = String(m).toLowerCase();
            const uData = membersCache.get(clean);
            if (isMemberOnlineNow(clean, uData)) {
                count += 1;
            }
        }
        return count;
    }

    function formatMemberStatus(cleanNick, data) {
        if (isMemberOnlineNow(cleanNick, data)) {
            if (data && data.inGame) {
                if (data.currentBossName) {
                    return { text: `В игре • Босс ${data.currentBossName}`, color: "#38bdf8" };
                }
                const startMs = extractTimestampMs(data.gameStartTime);
                const diffSec = startMs ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
                const mins = String(Math.floor(diffSec / 60)).padStart(2, "0");
                const secs = String(diffSec % 60).padStart(2, "0");
                return { text: `В игре [${mins}:${secs}]`, color: "#4ade80" };
            }
            return { text: "В сети", color: "#4ade80" };
        }

        const lastActive = data ? Math.max(extractTimestampMs(data.lastActive), extractTimestampMs(data.lastSeenMs)) : 0;
        if (!lastActive) return { text: "Не в сети", color: "#94a3b8" };
        const diffSec = Math.max(0, Math.floor((Date.now() - lastActive) / 1000));
        if (diffSec < 60) return { text: "Был в сети меньше минуты назад", color: "#94a3b8" };
        if (diffSec < 3600) return { text: `Был в сети ${Math.floor(diffSec / 60)} мин. назад`, color: "#94a3b8" };
        if (diffSec < 86400) return { text: `Был в сети ${Math.floor(diffSec / 3600)} ч. назад`, color: "#94a3b8" };
        return { text: `Был в сети ${Math.floor(diffSec / 86400)} дн. назад`, color: "#94a3b8" };
    }

    function renderClanHubView(clan, myNick) {
        const view = document.getElementById("clanScrollView");
        if (!view || !clan) return;
        view.dataset.mode = "hub";
        clanSubView = "hub";

        const members = Array.isArray(clan.members) ? clan.members : [];
        const isMember = members.includes(myNick);
        const isLeader = isMember && clan.leader === myNick;
        const mlNum = Number(clan.mlBalance || 0);
        const joinRequests = Array.isArray(clan.joinRequests) ? clan.joinRequests : [];
        const hasPendingReq = joinRequests.includes(myNick);

        const avaHtml = clan.avatarUrl
            ? `<img src="${clan.avatarUrl}" class="clan-square-ava" alt="Клан">`
            : `<div class="clan-square-ava"></div>`;

        let actionButtonsHtml = "";
        if (!isMember) {
            if (clan.accessType === "open") {
                actionButtonsHtml = `<button class="clan-action-btn" style="background:#16a34a;" onclick="clanJoinOpen('${escapeAttr(clan.id)}')">Вступить в клан</button>`;
            } else if (clan.accessType === "invite") {
                if (hasPendingReq) {
                    actionButtonsHtml = `<button class="clan-action-btn" style="background:#475569;" disabled>Заявка отправлена</button>`;
                } else {
                    actionButtonsHtml = `<button class="clan-action-btn" style="background:#2563eb;" onclick="clanRequestJoin('${escapeAttr(clan.id)}')">Подать заявку</button>`;
                }
            } else {
                actionButtonsHtml = `<button class="clan-action-btn" style="background:#475569;" disabled>Клан закрыт</button>`;
            }
        } else {
            // Строгий порядок слева направо: [⚙️] [Вложить] [Чат] [Выйти (красная)]
            actionButtonsHtml = `
                <div class="clan-toolbar-row">
                    ${isLeader ? `<button class="clan-mini-btn clan-gear-btn" style="background:rgba(51, 65, 85, 0.88);" title="Настройки клана" onclick="clanOpenSettingsView()">⚙️</button>` : ""}
                    <button class="clan-mini-btn" style="background:rgba(2, 132, 199, 0.85);" onclick="clanOpenDonateView()">💧 Вложить</button>
                    <button class="clan-mini-btn" style="background:rgba(22, 163, 74, 0.85);" onclick="clanOpenChatView()">💬 Чат<span id="clanChatBtnRedDot" class="clan-chat-corner-dot"></span></button>
                    <button class="clan-mini-btn" style="background:#dc2626;" onclick="clanLeave('${escapeAttr(clan.id)}')">Выйти</button>
                </div>
            `;
        }

        let requestsHtml = "";
        if (isLeader && joinRequests.length > 0) {
            requestsHtml = `
                <div class="clan-members-box" style="border-color: rgba(251, 146, 60, 0.5); margin-bottom: 10px;">
                    <div style="font-size:12px; font-weight:bold; color:#fb923c;">Заявки в клан (${joinRequests.length})</div>
                    ${joinRequests
                        .map(
                            (reqNick) => `
                        <div class="clan-member-row">
                            <span style="font-size:13px; font-weight:bold;">${escapeHtml(reqNick)}</span>
                            <div style="display:flex; gap:6px;">
                                <button class="clan-action-btn" style="background:#16a34a; padding:5px 10px; font-size:11px;" onclick="clanApproveRequest('${escapeAttr(clan.id)}', '${escapeAttr(reqNick)}')">Принять</button>
                                <button class="clan-action-btn" style="background:#dc2626; padding:5px 10px; font-size:11px;" onclick="clanRejectRequest('${escapeAttr(clan.id)}', '${escapeAttr(reqNick)}')">Отклонить</button>
                            </div>
                        </div>
                    `
                        )
                        .join("")}
                </div>
            `;
        }

        const leaderNote = !clan.leader
            ? `<div style="font-size:11px; color:#facc15; margin-bottom:8px;">У клана сейчас нет главы — первый зашедший станет главой</div>`
            : "";

        view.innerHTML = `
            <div class="clan-hub-box">
                ${avaHtml}
                <div class="clan-name-green">${escapeHtml(clan.name || clan.id)}</div>
                <div class="clan-ml-blue">${mlNum.toFixed(3)} мл</div>
                <div class="clan-desc-text">${escapeHtml(clan.description || "")}</div>
                ${leaderNote}
                ${actionButtonsHtml}
                ${requestsHtml}

                <div style="width:100%; font-size:13px; font-weight:bold; color:#cbd5e1; text-align:left; margin-top:4px;">
                    Участники (${members.length})
                </div>
                <div id="clanMembersList" class="clan-members-box"></div>
            </div>
        `;

        updateUnreadIndicators();
        paintMembersRows(members, clan.leader || "");

        if (liveTimerInterval) clearInterval(liveTimerInterval);
        liveTimerInterval = setInterval(() => {
            if (!clanPageOpen || !currentClanData) return;
            if (clanSubView === "hub") {
                paintMembersRows(currentClanData.members || [], currentClanData.leader || "");
            } else if (clanSubView === "chat") {
                updateChatOnlineCounter();
            }
        }, 1000);
    }

    function paintMembersRows(members, leaderNick) {
        const listEl = document.getElementById("clanMembersList");
        if (!listEl) return;

        if (!members.length) {
            listEl.innerHTML = `<div style="font-size:12px; color:#94a3b8; text-align:center; padding:8px;">В клане пока никого нет</div>`;
            return;
        }

        listEl.innerHTML = members
            .map((mNick) => {
                const clean = String(mNick).toLowerCase();
                const uData = membersCache.get(clean) || {};
                const displayName = uData.username || clean;
                const avaSrc = uData.avatarUrl || "https://via.placeholder.com/70";
                const status = formatMemberStatus(clean, uData);
                const crown = clean === String(leaderNick).toLowerCase() ? ` [Глава]` : "";
                return `
                    <div class="clan-member-row">
                        <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                            <img src="${avaSrc}" class="clan-member-ava" alt="ava">
                            <div style="overflow:hidden;">
                                <div style="font-size:13px; font-weight:bold; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(displayName)}${crown}</div>
                                <div style="font-size:11px; color:${status.color};">${escapeHtml(status.text)}</div>
                            </div>
                        </div>
                    </div>
                `;
            })
            .join("");
    }

    // --- ОКНО НАСТРОЕК КЛАНА (⚙️) ---
    window.clanOpenSettingsView = function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        if (currentClanData.leader !== nick) return;

        clanSubView = "settings";
        editAvatarDataUrl = null;
        const view = document.getElementById("clanScrollView");
        if (!view) return;

        const avaPreview = currentClanData.avatarUrl
            ? `<img src="${currentClanData.avatarUrl}" style="width:100%; height:100%; object-fit:cover; display:block;">`
            : "";

        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 8px;">
                <h3 style="margin: 0 0 14px 0; color: #e2e8f0;">Настройки клана</h3>

                <label style="font-size:12px; color:#cbd5e1; margin-bottom:6px;">Аватарка клана</label>
                <div id="clanEditAvaPreview" class="clan-square-ava" style="margin-bottom:8px;">${avaPreview}</div>
                <input type="file" accept="image/*" class="clan-input" style="padding:7px; font-size:12px; margin-bottom:12px;" onchange="clanOnEditAvaChange(this)">

                <label style="font-size:12px; color:#cbd5e1; align-self:flex-start; margin-bottom:4px;">Название клана</label>
                <input type="text" id="clanEditName" class="clan-input" maxlength="24" value="${escapeHtml(currentClanData.name || "")}" style="margin-bottom:12px;">

                <label style="font-size:12px; color:#cbd5e1; align-self:flex-start; margin-bottom:4px;">Описание клана</label>
                <textarea id="clanEditDesc" class="clan-input" rows="3" maxlength="160" style="resize:none; margin-bottom:12px;">${escapeHtml(currentClanData.description || "")}</textarea>

                <label style="font-size:12px; color:#cbd5e1; align-self:flex-start; margin-bottom:4px;">Тип доступа</label>
                <select id="clanEditAccess" class="clan-input" style="margin-bottom:16px;">
                    <option value="open" ${currentClanData.accessType === "open" ? "selected" : ""}>Открытый</option>
                    <option value="closed" ${currentClanData.accessType === "closed" ? "selected" : ""}>Закрытый</option>
                    <option value="invite" ${currentClanData.accessType === "invite" ? "selected" : ""}>По приглашению</option>
                </select>

                <button class="clan-create-btn" style="margin-bottom: 14px;" onclick="clanSaveSettings()">Сохранить изменения</button>

                <div style="width:100%; border-top: 1px solid rgba(148, 163, 184, 0.2); padding-top: 14px; margin-top: 4px;">
                    <button class="clan-action-btn" style="width:100%; background:#dc2626;" onclick="clanDelete('${escapeAttr(currentClanData.id)}')">Удалить клан</button>
                </div>
            </div>
        `;
    };

    window.clanOnEditAvaChange = function (input) {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            editAvatarDataUrl = ev.target.result;
            const prev = document.getElementById("clanEditAvaPreview");
            if (prev) {
                prev.innerHTML = `<img src="${editAvatarDataUrl}" style="width:100%; height:100%; object-fit:cover; display:block;">`;
            }
        };
        reader.readAsDataURL(file);
    };

    window.clanSaveSettings = async function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        if (currentClanData.leader !== nick) return;

        const rawName = (document.getElementById("clanEditName")?.value || "").trim();
        const desc = (document.getElementById("clanEditDesc")?.value || "").trim();
        const accessType = document.getElementById("clanEditAccess")?.value || "open";

        if (rawName.length < 2) {
            alert("Название клана должно быть не короче 2 символов!");
            return;
        }

        const newNameLower = rawName.toLowerCase();
        const oldNameLower = (currentClanData.nameLower || currentClanData.name || "").toLowerCase();
        const clanId = currentClanData.id;

        try {
            await ensureAuthSession();
            const { db, doc, runTransaction, updateDoc } = await getFs();
            const clanRef = doc(db, "clans", clanId);

            await runTransaction(db, async (tx) => {
                const cSnap = await tx.get(clanRef);
                if (!cSnap.exists()) throw new Error("Клан не найден");

                if (newNameLower !== oldNameLower) {
                    const newLockRef = doc(db, "clanNames", newNameLower);
                    const newLockSnap = await tx.get(newLockRef);
                    if (newLockSnap.exists()) {
                        throw new Error("Клан с таким названием уже существует!");
                    }
                    if (oldNameLower) {
                        tx.delete(doc(db, "clanNames", oldNameLower));
                    }
                    tx.set(newLockRef, {
                        clanId,
                        name: rawName,
                        createdBy: nick,
                        createdAt: Date.now()
                    });
                }

                const patch = {
                    name: rawName,
                    nameLower: newNameLower,
                    description: desc,
                    accessType
                };
                if (editAvatarDataUrl !== null) {
                    patch.avatarUrl = editAvatarDataUrl;
                }
                tx.update(clanRef, patch);
            });

            const members = Array.isArray(currentClanData.members) ? currentClanData.members : [];
            for (const m of members) {
                const mClean = String(m).toLowerCase();
                userClanCache.set(mClean, { clanId, clanName: rawName });
                await updateDoc(doc(db, "users", mClean), { clanName: rawName }).catch(() => {});
            }

            clanSubView = "hub";
            renderClanHubView(
                {
                    ...currentClanData,
                    name: rawName,
                    nameLower: newNameLower,
                    description: desc,
                    accessType,
                    avatarUrl: editAvatarDataUrl !== null ? editAvatarDataUrl : currentClanData.avatarUrl
                },
                nick
            );
        } catch (err) {
            alert(err.message || "Ошибка сохранения настроек");
        }
    };

    // --- ОКНО ВЛОЖЕНИЯ МИЛЛИЛИТРОВ В КЛАН ---
    window.clanOpenDonateView = async function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        clanSubView = "donate";

        const view = document.getElementById("clanScrollView");
        if (!view) return;

        let fsUserData = null;
        try {
            await ensureAuthSession();
            const { db, doc, getDoc } = await getFs();
            const uSnap = await getDoc(doc(db, "users", nick));
            if (uSnap.exists()) {
                fsUserData = uSnap.data();
            }
        } catch (_) {}

        const myBalance = detectLocalPlayerMl(fsUserData);
        const clanMl = Number(currentClanData.mlBalance || 0);

        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 12px;">
                <h3 style="margin: 0 0 8px 0; color: #38bdf8;">Вложить миллилитры в клан</h3>
                <div style="font-size:13px; color:#cbd5e1; margin-bottom:4px;">Казна клана: <b style="color:#38bdf8;">${clanMl.toFixed(3)} мл</b></div>
                <div style="font-size:13px; color:#cbd5e1; margin-bottom:14px;">Ваш баланс: <b id="clanDonateMyBal" style="color:#4ade80;">${myBalance.toFixed(3)} мл</b></div>

                <div class="clan-preset-grid">
                    <button class="clan-mini-btn" style="background:rgba(30,41,59,0.85);" onclick="clanSetDonateVal(1)">1 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(30,41,59,0.85);" onclick="clanSetDonateVal(5)">5 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(30,41,59,0.85);" onclick="clanSetDonateVal(10)">10 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(30,41,59,0.85);" onclick="clanSetDonateVal(25)">25 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(30,41,59,0.85);" onclick="clanSetDonateVal(50)">50 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(30,41,59,0.85);" onclick="clanSetDonateVal(${myBalance.toFixed(3)})">Всё</button>
                </div>

                <input type="number" id="clanDonateAmount" class="clan-input" step="0.001" min="0.001" placeholder="Введите количество мл..." style="margin-bottom:14px;">

                <button class="clan-create-btn" style="background:rgba(2, 132, 199, 0.78);" onclick="clanSubmitDonate()">Вложить в клан</button>
            </div>
        `;
    };

    window.clanSetDonateVal = function (val) {
        const inp = document.getElementById("clanDonateAmount");
        if (inp) inp.value = Number(val || 0);
    };

    window.clanSubmitDonate = async function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        const inp = document.getElementById("clanDonateAmount");
        const amount = Math.round((parseFloat(inp ? inp.value : "0") || 0) * 1000) / 1000;

        if (amount <= 0) {
            alert("Укажите сумму больше 0 мл!");
            return;
        }

        try {
            await ensureAuthSession();
            const { db, doc, runTransaction } = await getFs();
            const userRef = doc(db, "users", nick);
            const clanRef = doc(db, "clans", currentClanData.id);

            await runTransaction(db, async (tx) => {
                const uSnap = await tx.get(userRef);
                const uData = uSnap.exists() ? uSnap.data() : {};
                const availableMl = detectLocalPlayerMl(uData);

                if (availableMl + 1e-9 < amount) {
                    throw new Error(`Недостаточно миллилитров на балансе! Доступно: ${availableMl.toFixed(3)} мл`);
                }

                const cSnap = await tx.get(clanRef);
                if (!cSnap.exists()) throw new Error("Клан не найден");
                const currentClanMl = Number(cSnap.data().mlBalance || 0);

                const nextUserMl = Math.max(0, Math.round((availableMl - amount) * 1000) / 1000);
                const nextClanMl = Math.round((currentClanMl + amount) * 1000) / 1000;

                const fieldKey =
                    typeof uData.ml === "number"
                        ? "ml"
                        : typeof uData.milliliters === "number"
                        ? "milliliters"
                        : typeof uData.mlBalance === "number"
                        ? "mlBalance"
                        : "ml";

                tx.set(userRef, { [fieldKey]: nextUserMl }, { merge: true });
                tx.update(clanRef, { mlBalance: nextClanMl });
                syncLocalPlayerMlDown(amount, uData);
            });

            clanSubView = "hub";
            renderClanHubView(currentClanData, nick);
        } catch (err) {
            alert(err.message || "Ошибка при вложении миллилитров");
        }
    };

    // --- ГРУППОВОЙ ЧАТ КЛАНА ---
    function updateChatOnlineCounter() {
        const el = document.getElementById("clanChatOnlineCounter");
        if (!el || !currentClanData) return;
        const onlineCount = countOnlineMembers(currentClanData.members || []);
        el.textContent = `В сети: ${onlineCount}`;
    }

    function renderChatMessagesList(docs, nick) {
        const box = document.getElementById("clanChatMessages");
        if (!box) return;

        if (!docs.length) {
            box.innerHTML = `<div style="font-size:12px; color:#94a3b8; text-align:center; margin-top:24px;">Сообщений пока нет. Напишите первым!</div>`;
            return;
        }

        const rows = docs.map((m) => {
            const senderClean = String(m.sender || "").toLowerCase();
            const cachedUser = membersCache.get(senderClean) || {};
            const displayNick = cachedUser.username || m.senderName || senderClean;
            const ava = cachedUser.avatarUrl || m.avatarUrl || "https://via.placeholder.com/70";
            const isMine = senderClean === nick;
            const timeStr = m.createdAt
                ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "";

            return `
                <div class="clan-chat-msg ${isMine ? "mine" : ""}">
                    <img src="${ava}" class="clan-chat-ava" alt="ava">
                    <div style="flex:1; min-width:0;">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:2px;">
                            <span style="font-size:12px; font-weight:bold; color:${isMine ? "#38bdf8" : "#4ade80"}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(displayNick)}</span>
                            <span style="font-size:10px; color:#94a3b8; flex-shrink:0;">${escapeHtml(timeStr)}</span>
                        </div>
                        <div style="font-size:13px; color:#f1f5f9; word-break:break-word; line-height:1.35;">${escapeHtml(m.text || "")}</div>
                    </div>
                </div>
            `;
        });

        box.innerHTML = rows.join("");
        box.scrollTop = box.scrollHeight;
    }

    window.clanOpenChatView = async function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        clanSubView = "chat";
        markChatAsRead();

        const view = document.getElementById("clanScrollView");
        if (!view) return;

        const onlineCount = countOnlineMembers(currentClanData.members || []);

        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 6px;">
                <div class="clan-chat-header">
                    <div class="clan-chat-title">${escapeHtml(currentClanData.name || "Клан")}</div>
                    <div id="clanChatOnlineCounter" class="clan-chat-online">В сети: ${onlineCount}</div>
                </div>
                <div id="clanChatMessages" class="clan-chat-messages">
                    <div style="font-size:12px; color:#94a3b8; text-align:center; margin-top:20px;">Загрузка сообщений...</div>
                </div>
                <form class="clan-chat-form" onsubmit="event.preventDefault(); clanSendMessage();">
                    <input type="text" id="clanChatInput" class="clan-input" maxlength="300" placeholder="Написать в клан..." autocomplete="off">
                    <button type="submit" class="clan-action-btn" style="background:#16a34a; flex-shrink:0;">Отправить</button>
                </form>
            </div>
        `;

        if (!chatUnsub && currentClanId) {
            await attachBackgroundChatWatcher(nick, currentClanId);
        }

        try {
            const { db, collection, query, orderBy, limit, getDocs } = await getFs();
            const snap = await getDocs(query(collection(db, "clans", currentClanData.id, "messages"), orderBy("createdAt", "asc"), limit(80)));
            const docs = [];
            snap.forEach((docSnap) => {
                knownMessageIds.add(docSnap.id);
                docs.push({ id: docSnap.id, ...docSnap.data() });
            });
            renderChatMessagesList(docs, nick);
        } catch (err) {
            const box = document.getElementById("clanChatMessages");
            if (box) {
                box.innerHTML = `<div style="font-size:12px; color:#f87171; text-align:center; margin-top:20px;">Ошибка чата: ${escapeHtml(err.message || "")}</div>`;
            }
        }
    };

    window.clanSendMessage = async function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        if (!nick) return;

        const inp = document.getElementById("clanChatInput");
        const text = (inp ? inp.value : "").trim();
        if (!text) return;
        inp.value = "";

        const me = membersCache.get(nick) || {};

        try {
            await ensureAuthSession();
            const { db, collection, addDoc } = await getFs();
            await addDoc(collection(db, "clans", currentClanData.id, "messages"), {
                sender: nick,
                senderName: me.username || nick,
                avatarUrl: me.avatarUrl || "",
                text,
                createdAt: Date.now()
            });
            touchOnlinePresence(true);
        } catch (err) {
            alert("Не удалось отправить сообщение: " + (err.message || ""));
        }
    };

    window.clanJoinOpen = async function (clanId) {
        const nick = getActiveNick();
        if (!nick) return;
        try {
            await ensureAuthSession();
            const { db, doc, runTransaction } = await getFs();
            const clanRef = doc(db, "clans", clanId);
            const userRef = doc(db, "users", nick);
            let joinedName = "";

            await runTransaction(db, async (tx) => {
                const userSnap = await tx.get(userRef);
                if (userSnap.exists() && userSnap.data().clanId) {
                    throw new Error("Вы уже состоите в другом клане!");
                }
                const clanSnap = await tx.get(clanRef);
                if (!clanSnap.exists()) throw new Error("Клан не найден");
                const cData = clanSnap.data();
                if (cData.accessType !== "open") {
                    throw new Error("Этот клан не открыт для свободного входа");
                }
                joinedName = cData.name || clanId;
                const members = Array.isArray(cData.members) ? [...cData.members] : [];
                if (!members.includes(nick)) members.push(nick);

                const updateObj = { members };
                if (!cData.leader) {
                    updateObj.leader = nick;
                }
                tx.update(clanRef, updateObj);
                tx.update(userRef, { clanId, clanName: joinedName });
            });

            userClanCache.set(nick, { clanId, clanName: joinedName });
            viewedOtherClanId = null;
            clanSubView = "hub";
            await syncUserClanAndRender(nick, null);
        } catch (err) {
            alert(err.message || "Не удалось вступить в клан");
        }
    };

    window.clanRequestJoin = async function (clanId) {
        const nick = getActiveNick();
        if (!nick) return;
        try {
            await ensureAuthSession();
            const { db, doc, updateDoc, arrayUnion } = await getFs();
            await updateDoc(doc(db, "clans", clanId), {
                joinRequests: arrayUnion(nick)
            });
            alert("Заявка на вступление отправлена Главе клана!");
        } catch (err) {
            alert("Ошибка отправки заявки: " + err.message);
        }
    };

    window.clanApproveRequest = async function (clanId, reqNick) {
        try {
            await ensureAuthSession();
            const { db, doc, runTransaction } = await getFs();
            const clanRef = doc(db, "clans", clanId);
            const reqUserRef = doc(db, "users", reqNick);

            await runTransaction(db, async (tx) => {
                const clanSnap = await tx.get(clanRef);
                if (!clanSnap.exists()) return;
                const cData = clanSnap.data();
                const members = Array.isArray(cData.members) ? [...cData.members] : [];
                if (!members.includes(reqNick)) members.push(reqNick);
                const reqs = Array.isArray(cData.joinRequests) ? cData.joinRequests.filter((x) => x !== reqNick) : [];

                const updateObj = { members, joinRequests: reqs };
                if (!cData.leader) updateObj.leader = reqNick;
                tx.update(clanRef, updateObj);
                tx.update(reqUserRef, { clanId, clanName: cData.name || clanId });
            });
            userClanCache.set(String(reqNick).toLowerCase(), { clanId, clanName: currentClanData?.name || clanId });
        } catch (err) {
            alert("Ошибка принятия заявки: " + err.message);
        }
    };

    window.clanRejectRequest = async function (clanId, reqNick) {
        try {
            await ensureAuthSession();
            const { db, doc, updateDoc, arrayRemove } = await getFs();
            await updateDoc(doc(db, "clans", clanId), {
                joinRequests: arrayRemove(reqNick)
            });
        } catch (err) {
            alert("Ошибка отклонения заявки: " + err.message);
        }
    };

    window.clanLeave = async function (clanId) {
        const nick = getActiveNick();
        if (!nick) return;
        if (!confirm("Выйти из клана?")) return;

        try {
            await ensureAuthSession();
            const { db, doc, runTransaction } = await getFs();
            const clanRef = doc(db, "clans", clanId);
            const userRef = doc(db, "users", nick);

            await runTransaction(db, async (tx) => {
                const clanSnap = await tx.get(clanRef);
                if (!clanSnap.exists()) return;
                const cData = clanSnap.data();
                const remainingMembers = (Array.isArray(cData.members) ? cData.members : []).filter((m) => m !== nick);
                const updateObj = { members: remainingMembers };

                if (cData.leader === nick) {
                    updateObj.leader = null;
                }

                tx.update(clanRef, updateObj);
                tx.update(userRef, { clanId: null, clanName: null });
            });

            userClanCache.set(nick, null);
            viewedOtherClanId = null;
            clanSubView = "hub";
            stopChatListener();
            await syncUserClanAndRender(nick, null);
        } catch (err) {
            alert("Ошибка выхода из клана: " + err.message);
        }
    };

    window.clanDelete = async function (clanId) {
        const nick = getActiveNick();
        if (!nick) return;
        if (!confirm("Вы точно хотите удалить клан навсегда? Это действие нельзя отменить.")) return;

        try {
            await ensureAuthSession();
            const { db, doc, getDoc, updateDoc, deleteDoc } = await getFs();
            const clanRef = doc(db, "clans", clanId);
            const snap = await getDoc(clanRef);
            if (!snap.exists()) return;
            const cData = snap.data();

            const members = Array.isArray(cData.members) ? cData.members : [];
            for (const m of members) {
                const mClean = String(m).toLowerCase();
                userClanCache.set(mClean, null);
                await updateDoc(doc(db, "users", mClean), {
                    clanId: null,
                    clanName: null
                }).catch(() => {});
            }

            if (cData.nameLower) {
                await deleteDoc(doc(db, "clanNames", cData.nameLower)).catch(() => {});
            }
            await deleteDoc(clanRef);

            userClanCache.set(nick, null);
            viewedOtherClanId = null;
            clanSubView = "hub";
            stopChatListener();
            await syncUserClanAndRender(nick, null);
        } catch (err) {
            alert("Ошибка удаления клана: " + err.message);
        }
    };

    window.addClanMilliliters = async function (clanId, deltaMl) {
        if (!clanId || typeof deltaMl !== "number") return;
        await ensureAuthSession();
        const { db, doc, increment, updateDoc } = await getFs();
        await updateDoc(doc(db, "clans", clanId), {
            mlBalance: increment(deltaMl)
        });
    };

    // --- СТАБИЛЬНОЕ ОТОБРАЖЕНИЕ КЛАНА В КАРТОЧКАХ ДРУЗЕЙ ---
    function applyBadgeToCard(card, info) {
        const nameEl = card.querySelector(".user-result-name");
        const metaEl = card.querySelector(".user-result-meta");
        if (!nameEl || !metaEl || !metaEl.parentElement) return;

        const targetParent = metaEl.parentElement;
        let badge = targetParent.querySelector(".clan-friend-status-badge");

        if (!badge) {
            badge = document.createElement("span");
            badge.className = "clan-friend-status-badge";
            targetParent.appendChild(badge);
        }

        if (info && info.clanId) {
            const label = `Клан: ${info.clanName || info.clanId}`;
            if (badge.textContent !== label || !badge.classList.contains("clan-badge-link")) {
                badge.className = "clan-friend-status-badge clan-badge-link";
                badge.textContent = label;
                badge.onclick = (ev) => {
                    ev.stopPropagation();
                    openClanPage(info.clanId);
                };
            }
        } else {
            if (badge.textContent !== "Не в клане" || !badge.classList.contains("clan-badge-none")) {
                badge.className = "clan-friend-status-badge clan-badge-none";
                badge.textContent = "Не в клане";
                badge.onclick = null;
            }
        }
    }

    async function enrichFriendsWithClans() {
        const container = document.getElementById("friendsResultsContainer");
        if (!container) return;

        const cards = container.querySelectorAll(".user-result-card");
        if (!cards.length) return;

        const nicksToFetch = [];

        for (const card of cards) {
            const nameEl = card.querySelector(".user-result-name");
            if (!nameEl) continue;
            const friendNick = nameEl.textContent.trim().toLowerCase();
            if (!friendNick) continue;

            if (userClanCache.has(friendNick)) {
                applyBadgeToCard(card, userClanCache.get(friendNick));
            } else if (!pendingClanLookups.has(friendNick)) {
                nicksToFetch.push(friendNick);
            }
        }

        if (!nicksToFetch.length) return;

        await ensureAuthSession();
        const { db, doc, getDoc } = await getFs();

        for (const friendNick of nicksToFetch) {
            if (pendingClanLookups.has(friendNick)) continue;
            pendingClanLookups.add(friendNick);
            try {
                const uSnap = await getDoc(doc(db, "users", friendNick));
                let info = null;
                if (uSnap.exists() && uSnap.data().clanId) {
                    const cId = uSnap.data().clanId;
                    let cName = uSnap.data().clanName || "";
                    if (!cName) {
                        const cSnap = await getDoc(doc(db, "clans", cId));
                        if (cSnap.exists()) cName = cSnap.data().name || cId;
                    }
                    info = { clanId: cId, clanName: cName };
                }
                userClanCache.set(friendNick, info);
            } catch (_) {
                userClanCache.set(friendNick, null);
            } finally {
                pendingClanLookups.delete(friendNick);
            }
        }

        const updatedCards = container.querySelectorAll(".user-result-card");
        for (const card of updatedCards) {
            const nameEl = card.querySelector(".user-result-name");
            if (!nameEl) continue;
            const friendNick = nameEl.textContent.trim().toLowerCase();
            if (userClanCache.has(friendNick)) {
                applyBadgeToCard(card, userClanCache.get(friendNick));
            }
        }
    }

    function escapeHtml(str) {
        return String(str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function escapeAttr(str) {
        return String(str || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    }

    function attachFriendsObserver() {
        const friendsBox = document.getElementById("friendsResultsContainer");
        if (friendsBox && !friendsObserverAttached) {
            friendsObserverAttached = true;
            const obs = new MutationObserver(() => {
                enrichFriendsWithClans();
            });
            obs.observe(friendsBox, { childList: true });
            enrichFriendsWithClans();
        }
    }

    async function initBackgroundClanState() {
        const nick = getActiveNick();
        if (!nick) return;
        try {
            await ensureAuthSession();
            const { db, doc, getDoc } = await getFs();
            const snap = await getDoc(doc(db, "users", nick));
            if (snap.exists() && snap.data().clanId) {
                const cId = snap.data().clanId;
                currentClanId = cId;
                await attachBackgroundChatWatcher(nick, cId);
            }
        } catch (_) {}
    }

    function startLightSync() {
        attachFriendsObserver();
        startPresenceHeartbeat();
        initBackgroundClanState();

        setInterval(() => {
            updateOpenClanBtnVisibility();
            attachFriendsObserver();
            if (document.getElementById("friendsResultsContainer")?.children.length) {
                enrichFriendsWithClans().catch(() => {});
            }
        }, 400);
    }

    setTimeout(() => {
        injectStyles();
        createUiElements();
        updateOpenClanBtnVisibility();
        startLightSync();
    }, 500);
})();
