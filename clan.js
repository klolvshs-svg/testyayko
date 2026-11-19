// clan.js — Модуль кланов (сброс прав при кике, права Наполнителя, чат слева/справа, «пишет...», прочитано, баланс мл)

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
    let typingStopTimer = null;
    let lastTypingPingMs = 0;
    let currentClanData = null;
    let currentClanId = null;
    let viewedOtherClanId = null;
    let clanSubView = "hub"; // "hub" | "settings" | "chat" | "donate" | "memberManage"
    let managedMemberNick = null;
    let membersCache = new Map();
    let userClanCache = new Map();
    let pendingClanLookups = new Set();
    let createAvatarDataUrl = "";
    let editAvatarDataUrl = null;
    let liveTimerInterval = null;
    let decorAnimId = null;
    let friendsObserverAttached = false;

    // Чат и выделение сообщений
    let unreadChatCount = 0;
    let knownMessageIds = new Set();
    let initialChatLoaded = false;
    let latestChatDocs = [];
    let selectedMsgIds = new Set();

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
            deleteField: mod.deleteField,
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
            increment: mod.increment
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

    function extractUserMl(uData) {
        if (!uData || typeof uData !== "object") return 0;
        const keys = ["ml", "milliliters", "mlBalance", "water", "waterMl", "balance", "liquid", "drops", "mlCount"];
        for (const k of keys) {
            if (typeof uData[k] === "number" && Number.isFinite(uData[k])) {
                return Math.max(0, Math.round(uData[k] * 1000) / 1000);
            }
            if (typeof uData[k] === "string" && uData[k].trim() !== "") {
                const n = parseFloat(uData[k].replace(",", "."));
                if (Number.isFinite(n)) return Math.max(0, Math.round(n * 1000) / 1000);
            }
        }
        for (const nestedKey of ["stats", "profile", "data", "game"]) {
            if (uData[nestedKey] && typeof uData[nestedKey] === "object") {
                const nestedVal = extractUserMl(uData[nestedKey]);
                if (nestedVal > 0) return nestedVal;
            }
        }
        return 0;
    }

    function detectEffectivePlayerMl(fsUserData = null) {
        const values = [];
        const fsVal = extractUserMl(fsUserData);
        if (fsVal > 0) values.push(fsVal);

        const winKeys = [
            "ml",
            "playerMl",
            "userMl",
            "currentMl",
            "mlBalance",
            "waterMl",
            "balanceMl",
            "totalMl",
            "savedMl"
        ];
        for (const k of winKeys) {
            if (typeof window[k] === "number" && Number.isFinite(window[k]) && window[k] > 0) {
                values.push(window[k]);
            }
        }

        // Проверяем все ключи localStorage, где упоминается ml / мл
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i) || "";
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes("clan")) continue;
                if (lowerKey.includes("ml") || lowerKey.includes("water") || lowerKey.includes("balance")) {
                    const raw = localStorage.getItem(key);
                    if (raw && raw.length < 40) {
                        const n = parseFloat(String(raw).replace(",", "."));
                        if (Number.isFinite(n) && n > 0) values.push(n);
                    }
                }
            }
        } catch (_) {}

        // Поиск в DOM игры и профиля (исключая сам оверлей клана и карточки друзей)
        const selectors = [
            "#mlDisplay",
            "#playerMl",
            "#userMl",
            "#balanceMl",
            "#mlValue",
            "#profileMl",
            "#drawerMl",
            ".ml-value",
            ".player-ml",
            "[data-ml]"
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (!el || el.closest("#clanPageOverlay") || el.closest("#friendsResultsContainer")) continue;
            const attrVal = el.getAttribute("data-ml");
            if (attrVal !== null) {
                const n = parseFloat(String(attrVal).replace(",", "."));
                if (Number.isFinite(n) && n > 0) values.push(n);
            }
            const parsed = parseMlFromText(el.textContent);
            if (parsed !== null && parsed > 0) values.push(parsed);
        }

        // Сканируем элементы шторки профиля вне списка друзей
        const drawer = document.getElementById("profileDrawer");
        if (drawer) {
            const nodes = drawer.querySelectorAll("span, div, b, strong, p");
            for (const node of nodes) {
                if (node.closest("#friendsResultsContainer") || node.children.length > 2) continue;
                const txt = node.textContent || "";
                if (txt.includes("мл") && txt.length < 40) {
                    const parsed = parseMlFromText(txt);
                    if (parsed !== null && parsed > 0) values.push(parsed);
                }
            }
        }

        // Сканируем верхний HUD на экране вне оверлея клана
        const hudNodes = document.querySelectorAll("body > div span, body > div div, #startScreen span, #startScreen div");
        for (const node of hudNodes) {
            if (node.closest("#clanPageOverlay") || node.closest("#profileDrawer") || node.children.length > 2) continue;
            const txt = node.textContent || "";
            if (txt.includes("мл") && txt.length < 36) {
                const parsed = parseMlFromText(txt);
                if (parsed !== null && parsed > 0) values.push(parsed);
            }
        }

        if (!values.length) return 0;
        const best = Math.max(...values.filter((v) => Number.isFinite(v)));
        return Math.max(0, Math.round(best * 1000) / 1000);
    }

    function applyLocalPlayerMlValue(nextVal) {
        const cleanVal = Math.max(0, Math.round(nextVal * 1000) / 1000);
        const winKeys = [
            "ml",
            "playerMl",
            "userMl",
            "currentMl",
            "mlBalance",
            "waterMl",
            "balanceMl",
            "totalMl",
            "savedMl"
        ];
        for (const k of winKeys) {
            if (typeof window[k] === "number" && Number.isFinite(window[k])) {
                window[k] = cleanVal;
            }
        }
        const lsKeys = ["egg_ml", "player_ml", "user_ml", "ml_balance", "ml"];
        for (const k of lsKeys) {
            if (localStorage.getItem(k) !== null) {
                localStorage.setItem(k, String(cleanVal));
            }
        }
        const nick = getActiveNick();
        if (nick && membersCache.has(nick)) {
            const prev = membersCache.get(nick);
            membersCache.set(nick, { ...prev, ml: cleanVal });
        }
    }

    // --- ПРАВА И ЗВАНИЯ В КЛАНЕ ---
    function getMemberRoleMeta(clan, cleanNick) {
        if (!clan) {
            return {
                title: "Участник",
                isLeader: false,
                isFiller: false,
                canDeleteMsg: false,
                canDeleteFillerMsg: false,
                canMute: false,
                canKick: false,
                canPromote: false
            };
        }
        if (String(clan.leader || "").toLowerCase() === cleanNick) {
            return {
                title: "Глава",
                isLeader: true,
                isFiller: false,
                canDeleteMsg: true,
                canDeleteFillerMsg: true,
                canMute: true,
                canKick: true,
                canPromote: true
            };
        }
        const rolesMap = clan.memberRoles && typeof clan.memberRoles === "object" ? clan.memberRoles : {};
        const r = rolesMap[cleanNick] || {};
        const isFiller = Boolean(r.isFiller || r.role === "filler");
        const canPromote = Boolean(r.canPromote);
        const canDeleteMsg = Boolean(r.canDeleteMsg);
        const canDeleteFillerMsg = Boolean(r.canDeleteFillerMsg);
        const canMute = Boolean(r.canMute);
        const canKick = Boolean(r.canKick);

        return {
            title: isFiller ? "Наполнитель" : "Участник",
            isLeader: false,
            isFiller,
            canDeleteMsg,
            canDeleteFillerMsg,
            canMute,
            canKick,
            canPromote
        };
    }

    function canUserDeleteChatMessage(clan, myNick, msgSenderNick) {
        const senderClean = String(msgSenderNick || "").toLowerCase();
        if (!senderClean) return false;
        if (senderClean === myNick) return true;

        const myPerms = getMemberRoleMeta(clan, myNick);
        if (myPerms.isLeader) return true;

        const senderPerms = getMemberRoleMeta(clan, senderClean);
        if (senderPerms.isLeader) return false;

        if (senderPerms.isFiller) {
            return Boolean(myPerms.canDeleteFillerMsg);
        }
        return Boolean(myPerms.canDeleteMsg);
    }

    function isUserMutedInClan(clan, cleanNick) {
        if (!clan || !Array.isArray(clan.mutedMembers)) return false;
        return clan.mutedMembers.map((x) => String(x).toLowerCase()).includes(cleanNick);
    }

    // --- СТАТИЧНЫЕ РАМКИ АВАТАРОК (БЕЗ ЛАГОВ) ---
    function getStaticFrameStyle(frameId) {
        switch (frameId) {
            case "gold":
                return "border: 2px solid #facc15; box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.35);";
            case "crimson":
                return "border: 2px solid #ef4444; box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.35);";
            case "cyan":
                return "border: 2px solid #38bdf8; box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35);";
            case "emerald":
                return "border: 2px solid #4ade80; box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.35);";
            case "violet":
                return "border: 2px solid #c084fc; box-shadow: 0 0 0 1px rgba(192, 132, 252, 0.35);";
            default:
                return "border: 2px solid #94a3b8;";
        }
    }

    function extractFrameId(uData, clan) {
        const clean = String(uData?.username_lower || uData?.username || "").toLowerCase();
        if (clan && clan.memberFrames && typeof clan.memberFrames === "object" && clean && clan.memberFrames[clean]) {
            return String(clan.memberFrames[clean]);
        }
        return String(uData?.avatarFrame || uData?.frameId || uData?.frame || "default");
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
                background: rgba(15, 23, 33, 0.72);
                border-radius: 10px;
                padding: 8px 10px;
                text-align: left;
            }
            .clan-member-ava {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                object-fit: cover;
                flex-shrink: 0;
            }
            .clan-member-gear-btn {
                width: 30px;
                height: 30px;
                border-radius: 8px;
                border: 1px solid rgba(148, 163, 184, 0.3);
                background: rgba(30, 41, 59, 0.85);
                color: #e2e8f0;
                font-size: 14px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            .clan-member-gear-btn:active {
                transform: scale(0.94);
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
            .clan-action-btn:disabled {
                background: #475569 !important;
                color: #94a3b8 !important;
                cursor: not-allowed;
                opacity: 0.65;
            }

            /* Групповой чат клана */
            .clan-chat-header {
                width: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 3px;
                margin-bottom: 8px;
            }
            .clan-chat-title {
                font-size: 19px;
                font-weight: bold;
                color: #4ade80;
                text-align: center;
                word-break: break-word;
            }
            .clan-chat-stats {
                font-size: 12px;
                font-weight: bold;
                color: #4ade80;
                text-align: center;
                line-height: 1.35;
            }
            .clan-chat-typing {
                font-size: 11px;
                font-weight: 600;
                color: #38bdf8;
                min-height: 15px;
                text-align: center;
            }
            .clan-chat-selection-bar {
                width: 100%;
                display: none;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                background: rgba(220, 38, 38, 0.2);
                border: 1px solid rgba(248, 113, 113, 0.45);
                border-radius: 9px;
                padding: 6px 10px;
                margin-bottom: 8px;
                box-sizing: border-box;
                font-size: 12px;
                font-weight: bold;
                color: #fecaca;
            }
            .clan-chat-messages {
                width: 100%;
                height: 310px;
                max-height: 50vh;
                overflow-y: auto;
                background: rgba(10, 16, 24, 0.75);
                border: 1px solid rgba(148, 163, 184, 0.22);
                border-radius: 12px;
                padding: 10px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                gap: 8px;
                margin-bottom: 10px;
            }
            .clan-chat-msg-wrap {
                width: 100%;
                display: flex;
                flex-direction: column;
            }
            .clan-chat-msg-wrap.mine-wrap {
                align-items: flex-end;
            }
            .clan-chat-msg-wrap.other-wrap {
                align-items: flex-start;
            }
            .clan-chat-msg {
                max-width: 84%;
                display: flex;
                align-items: flex-start;
                gap: 8px;
                background: rgba(30, 41, 59, 0.78);
                border: 1px solid transparent;
                border-radius: 12px;
                padding: 7px 10px;
                text-align: left;
                cursor: pointer;
                user-select: none;
            }
            .clan-chat-msg.mine {
                background: rgba(14, 116, 144, 0.42);
                border-color: rgba(56, 189, 248, 0.22);
            }
            .clan-chat-msg.selected {
                border-color: #ef4444 !important;
                background: rgba(153, 27, 27, 0.42) !important;
            }
            .clan-chat-ava {
                width: 30px;
                height: 30px;
                border-radius: 50%;
                object-fit: cover;
                flex-shrink: 0;
                margin-top: 2px;
            }
            .clan-read-avatars {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 3px;
                margin-top: 3px;
                padding-right: 4px;
            }
            .clan-read-ava-mini {
                width: 15px;
                height: 15px;
                border-radius: 50%;
                object-fit: cover;
                border: 1px solid rgba(148, 163, 184, 0.6);
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
            .clan-perm-toggle {
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                background: rgba(30, 41, 59, 0.65);
                border: 1px solid rgba(148, 163, 184, 0.22);
                border-radius: 10px;
                padding: 9px 12px;
                margin-bottom: 8px;
                box-sizing: border-box;
                font-size: 13px;
                color: #e2e8f0;
                cursor: pointer;
            }
            .clan-perm-toggle.disabled-perm {
                background: rgba(30, 41, 59, 0.35);
                border-color: rgba(100, 116, 139, 0.2);
                color: #64748b;
                cursor: not-allowed;
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
            const payload = {
                lastActive: nowMs,
                lastSeenMs: nowMs,
                isOnline: Boolean(isOnlineFlag),
                online: Boolean(isOnlineFlag)
            };
            const localMl = detectEffectivePlayerMl(membersCache.get(nick));
            if (localMl > 0) {
                payload.ml = localMl;
            }
            await setDoc(doc(db, "users", nick), payload, { merge: true });
            const prev = membersCache.get(nick) || {};
            membersCache.set(nick, { ...prev, ...payload });
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
                            updateChatStatsHeader();
                        }
                    }
                });
                membersLiveUnsubs.push(unsub);
            }
        }).catch(() => {});
    }

    // --- ОТМЕТКА О ПРОСМОТРЕ СООБЩЕНИЙ В ЧАТЕ ---
    async function markMessagesReadByMe(docs, nick) {
        if (!currentClanData || !nick || !Array.isArray(docs) || !docs.length) return;
        const unreadForMe = docs.filter((m) => {
            const sender = String(m.sender || "").toLowerCase();
            if (!sender || sender === nick) return false;
            const readBy = Array.isArray(m.readBy) ? m.readBy.map((x) => String(x).toLowerCase()) : [];
            return !readBy.includes(nick);
        });
        if (!unreadForMe.length) return;

        try {
            await ensureAuthSession();
            const { db, doc, updateDoc, arrayUnion } = await getFs();
            for (const m of unreadForMe) {
                await updateDoc(doc(db, "clans", currentClanData.id, "messages", m.id), {
                    readBy: arrayUnion(nick)
                }).catch(() => {});
            }
        } catch (_) {}
    }

    // --- СЛУШАТЕЛЬ СООБЩЕНИЙ ЧАТА ---
    async function attachBackgroundChatWatcher(nick, clanId) {
        stopChatListener();
        knownMessageIds = new Set();
        initialChatLoaded = false;
        selectedMsgIds.clear();
        unreadChatCount = loadSavedUnreadCount(nick, clanId);
        updateUnreadIndicators();

        if (!nick || !clanId) return;

        try {
            await ensureAuthSession();
            const { db, collection, query, orderBy, limit, onSnapshot } = await getFs();
            const msgsCol = collection(db, "clans", clanId, "messages");
            const q = query(msgsCol, orderBy("createdAt", "asc"), limit(100));

            chatUnsub = onSnapshot(
                q,
                (snap) => {
                    const docs = [];
                    snap.forEach((docSnap) => {
                        docs.push({ id: docSnap.id, ...docSnap.data() });
                    });
                    latestChatDocs = docs;

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
                        markMessagesReadByMe(docs, nick);
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

    // --- ИНДИКАТОР «ПИШЕТ...» В ЧАТЕ ---
    async function setMyTypingState(isTyping) {
        if (!currentClanData) return;
        const nick = getActiveNick();
        if (!nick) return;
        try {
            await ensureAuthSession();
            const { db, doc, updateDoc, deleteField } = await getFs();
            const fieldPath = `typingUsers.${nick}`;
            await updateDoc(doc(db, "clans", currentClanData.id), {
                [fieldPath]: isTyping ? Date.now() : deleteField()
            }).catch(() => {});
        } catch (_) {}
    }

    window.clanOnChatTyping = function () {
        const now = Date.now();
        if (now - lastTypingPingMs > 2000) {
            lastTypingPingMs = now;
            setMyTypingState(true);
        }
        if (typingStopTimer) clearTimeout(typingStopTimer);
        typingStopTimer = setTimeout(() => {
            setMyTypingState(false);
        }, 3000);
    };

    function updateChatTypingIndicator() {
        const el = document.getElementById("clanChatTyping");
        if (!el || !currentClanData) return;
        const myNick = getActiveNick();
        const typingMap = currentClanData.typingUsers && typeof currentClanData.typingUsers === "object" ? currentClanData.typingUsers : {};
        const now = Date.now();

        const activeTypers = [];
        for (const [tNick, ts] of Object.entries(typingMap)) {
            const clean = String(tNick).toLowerCase();
            if (clean === myNick) continue;
            if (typeof ts === "number" && now - ts < 4500) {
                const uData = membersCache.get(clean) || {};
                activeTypers.push(uData.username || clean);
            }
        }

        if (activeTypers.length === 0) {
            el.textContent = "";
        } else if (activeTypers.length === 1) {
            el.textContent = `${activeTypers[0]} пишет...`;
        } else if (activeTypers.length === 2) {
            el.textContent = `${activeTypers[0]}, ${activeTypers[1]} пишут...`;
        } else {
            el.textContent = `пишет ${activeTypers.length} человека...`;
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
        managedMemberNick = null;
        selectedMsgIds.clear();
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
            if (clanSubView === "chat") {
                setMyTypingState(false);
            }
            clanSubView = "hub";
            managedMemberNick = null;
            selectedMsgIds.clear();
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
        if (clanSubView === "chat") {
            setMyTypingState(false);
        }
        clanPageOpen = false;
        viewedOtherClanId = null;
        clanSubView = "hub";
        managedMemberNick = null;
        selectedMsgIds.clear();
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
                    updateChatStatsHeader();
                    updateChatTypingIndicator();
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
                updateChatStatsHeader();
                updateChatTypingIndicator();
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
                    mutedMembers: [],
                    memberRoles: {},
                    memberFrames: {},
                    typingUsers: {},
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
        if (cleanNick === myNick && !document.hidden && (clanPageOpen || window.gameStarted === true || isElementVisible(document.getElementById("startScreen")))) {
            return true;
        }
        if (!data) return false;
        if (data.isOnline === false || data.online === false) return false;
        const lastActive = Math.max(extractTimestampMs(data.lastActive), extractTimestampMs(data.lastSeenMs));
        return Boolean(lastActive && Date.now() - lastActive < 18000);
    }

    function isMemberSavingSkin(cleanNick, data) {
        if (!data) return false;
        if (cleanNick === getActiveNick() && window.gameStarted === true && !window.gameOver) {
            return true;
        }
        return Boolean(data.inGame && isMemberOnlineNow(cleanNick, data));
    }

    function countOnlineStats(memberNicks) {
        if (!Array.isArray(memberNicks)) return { online: 0, total: 0, savingSkin: 0 };
        const total = memberNicks.length;
        let online = 0;
        let savingSkin = 0;
        for (const m of memberNicks) {
            const clean = String(m).toLowerCase();
            const uData = membersCache.get(clean);
            if (isMemberOnlineNow(clean, uData)) {
                online += 1;
            }
            if (isMemberSavingSkin(clean, uData)) {
                savingSkin += 1;
            }
        }
        return { online, total, savingSkin };
    }

    function formatMemberStatus(cleanNick, data) {
        if (isMemberOnlineNow(cleanNick, data)) {
            if (isMemberSavingSkin(cleanNick, data)) {
                if (data && data.currentBossName) {
                    return { text: `Спасает кожицу от ${data.currentBossName}`, color: "#38bdf8" };
                }
                const startMs = data ? extractTimestampMs(data.gameStartTime) : 0;
                const diffSec = startMs ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
                const mins = String(Math.floor(diffSec / 60)).padStart(2, "0");
                const secs = String(diffSec % 60).padStart(2, "0");
                return { text: `Спасает кожицу [${mins}:${secs}]`, color: "#4ade80" };
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
            actionButtonsHtml = `
                <div class="clan-toolbar-row">
                    ${isLeader ? `<button class="clan-mini-btn clan-gear-btn" style="background:rgba(30, 41, 59, 0.85);" title="Настройки клана" onclick="clanOpenSettingsView()">⚙️</button>` : ""}
                    <button class="clan-mini-btn" style="background:rgba(15, 23, 33, 0.78); border-color:rgba(148, 163, 184, 0.35);" onclick="clanOpenDonateView()">💧 Вложить</button>
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
                updateChatStatsHeader();
                updateChatTypingIndicator();
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

        const myNick = getActiveNick();
        const myPerms = getMemberRoleMeta(currentClanData, myNick);

        listEl.innerHTML = members
            .map((mNick) => {
                const clean = String(mNick).toLowerCase();
                const uData = membersCache.get(clean) || {};
                const displayName = uData.username || clean;
                const avaSrc = uData.avatarUrl || "https://via.placeholder.com/70";
                const status = formatMemberStatus(clean, uData);
                const roleMeta = getMemberRoleMeta(currentClanData, clean);
                const roleTag = roleMeta.title !== "Участник" ? ` [${roleMeta.title}]` : "";
                const mutedTag = isUserMutedInClan(currentClanData, clean) ? ` (мут)` : "";
                const frameStyle = getStaticFrameStyle(extractFrameId(uData, currentClanData));

                let memberMl = extractUserMl(uData);
                if (clean === myNick) {
                    memberMl = detectEffectivePlayerMl(uData);
                }

                // Шестерёнка видна Главе или Наполнителю с правами (только на обычных участников, не на Главу и не на других Наполнителей)
                const isTargetProtected = roleMeta.isLeader || (!myPerms.isLeader && roleMeta.isFiller);
                const canShowGear =
                    clean !== myNick &&
                    !isTargetProtected &&
                    (myPerms.isLeader || myPerms.canPromote || myPerms.canMute || myPerms.canKick);

                return `
                    <div class="clan-member-row">
                        <div style="display:flex; align-items:center; gap:10px; overflow:hidden; min-width:0;">
                            <img src="${avaSrc}" class="clan-member-ava" style="${frameStyle}" alt="ava">
                            <div style="overflow:hidden; min-width:0;">
                                <div style="font-size:13px; font-weight:bold; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(displayName)}${escapeHtml(roleTag)}${escapeHtml(mutedTag)}</div>
                                <div style="font-size:11px; color:#cbd5e1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                    <span style="color:#38bdf8; font-weight:bold;">💧 ${memberMl.toFixed(3)} мл</span>
                                    <span style="color:#64748b;"> | </span>
                                    <span style="color:${status.color};">${escapeHtml(status.text)}</span>
                                </div>
                            </div>
                        </div>
                        ${
                            canShowGear
                                ? `<button class="clan-member-gear-btn" title="Управление участником" onclick="clanOpenMemberManage('${escapeAttr(clean)}')">⚙️</button>`
                                : ""
                        }
                    </div>
                `;
            })
            .join("");
    }

    // --- УПРАВЛЕНИЕ УЧАСТНИКОМ (⚙️ В КАРТОЧКЕ УЧАСТНИКА) ---
    window.clanOpenMemberManage = function (targetNick) {
        if (!currentClanData) return;
        const cleanTarget = String(targetNick).toLowerCase();
        const myNick = getActiveNick();
        const myPerms = getMemberRoleMeta(currentClanData, myNick);
        const targetRole = getMemberRoleMeta(currentClanData, cleanTarget);

        if (targetRole.isLeader) return;
        if (!myPerms.isLeader && targetRole.isFiller) return;
        if (!myPerms.isLeader && !myPerms.canPromote && !myPerms.canMute && !myPerms.canKick) return;

        managedMemberNick = cleanTarget;
        clanSubView = "memberManage";

        const view = document.getElementById("clanScrollView");
        if (!view) return;

        const isMuted = isUserMutedInClan(currentClanData, cleanTarget);
        const uData = membersCache.get(cleanTarget) || {};
        const displayName = uData.username || cleanTarget;

        const canPromoteNow = Boolean(myPerms.isLeader || myPerms.canPromote);
        const canMuteNow = Boolean(myPerms.isLeader || myPerms.canMute);
        const canKickNow = Boolean(myPerms.isLeader || myPerms.canKick);

        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 10px;">
                <h3 style="margin: 0 0 6px 0; color: #e2e8f0;">${escapeHtml(displayName)}</h3>
                <div style="font-size:12px; color:#38bdf8; margin-bottom:14px;">Звание: ${escapeHtml(targetRole.title)}</div>

                <div style="width:100%; font-size:12px; font-weight:bold; color:#cbd5e1; text-align:left; margin-bottom:6px;">Звание и права:</div>

                <div class="clan-perm-toggle ${canPromoteNow ? "" : "disabled-perm"}" ${
                    canPromoteNow ? `onclick="clanToggleMemberRole('${escapeAttr(cleanTarget)}', 'filler')"` : ""
                }>
                    <span>Звание «Наполнитель»</span>
                    <span style="font-weight:bold; color:${canPromoteNow ? (targetRole.isFiller ? "#4ade80" : "#94a3b8") : "#64748b"};">${targetRole.isFiller ? "Выдано" : "Нет"}</span>
                </div>

                <div class="clan-perm-toggle ${canPromoteNow ? "" : "disabled-perm"}" ${
                    canPromoteNow ? `onclick="clanToggleMemberRole('${escapeAttr(cleanTarget)}', 'canDeleteMsg')"` : ""
                }>
                    <span>Удалять сообщения участников</span>
                    <span style="font-weight:bold; color:${canPromoteNow ? (targetRole.canDeleteMsg ? "#4ade80" : "#94a3b8") : "#64748b"};">${targetRole.canDeleteMsg ? "Да" : "Нет"}</span>
                </div>

                <div class="clan-perm-toggle ${canPromoteNow ? "" : "disabled-perm"}" ${
                    canPromoteNow ? `onclick="clanToggleMemberRole('${escapeAttr(cleanTarget)}', 'canDeleteFillerMsg')"` : ""
                }>
                    <span>Удалять сообщения Наполнителей</span>
                    <span style="font-weight:bold; color:${canPromoteNow ? (targetRole.canDeleteFillerMsg ? "#4ade80" : "#94a3b8") : "#64748b"};">${targetRole.canDeleteFillerMsg ? "Да" : "Нет"}</span>
                </div>

                <div class="clan-perm-toggle ${canPromoteNow ? "" : "disabled-perm"}" ${
                    canPromoteNow ? `onclick="clanToggleMemberRole('${escapeAttr(cleanTarget)}', 'canMute')"` : ""
                }>
                    <span>Мутить участников в чате</span>
                    <span style="font-weight:bold; color:${canPromoteNow ? (targetRole.canMute ? "#4ade80" : "#94a3b8") : "#64748b"};">${targetRole.canMute ? "Да" : "Нет"}</span>
                </div>

                <div class="clan-perm-toggle ${canPromoteNow ? "" : "disabled-perm"}" ${
                    canPromoteNow ? `onclick="clanToggleMemberRole('${escapeAttr(cleanTarget)}', 'canKick')"` : ""
                }>
                    <span>Кикать участников</span>
                    <span style="font-weight:bold; color:${canPromoteNow ? (targetRole.canKick ? "#4ade80" : "#94a3b8") : "#64748b"};">${targetRole.canKick ? "Да" : "Нет"}</span>
                </div>

                <div style="display:flex; gap:8px; width:100%; margin-top:10px;">
                    <button class="clan-action-btn" style="flex:1; background:${isMuted ? "#16a34a" : "#d97706"};" ${
                        canMuteNow ? `onclick="clanToggleMuteMember('${escapeAttr(cleanTarget)}')"` : "disabled"
                    }>${isMuted ? "Размутить в чате" : "Замутить в чате"}</button>

                    <button class="clan-action-btn" style="flex:1; background:#dc2626;" ${
                        canKickNow ? `onclick="clanKickMember('${escapeAttr(cleanTarget)}')"` : "disabled"
                    }>Кикнуть</button>
                </div>
            </div>
        `;
    };

    window.clanToggleMemberRole = async function (targetNick, permKey) {
        if (!currentClanData) return;
        const myNick = getActiveNick();
        const myPerms = getMemberRoleMeta(currentClanData, myNick);
        if (!myPerms.isLeader && !myPerms.canPromote) return;

        const cleanTarget = String(targetNick).toLowerCase();
        const currentRole = getMemberRoleMeta(currentClanData, cleanTarget);
        const existingMap =
            currentClanData.memberRoles && typeof currentClanData.memberRoles === "object"
                ? { ...currentClanData.memberRoles }
                : {};
        const prevObj = existingMap[cleanTarget] && typeof existingMap[cleanTarget] === "object" ? { ...existingMap[cleanTarget] } : {};

        if (permKey === "filler") {
            const nextFiller = !currentRole.isFiller;
            prevObj.isFiller = nextFiller;
            prevObj.role = nextFiller ? "filler" : "member";
        } else {
            prevObj[permKey] = !currentRole[permKey];
        }

        existingMap[cleanTarget] = prevObj;

        try {
            await ensureAuthSession();
            const { db, doc, updateDoc } = await getFs();
            await updateDoc(doc(db, "clans", currentClanData.id), {
                memberRoles: existingMap
            });
            currentClanData = { ...currentClanData, memberRoles: existingMap };
            clanOpenMemberManage(cleanTarget);
        } catch (err) {
            alert("Ошибка изменения прав: " + (err.message || ""));
        }
    };

    window.clanToggleMuteMember = async function (targetNick) {
        if (!currentClanData) return;
        const myNick = getActiveNick();
        const myPerms = getMemberRoleMeta(currentClanData, myNick);
        if (!myPerms.isLeader && !myPerms.canMute) return;

        const cleanTarget = String(targetNick).toLowerCase();
        const muted = Array.isArray(currentClanData.mutedMembers)
            ? currentClanData.mutedMembers.map((x) => String(x).toLowerCase())
            : [];
        const nextMuted = muted.includes(cleanTarget)
            ? muted.filter((x) => x !== cleanTarget)
            : [...muted, cleanTarget];

        try {
            await ensureAuthSession();
            const { db, doc, updateDoc } = await getFs();
            await updateDoc(doc(db, "clans", currentClanData.id), {
                mutedMembers: nextMuted
            });
            currentClanData = { ...currentClanData, mutedMembers: nextMuted };
            clanOpenMemberManage(cleanTarget);
        } catch (err) {
            alert("Ошибка мута: " + (err.message || ""));
        }
    };

    window.clanKickMember = async function (targetNick) {
        if (!currentClanData) return;
        const myNick = getActiveNick();
        const myPerms = getMemberRoleMeta(currentClanData, myNick);
        if (!myPerms.isLeader && !myPerms.canKick) return;

        const cleanTarget = String(targetNick).toLowerCase();
        if (!confirm(`Исключить ${cleanTarget} из клана?`)) return;

        try {
            await ensureAuthSession();
            const { db, doc, runTransaction, updateDoc, deleteField } = await getFs();
            const clanRef = doc(db, "clans", currentClanData.id);
            const targetUserRef = doc(db, "users", cleanTarget);

            await runTransaction(db, async (tx) => {
                const cSnap = await tx.get(clanRef);
                if (!cSnap.exists()) return;
                const cData = cSnap.data();
                const nextMembers = (Array.isArray(cData.members) ? cData.members : []).filter(
                    (m) => String(m).toLowerCase() !== cleanTarget
                );
                const nextMuted = (Array.isArray(cData.mutedMembers) ? cData.mutedMembers : []).filter(
                    (m) => String(m).toLowerCase() !== cleanTarget
                );

                // Сбрасываем звание «Наполнитель» и все выданные права при кике
                const roleFieldPath = `memberRoles.${cleanTarget}`;
                tx.update(clanRef, {
                    members: nextMembers,
                    mutedMembers: nextMuted,
                    [roleFieldPath]: deleteField()
                });
            });

            await updateDoc(targetUserRef, { clanId: null, clanName: null }).catch(() => {});
            userClanCache.set(cleanTarget, null);
            clanSubView = "hub";
            managedMemberNick = null;
        } catch (err) {
            alert("Ошибка при исключении: " + (err.message || ""));
        }
    };

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
                membersCache.set(nick, fsUserData);
            }
        } catch (_) {}

        const myBalance = detectEffectivePlayerMl(fsUserData);
        const clanMl = Number(currentClanData.mlBalance || 0);

        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 12px;">
                <h3 style="margin: 0 0 8px 0; color: #38bdf8;">Вложить миллилитры в клан</h3>
                <div style="font-size:13px; color:#cbd5e1; margin-bottom:4px;">Казна клана: <b style="color:#38bdf8;">${clanMl.toFixed(3)} мл</b></div>
                <div style="font-size:13px; color:#cbd5e1; margin-bottom:14px;">Ваш баланс: <b id="clanDonateMyBal" style="color:#4ade80;">${myBalance.toFixed(3)} мл</b></div>

                <div class="clan-preset-grid">
                    <button class="clan-mini-btn" style="background:rgba(15,23,33,0.78); border-color:rgba(148,163,184,0.32);" onclick="clanSetDonateVal(1)">1 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(15,23,33,0.78); border-color:rgba(148,163,184,0.32);" onclick="clanSetDonateVal(5)">5 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(15,23,33,0.78); border-color:rgba(148,163,184,0.32);" onclick="clanSetDonateVal(10)">10 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(15,23,33,0.78); border-color:rgba(148,163,184,0.32);" onclick="clanSetDonateVal(25)">25 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(15,23,33,0.78); border-color:rgba(148,163,184,0.32);" onclick="clanSetDonateVal(50)">50 мл</button>
                    <button class="clan-mini-btn" style="background:rgba(15,23,33,0.78); border-color:rgba(148,163,184,0.32);" onclick="clanSetDonateVal(${myBalance.toFixed(3)})">Всё</button>
                </div>

                <input type="number" id="clanDonateAmount" class="clan-input" step="0.001" min="0.001" placeholder="Введите количество мл..." style="margin-bottom:14px;">

                <button class="clan-create-btn" style="background:rgba(15, 23, 33, 0.78); border-color:rgba(148, 163, 184, 0.35);" onclick="clanSubmitDonate()">Вложить миллилитры в клан</button>
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
                const availableMl = detectEffectivePlayerMl(uData);

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
                applyLocalPlayerMlValue(nextUserMl);
            });

            clanSubView = "hub";
            renderClanHubView(currentClanData, nick);
        } catch (err) {
            alert(err.message || "Ошибка при вложении миллилитров");
        }
    };

    // --- ГРУППОВОЙ ЧАТ КЛАНА ---
    function updateChatStatsHeader() {
        const el = document.getElementById("clanChatStats");
        if (!el || !currentClanData) return;
        const stats = countOnlineStats(currentClanData.members || []);
        el.innerHTML = `В сети: ${stats.online} / ${stats.total} &nbsp;•&nbsp; <span style="color:#4ade80;">Спасают кожицу: ${stats.savingSkin} / ${stats.total}</span>`;
    }

    function updateSelectionBar(nick) {
        const bar = document.getElementById("clanChatSelectionBar");
        const countEl = document.getElementById("clanChatSelectedCount");
        if (!bar || !countEl) return;

        const deletableIds = Array.from(selectedMsgIds).filter((id) => {
            const msg = latestChatDocs.find((d) => d.id === id);
            if (!msg) return false;
            return canUserDeleteChatMessage(currentClanData, nick, msg.sender);
        });

        if (deletableIds.length > 0) {
            bar.style.display = "flex";
            countEl.textContent = `Выбрано: ${deletableIds.length}`;
        } else {
            bar.style.display = "none";
        }
    }

    window.clanToggleSelectMessage = function (msgId) {
        const nick = getActiveNick();
        const msg = latestChatDocs.find((d) => d.id === msgId);
        if (!msg) return;

        if (!canUserDeleteChatMessage(currentClanData, nick, msg.sender)) return;

        if (selectedMsgIds.has(msgId)) {
            selectedMsgIds.delete(msgId);
        } else {
            selectedMsgIds.add(msgId);
        }
        renderChatMessagesList(latestChatDocs, nick);
    };

    window.clanDeleteSelectedMessages = async function () {
        if (!currentClanData || !selectedMsgIds.size) return;
        const nick = getActiveNick();

        const toDelete = Array.from(selectedMsgIds).filter((id) => {
            const msg = latestChatDocs.find((d) => d.id === id);
            if (!msg) return false;
            return canUserDeleteChatMessage(currentClanData, nick, msg.sender);
        });

        if (!toDelete.length) return;

        try {
            await ensureAuthSession();
            const { db, doc, deleteDoc } = await getFs();
            for (const id of toDelete) {
                await deleteDoc(doc(db, "clans", currentClanData.id, "messages", id));
                selectedMsgIds.delete(id);
            }
            updateSelectionBar(nick);
        } catch (err) {
            alert("Ошибка удаления сообщения: " + (err.message || ""));
        }
    };

    function renderChatMessagesList(docs, nick) {
        const box = document.getElementById("clanChatMessages");
        if (!box) return;

        if (!docs.length) {
            box.innerHTML = `<div style="font-size:12px; color:#94a3b8; text-align:center; margin-top:24px;">Сообщений пока нет. Напишите первым!</div>`;
            updateSelectionBar(nick);
            return;
        }

        const rows = docs.map((m) => {
            const senderClean = String(m.sender || "").toLowerCase();
            const cachedUser = membersCache.get(senderClean) || {};
            const displayNick = cachedUser.username || m.senderName || senderClean;
            const ava = cachedUser.avatarUrl || m.avatarUrl || "https://via.placeholder.com/70";
            const isMine = senderClean === nick;
            const isSelected = selectedMsgIds.has(m.id);
            const canSelect = canUserDeleteChatMessage(currentClanData, nick, senderClean);
            const frameStyle = getStaticFrameStyle(extractFrameId(cachedUser, currentClanData));
            const timeStr = m.createdAt
                ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "";

            // Аватарки тех, кто прочитал моё сообщение
            let readAvatarsHtml = "";
            if (isMine && Array.isArray(m.readBy)) {
                const readers = m.readBy
                    .map((r) => String(r).toLowerCase())
                    .filter((r) => r && r !== nick);
                if (readers.length > 0) {
                    const miniAvas = readers
                        .map((rNick) => {
                            const rData = membersCache.get(rNick) || {};
                            const rAva = rData.avatarUrl || "https://via.placeholder.com/30";
                            const rName = rData.username || rNick;
                            return `<img src="${rAva}" class="clan-read-ava-mini" title="Прочитал(а): ${escapeHtml(rName)}" alt="read">`;
                        })
                        .join("");
                    readAvatarsHtml = `<div class="clan-read-avatars">${miniAvas}</div>`;
                }
            }

            if (isMine) {
                return `
                    <div class="clan-chat-msg-wrap mine-wrap">
                        <div class="clan-chat-msg mine ${isSelected ? "selected" : ""}" ${
                            canSelect ? `onclick="clanToggleSelectMessage('${escapeAttr(m.id)}')"` : ""
                        }>
                            <div style="flex:1; min-width:0;">
                                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:2px;">
                                    <span style="font-size:12px; font-weight:bold; color:#38bdf8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(displayNick)}</span>
                                    <span style="font-size:10px; color:#94a3b8; flex-shrink:0;">${escapeHtml(timeStr)}</span>
                                </div>
                                <div style="font-size:13px; color:#f1f5f9; word-break:break-word; line-height:1.35;">${escapeHtml(m.text || "")}</div>
                            </div>
                            <img src="${ava}" class="clan-chat-ava" style="${frameStyle}" alt="ava">
                        </div>
                        ${readAvatarsHtml}
                    </div>
                `;
            }

            return `
                <div class="clan-chat-msg-wrap other-wrap">
                    <div class="clan-chat-msg ${isSelected ? "selected" : ""}" ${
                        canSelect ? `onclick="clanToggleSelectMessage('${escapeAttr(m.id)}')"` : ""
                    }>
                        <img src="${ava}" class="clan-chat-ava" style="${frameStyle}" alt="ava">
                        <div style="flex:1; min-width:0;">
                            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:2px;">
                                <span style="font-size:12px; font-weight:bold; color:#4ade80; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(displayNick)}</span>
                                <span style="font-size:10px; color:#94a3b8; flex-shrink:0;">${escapeHtml(timeStr)}</span>
                            </div>
                            <div style="font-size:13px; color:#f1f5f9; word-break:break-word; line-height:1.35;">${escapeHtml(m.text || "")}</div>
                        </div>
                    </div>
                </div>
            `;
        });

        box.innerHTML = rows.join("");
        box.scrollTop = box.scrollHeight;
        updateSelectionBar(nick);
    }

    window.clanOpenChatView = async function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        clanSubView = "chat";
        selectedMsgIds.clear();
        markChatAsRead();

        const view = document.getElementById("clanScrollView");
        if (!view) return;

        const stats = countOnlineStats(currentClanData.members || []);
        const mutedNow = isUserMutedInClan(currentClanData, nick);

        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 6px;">
                <div class="clan-chat-header">
                    <div class="clan-chat-title">${escapeHtml(currentClanData.name || "Клан")}</div>
                    <div id="clanChatStats" class="clan-chat-stats">В сети: ${stats.online} / ${stats.total} &nbsp;•&nbsp; <span style="color:#4ade80;">Спасают кожицу: ${stats.savingSkin} / ${stats.total}</span></div>
                    <div id="clanChatTyping" class="clan-chat-typing"></div>
                </div>
                <div id="clanChatSelectionBar" class="clan-chat-selection-bar">
                    <span id="clanChatSelectedCount">Выбрано: 0</span>
                    <button type="button" class="clan-action-btn" style="background:#dc2626; padding:5px 11px; font-size:11px;" onclick="clanDeleteSelectedMessages()">Удалить</button>
                </div>
                <div id="clanChatMessages" class="clan-chat-messages">
                    <div style="font-size:12px; color:#94a3b8; text-align:center; margin-top:20px;">Загрузка сообщений...</div>
                </div>
                ${
                    mutedNow
                        ? `<div style="width:100%; font-size:12px; color:#fbbf24; text-align:center; padding:8px; background:rgba(120,53,15,0.35); border-radius:9px;">Вы замучены в чате клана</div>`
                        : `<form class="clan-chat-form" onsubmit="event.preventDefault(); clanSendMessage();">
                            <input type="text" id="clanChatInput" class="clan-input" maxlength="300" placeholder="Написать в клан..." autocomplete="off" oninput="clanOnChatTyping()">
                            <button type="submit" class="clan-action-btn" style="background:#16a34a; flex-shrink:0;">Отправить</button>
                        </form>`
                }
            </div>
        `;

        updateChatTypingIndicator();

        if (!chatUnsub && currentClanId) {
            await attachBackgroundChatWatcher(nick, currentClanId);
        }

        try {
            const { db, collection, query, orderBy, limit, getDocs } = await getFs();
            const snap = await getDocs(query(collection(db, "clans", currentClanData.id, "messages"), orderBy("createdAt", "asc"), limit(100)));
            const docs = [];
            snap.forEach((docSnap) => {
                knownMessageIds.add(docSnap.id);
                docs.push({ id: docSnap.id, ...docSnap.data() });
            });
            latestChatDocs = docs;
            renderChatMessagesList(docs, nick);
            markMessagesReadByMe(docs, nick);
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
        if (isUserMutedInClan(currentClanData, nick)) {
            alert("Вы замучены в чате клана.");
            return;
        }

        const inp = document.getElementById("clanChatInput");
        const text = (inp ? inp.value : "").trim();
        if (!text) return;
        inp.value = "";
        setMyTypingState(false);

        const me = membersCache.get(nick) || {};

        try {
            await ensureAuthSession();
            const { db, collection, addDoc } = await getFs();
            await addDoc(collection(db, "clans", currentClanData.id, "messages"), {
                sender: nick,
                senderName: me.username || nick,
                avatarUrl: me.avatarUrl || "",
                text,
                readBy: [nick],
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
            const { db, doc, runTransaction, deleteField } = await getFs();
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

                const roleFieldPath = `memberRoles.${nick}`;
                const updateObj = {
                    members,
                    [roleFieldPath]: deleteField()
                };
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
            const { db, doc, runTransaction, deleteField } = await getFs();
            const clanRef = doc(db, "clans", clanId);
            const reqUserRef = doc(db, "users", reqNick);

            await runTransaction(db, async (tx) => {
                const clanSnap = await tx.get(clanRef);
                if (!clanSnap.exists()) return;
                const cData = clanSnap.data();
                const members = Array.isArray(cData.members) ? [...cData.members] : [];
                if (!members.includes(reqNick)) members.push(reqNick);
                const reqs = Array.isArray(cData.joinRequests) ? cData.joinRequests.filter((x) => x !== reqNick) : [];

                const cleanReq = String(reqNick).toLowerCase();
                const updateObj = {
                    members,
                    joinRequests: reqs,
                    [`memberRoles.${cleanReq}`]: deleteField()
                };
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
            const { db, doc, runTransaction, deleteField } = await getFs();
            const clanRef = doc(db, "clans", clanId);
            const userRef = doc(db, "users", nick);

            await runTransaction(db, async (tx) => {
                const clanSnap = await tx.get(clanRef);
                if (!clanSnap.exists()) return;
                const cData = clanSnap.data();
                const remainingMembers = (Array.isArray(cData.members) ? cData.members : []).filter((m) => m !== nick);
                const updateObj = {
                    members: remainingMembers,
                    [`memberRoles.${nick}`]: deleteField(),
                    [`typingUsers.${nick}`]: deleteField()
                };

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
