// clan.js — Чистый модуль кланов (без вмешательства в друзей и поиск)

(function () {
    const FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
    const AUTH_URL = "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    let fsApi = null;
    let authApi = null;
    let clanPageOpen = false;
    let currentClanUnsub = null;
    let chatUnsub = null;
    let currentClanData = null;
    let currentClanId = null;
    let viewedOtherClanId = null;
    let clanSubView = "hub"; // "hub" | "settings" | "chat" | "donate"
    let membersCache = new Map();
    let createAvatarDataUrl = "";
    let editAvatarDataUrl = null;
    let decorAnimId = null;

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
        return rect.width > 0 && rect.height > 0 && rect.right > 8;
    }

    function isProfileDrawerOpen() {
        const drawer = document.getElementById("profileDrawer");
        if (!drawer) return false;
        if (
            drawer.classList.contains("open") ||
            drawer.classList.contains("active") ||
            drawer.classList.contains("show") ||
            drawer.classList.contains("visible")
        ) {
            return true;
        }
        return isElementVisible(drawer) && drawer.getBoundingClientRect().left >= -10;
    }

    function isShopOpen() {
        const ids = ["shopModal", "shopOverlay", "shopScreen", "storeModal", "storeOverlay"];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el && isElementVisible(el)) return true;
        }
        return false;
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
            }
            .clan-red-dot {
                width: 9px;
                height: 9px;
                border-radius: 50%;
                background: #ef4444;
                display: inline-block;
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
                background: rgba(55, 65, 81, 0.72);
                color: #f3f4f6;
                border: 1px solid rgba(255, 255, 255, 0.16);
                padding: 9px 16px;
                border-radius: 10px;
                font-size: 14px;
                font-weight: bold;
                cursor: pointer;
            }
            .clan-scroll-container {
                position: relative;
                z-index: 5;
                width: 100%;
                height: 100%;
                overflow-y: auto;
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
                background: rgba(15, 23, 33, 0.78);
                border: 1px solid rgba(148, 163, 184, 0.25);
                border-radius: 14px;
                padding: 14px;
                box-sizing: border-box;
            }
            .clan-input {
                width: 100%;
                box-sizing: border-box;
                background: rgba(15, 23, 33, 0.85);
                border: 1px solid rgba(148, 163, 184, 0.32);
                color: #fff;
                padding: 11px 13px;
                border-radius: 10px;
                font-size: 14px;
                outline: none;
            }
            .clan-create-btn {
                width: 100%;
                background: rgba(30, 41, 59, 0.82);
                color: #f1f5f9;
                border: 1px solid rgba(148, 163, 184, 0.3);
                padding: 14px 20px;
                border-radius: 12px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
            }
            .clan-card-item {
                background: rgba(24, 34, 45, 0.85);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 10px;
                margin-top: 8px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                cursor: pointer;
            }
            .clan-square-ava {
                width: 92px;
                height: 92px;
                object-fit: cover;
                border: 2px solid rgba(148, 163, 184, 0.45);
                background: rgba(24, 34, 45, 0.82);
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            .clan-square-ava-sm {
                width: 44px;
                height: 44px;
                object-fit: cover;
                border: 1px solid rgba(255, 255, 255, 0.22);
                background: rgba(15, 23, 33, 0.82);
                flex-shrink: 0;
            }
            .clan-hub-box {
                width: 100%;
                max-width: 460px;
                background: rgba(15, 23, 33, 0.85);
                border: 1px solid rgba(148, 163, 184, 0.25);
                border-radius: 16px;
                padding: 16px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .clan-name-green {
                color: #4ade80;
                font-size: 23px;
                font-weight: bold;
                margin: 10px 0 4px 0;
                text-align: center;
            }
            .clan-ml-blue {
                color: #38bdf8;
                font-size: 16px;
                font-weight: bold;
                margin-bottom: 6px;
            }
            .clan-desc-text {
                color: #cbd5e1;
                font-size: 13px;
                text-align: center;
                margin-bottom: 12px;
            }
            .clan-toolbar-row {
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                margin-bottom: 12px;
            }
            .clan-mini-btn {
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 9px;
                padding: 7px 10px;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                color: #fff;
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
            }
            .clan-member-ava {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid #94a3b8;
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
            .clan-chat-msg {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                background: rgba(30, 41, 59, 0.78);
                border-radius: 10px;
                padding: 7px 9px;
            }
            .clan-chat-ava {
                width: 30px;
                height: 30px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid #94a3b8;
                flex-shrink: 0;
            }
            .clan-chat-form {
                width: 100%;
                display: flex;
                gap: 8px;
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
        const symbols = ["🗡", "🛡", "💧", "❄️"];
        const items = Array.from({ length: 10 }, () => ({
            x: Math.random() * Math.max(320, window.innerWidth),
            y: Math.random() * Math.max(480, window.innerHeight),
            speed: 1.4 + Math.random() * 1.4,
            sym: symbols[Math.floor(Math.random() * symbols.length)],
            size: 36
        }));

        function resizeCvs() {
            cvs.width = window.innerWidth;
            cvs.height = window.innerHeight;
        }
        resizeCvs();
        window.addEventListener("resize", resizeCvs);

        function tick() {
            if (clanPageOpen) {
                c.clearRect(0, 0, cvs.width, cvs.height);
                c.font = "36px 'Segoe UI Emoji', 'Apple Color Emoji', Arial, sans-serif";
                c.textAlign = "center";
                c.textBaseline = "middle";
                for (const it of items) {
                    it.y += it.speed;
                    if (it.y > cvs.height + 50) {
                        it.y = -50;
                        it.x = Math.random() * cvs.width;
                    }
                    c.fillText(it.sym, it.x, it.y);
                }
            }
            decorAnimId = requestAnimationFrame(tick);
        }
        if (decorAnimId) cancelAnimationFrame(decorAnimId);
        decorAnimId = requestAnimationFrame(tick);
    }

    function updateUnreadIndicators() {
        const dot = document.getElementById("clanBtnUnreadDot");
        if (dot) dot.style.display = unreadChatCount > 0 ? "inline-block" : "none";
    }

    function updateOpenClanBtnVisibility() {
        const btn = document.getElementById("openClanBtn");
        if (!btn) return;
        const nick = getActiveNick();
        const startScreen = document.getElementById("startScreen");
        const startVisible = startScreen && isElementVisible(startScreen);
        const hide =
            !nick ||
            clanPageOpen ||
            isProfileDrawerOpen() ||
            isShopOpen() ||
            !startVisible ||
            window.gameStarted === true ||
            window.isPaused === true ||
            window.gameOver === true;
        btn.style.display = hide ? "none" : "flex";
        updateUnreadIndicators();
    }

    window.openClanPage = async function (targetClanId = null) {
        const nick = getActiveNick();
        if (!nick) {
            alert("Сначала войдите в аккаунт!");
            return;
        }
        const drawer = document.getElementById("profileDrawer");
        if (drawer) drawer.classList.remove("open");

        clanPageOpen = true;
        clanSubView = "hub";
        viewedOtherClanId = targetClanId;
        const overlay = document.getElementById("clanPageOverlay");
        if (overlay) overlay.style.display = "flex";
        updateOpenClanBtnVisibility();

        try {
            await ensureAuthSession();
            await syncUserClanAndRender(nick, targetClanId);
        } catch (err) {
            alert("Ошибка открытия клана: " + (err.message || ""));
        }
    };

    window.clanHandleBack = function () {
        const view = document.getElementById("clanScrollView");
        if (view && view.dataset.mode === "create") {
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
            syncUserClanAndRender(getActiveNick(), null);
            return;
        }
        closeClanPage();
    };

    function closeClanPage() {
        clanPageOpen = false;
        viewedOtherClanId = null;
        clanSubView = "hub";
        if (currentClanUnsub) {
            currentClanUnsub();
            currentClanUnsub = null;
        }
        if (chatUnsub) {
            chatUnsub();
            chatUnsub = null;
        }
        currentClanData = null;
        const overlay = document.getElementById("clanPageOverlay");
        if (overlay) overlay.style.display = "none";
        updateOpenClanBtnVisibility();
    }

    async function loadMembersProfiles(memberNicks) {
        if (!Array.isArray(memberNicks)) return;
        const { db, doc, getDoc } = await getFs();
        for (const m of memberNicks) {
            const clean = String(m).toLowerCase();
            if (!clean) continue;
            try {
                const snap = await getDoc(doc(db, "users", clean));
                membersCache.set(clean, snap.exists() ? snap.data() : { username: clean });
            } catch (_) {
                membersCache.set(clean, { username: clean });
            }
        }
    }

    async function syncUserClanAndRender(nick, targetClanId = null) {
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
                    viewedOtherClanId = null;
                    await syncUserClanAndRender(nick, null);
                    return;
                }
                currentClanData = { id: snap.id, ...snap.data() };
                await loadMembersProfiles(currentClanData.members || []);
                if (clanSubView === "hub") renderClanHubView(currentClanData, nick);
            });
            return;
        }

        const userSnap = await getDoc(doc(db, "users", nick));
        const userClanId = userSnap.exists() ? userSnap.data().clanId || null : null;
        if (!userClanId) {
            currentClanId = null;
            currentClanData = null;
            renderNoClanView("");
            return;
        }

        currentClanId = userClanId;
        currentClanUnsub = onSnapshot(doc(db, "clans", userClanId), async (snap) => {
            if (!clanPageOpen) return;
            if (!snap.exists()) {
                await updateDoc(doc(db, "users", nick), { clanId: null, clanName: null }).catch(() => {});
                currentClanId = null;
                currentClanData = null;
                renderNoClanView("");
                return;
            }
            const data = snap.data();
            const members = Array.isArray(data.members) ? data.members : [];
            if (!members.includes(nick)) {
                await updateDoc(doc(db, "users", nick), { clanId: null, clanName: null }).catch(() => {});
                currentClanId = null;
                currentClanData = null;
                renderNoClanView("");
                return;
            }
            currentClanData = { id: snap.id, ...data };
            await loadMembersProfiles(members);
            if (clanSubView === "hub") renderClanHubView(currentClanData, nick);
        });
    }

    function renderNoClanView(searchQuery = "") {
        const view = document.getElementById("clanScrollView");
        if (!view) return;
        view.dataset.mode = "list";
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
            const list = [];
            snap.forEach((d) => {
                const data = d.data();
                const name = data.name || d.id;
                if (!qClean || name.toLowerCase().includes(qClean)) {
                    list.push({ id: d.id, ...data });
                }
            });
            if (!list.length) {
                container.innerHTML = `<div style="font-size:12px; color:#94a3b8; margin-top:10px; text-align:center;">Кланы не найдены</div>`;
                return;
            }
            container.innerHTML = list
                .slice(0, 12)
                .map((c) => {
                    const mCount = Array.isArray(c.members) ? c.members.length : 0;
                    const avaHtml = c.avatarUrl
                        ? `<img src="${c.avatarUrl}" class="clan-square-ava-sm" alt="ava">`
                        : `<div class="clan-square-ava-sm"></div>`;
                    return `
                        <div class="clan-card-item" onclick="openClanPage('${escapeAttr(c.id)}')">
                            <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                                ${avaHtml}
                                <div style="overflow:hidden; text-align:left;">
                                    <div style="font-size:14px; font-weight:bold; color:#4ade80; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(c.name || c.id)}</div>
                                    <div style="font-size:11px; color:#94a3b8;">Участников: ${mCount}</div>
                                </div>
                            </div>
                            <span style="font-size:12px; color:#38bdf8; font-weight:bold;">Открыть</span>
                        </div>
                    `;
                })
                .join("");
        } catch (err) {
            container.innerHTML = `<div style="font-size:12px; color:#f87171; margin-top:10px; text-align:center;">Ошибка поиска: ${escapeHtml(err.message || "")}</div>`;
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
                <input type="file" accept="image/*" class="clan-input" style="padding:7px; font-size:12px; margin-bottom:12px;" onchange="clanOnCreateAvaChange(this)">
                <label style="font-size:12px; color:#cbd5e1; align-self:flex-start; margin-bottom:4px;">Название клана</label>
                <input type="text" id="clanCreateName" class="clan-input" maxlength="24" style="margin-bottom:12px;">
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
            if (prev) prev.innerHTML = `<img src="${createAvatarDataUrl}" style="width:100%; height:100%; object-fit:cover; display:block;">`;
        };
        reader.readAsDataURL(file);
    };

    window.clanSubmitCreate = async function () {
        const nick = getActiveNick();
        if (!nick) return;
        const rawName = (document.getElementById("clanCreateName")?.value || "").trim();
        const desc = (document.getElementById("clanCreateDesc")?.value || "").trim();
        const accessType = document.getElementById("clanCreateAccess")?.value || "open";
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
                if (userSnap.exists() && userSnap.data().clanId) throw new Error("Вы уже состоите в клане!");
                const lockSnap = await tx.get(nameLockRef);
                if (lockSnap.exists()) throw new Error("Клан с таким названием уже существует!");

                tx.set(nameLockRef, { clanId, name: rawName, createdBy: nick, createdAt: Date.now() });
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
                tx.set(userRef, { clanId, clanName: rawName }, { merge: true });
            });

            viewedOtherClanId = null;
            await syncUserClanAndRender(nick, null);
        } catch (err) {
            alert(err.message || "Ошибка создания клана");
        }
    };

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

        let actionHtml = "";
        if (!isMember) {
            if (clan.accessType === "open") {
                actionHtml = `<button class="clan-action-btn" style="background:#16a34a;" onclick="clanJoinOpen('${escapeAttr(clan.id)}')">Вступить в клан</button>`;
            } else if (clan.accessType === "invite") {
                actionHtml = hasPendingReq
                    ? `<button class="clan-action-btn" style="background:#475569;" disabled>Заявка отправлена</button>`
                    : `<button class="clan-action-btn" style="background:#2563eb;" onclick="clanRequestJoin('${escapeAttr(clan.id)}')">Подать заявку</button>`;
            } else {
                actionHtml = `<button class="clan-action-btn" style="background:#475569;" disabled>Клан закрыт</button>`;
            }
        } else {
            actionHtml = `
                <div class="clan-toolbar-row">
                    ${isLeader ? `<button class="clan-mini-btn" style="background:rgba(30,41,59,0.85);" onclick="clanOpenSettingsView()">⚙️</button>` : ""}
                    <button class="clan-mini-btn" style="background:rgba(15,23,33,0.78);" onclick="clanOpenDonateView()">💧 Вложить</button>
                    <button class="clan-mini-btn" style="background:rgba(22,163,74,0.85);" onclick="clanOpenChatView()">💬 Чат</button>
                    <button class="clan-mini-btn" style="background:#dc2626;" onclick="clanLeave('${escapeAttr(clan.id)}')">Выйти</button>
                </div>
            `;
        }

        let requestsHtml = "";
        if (isLeader && joinRequests.length > 0) {
            requestsHtml = `
                <div class="clan-members-box" style="border-color: rgba(251,146,60,0.5); margin-bottom: 10px;">
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

        const memberRows = members
            .map((mNick) => {
                const clean = String(mNick).toLowerCase();
                const uData = membersCache.get(clean) || {};
                const displayName = uData.username || clean;
                const avaSrc = uData.avatarUrl || "https://via.placeholder.com/70";
                const isClanLeader = String(clan.leader || "").toLowerCase() === clean;
                return `
                    <div class="clan-member-row">
                        <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                            <img src="${avaSrc}" class="clan-member-ava" alt="ava">
                            <span style="font-size:13px; font-weight:bold; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(displayName)}${isClanLeader ? " [Глава]" : ""}</span>
                        </div>
                        ${
                            isLeader && clean !== myNick
                                ? `<button class="clan-action-btn" style="background:#dc2626; padding:5px 10px; font-size:11px;" onclick="clanKickMember('${escapeAttr(clean)}')">Кикнуть</button>`
                                : ""
                        }
                    </div>
                `;
            })
            .join("");

        view.innerHTML = `
            <div class="clan-hub-box">
                ${avaHtml}
                <div class="clan-name-green">${escapeHtml(clan.name || clan.id)}</div>
                <div class="clan-ml-blue">${mlNum.toFixed(3)} мл</div>
                <div class="clan-desc-text">${escapeHtml(clan.description || "")}</div>
                ${actionHtml}
                ${requestsHtml}
                <div style="width:100%; font-size:13px; font-weight:bold; color:#cbd5e1; text-align:left; margin-top:4px;">
                    Участники (${members.length})
                </div>
                <div class="clan-members-box">${memberRows}</div>
            </div>
        `;
    }

    window.clanOpenSettingsView = function () {
        if (!currentClanData || currentClanData.leader !== getActiveNick()) return;
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
                <div id="clanEditAvaPreview" class="clan-square-ava" style="margin-bottom:8px;">${avaPreview}</div>
                <input type="file" accept="image/*" class="clan-input" style="padding:7px; font-size:12px; margin-bottom:12px;" onchange="clanOnEditAvaChange(this)">
                <input type="text" id="clanEditName" class="clan-input" maxlength="24" value="${escapeHtml(currentClanData.name || "")}" style="margin-bottom:12px;">
                <textarea id="clanEditDesc" class="clan-input" rows="3" maxlength="160" style="resize:none; margin-bottom:12px;">${escapeHtml(currentClanData.description || "")}</textarea>
                <select id="clanEditAccess" class="clan-input" style="margin-bottom:16px;">
                    <option value="open" ${currentClanData.accessType === "open" ? "selected" : ""}>Открытый</option>
                    <option value="closed" ${currentClanData.accessType === "closed" ? "selected" : ""}>Закрытый</option>
                    <option value="invite" ${currentClanData.accessType === "invite" ? "selected" : ""}>По приглашению</option>
                </select>
                <button class="clan-create-btn" style="margin-bottom: 14px;" onclick="clanSaveSettings()">Сохранить изменения</button>
                <button class="clan-action-btn" style="width:100%; background:#dc2626;" onclick="clanDelete('${escapeAttr(currentClanData.id)}')">Удалить клан</button>
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
            if (prev) prev.innerHTML = `<img src="${editAvatarDataUrl}" style="width:100%; height:100%; object-fit:cover; display:block;">`;
        };
        reader.readAsDataURL(file);
    };

    window.clanSaveSettings = async function () {
        if (!currentClanData || currentClanData.leader !== getActiveNick()) return;
        const rawName = (document.getElementById("clanEditName")?.value || "").trim();
        const desc = (document.getElementById("clanEditDesc")?.value || "").trim();
        const accessType = document.getElementById("clanEditAccess")?.value || "open";
        if (rawName.length < 2) {
            alert("Название клана должно быть не короче 2 символов!");
            return;
        }
        try {
            await ensureAuthSession();
            const { db, doc, updateDoc } = await getFs();
            const patch = { name: rawName, description: desc, accessType };
            if (editAvatarDataUrl !== null) patch.avatarUrl = editAvatarDataUrl;
            await updateDoc(doc(db, "clans", currentClanData.id), patch);
            clanSubView = "hub";
            renderClanHubView({ ...currentClanData, ...patch }, getActiveNick());
        } catch (err) {
            alert("Ошибка сохранения: " + (err.message || ""));
        }
    };

    window.clanOpenDonateView = function () {
        if (!currentClanData) return;
        clanSubView = "donate";
        const view = document.getElementById("clanScrollView");
        if (!view) return;
        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 12px;">
                <h3 style="margin: 0 0 10px 0; color: #38bdf8;">Вложить миллилитры в клан</h3>
                <input type="number" id="clanDonateAmount" class="clan-input" step="0.001" min="0.001" placeholder="Введите количество мл..." style="margin-bottom:14px;">
                <button class="clan-create-btn" style="background:rgba(15,23,33,0.78);" onclick="clanSubmitDonate()">Вложить миллилитры в клан</button>
            </div>
        `;
    };

    window.clanSubmitDonate = async function () {
        if (!currentClanData) return;
        const amount = parseFloat(document.getElementById("clanDonateAmount")?.value || "0");
        if (!Number.isFinite(amount) || amount <= 0) {
            alert("Укажите сумму больше 0 мл!");
            return;
        }
        try {
            await ensureAuthSession();
            const { db, doc, updateDoc, increment } = await getFs();
            await updateDoc(doc(db, "clans", currentClanData.id), { mlBalance: increment(amount) });
            clanSubView = "hub";
            renderClanHubView(currentClanData, getActiveNick());
        } catch (err) {
            alert("Ошибка вложения: " + (err.message || ""));
        }
    };

    window.clanOpenChatView = async function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        clanSubView = "chat";
        unreadChatCount = 0;
        updateUnreadIndicators();

        const view = document.getElementById("clanScrollView");
        if (!view) return;
        view.innerHTML = `
            <div class="clan-hub-box" style="margin-top: 6px;">
                <h3 style="margin: 0 0 10px 0; color: #4ade80;">Чат клана</h3>
                <div id="clanChatMessages" class="clan-chat-messages"></div>
                <form class="clan-chat-form" onsubmit="event.preventDefault(); clanSendMessage();">
                    <input type="text" id="clanChatInput" class="clan-input" maxlength="300" placeholder="Написать в клан..." autocomplete="off">
                    <button type="submit" class="clan-action-btn" style="background:#16a34a;">Отправить</button>
                </form>
            </div>
        `;

        if (chatUnsub) chatUnsub();
        const { db, collection, query, orderBy, limit, onSnapshot } = await getFs();
        chatUnsub = onSnapshot(
            query(collection(db, "clans", currentClanData.id, "messages"), orderBy("createdAt", "asc"), limit(100)),
            (snap) => {
                const box = document.getElementById("clanChatMessages");
                if (!box) return;
                const docs = [];
                snap.forEach((d) => {
                    docs.push({ id: d.id, ...d.data() });
                    if (!initialChatLoaded) knownMessageIds.add(d.id);
                });
                initialChatLoaded = true;
                if (!docs.length) {
                    box.innerHTML = `<div style="font-size:12px; color:#94a3b8; text-align:center; margin-top:20px;">Сообщений пока нет</div>`;
                    return;
                }
                box.innerHTML = docs
                    .map((m) => {
                        const isMine = String(m.sender || "").toLowerCase() === nick;
                        const ava = m.avatarUrl || "https://via.placeholder.com/70";
                        return `
                            <div class="clan-chat-msg" style="justify-content:${isMine ? "flex-end" : "flex-start"};">
                                ${!isMine ? `<img src="${ava}" class="clan-chat-ava" alt="ava">` : ""}
                                <div style="max-width:80%;">
                                    <div style="font-size:11px; font-weight:bold; color:${isMine ? "#38bdf8" : "#4ade80"};">${escapeHtml(m.senderName || m.sender || "")}</div>
                                    <div style="font-size:13px; color:#f1f5f9; word-break:break-word;">${escapeHtml(m.text || "")}</div>
                                </div>
                                ${isMine ? `<img src="${ava}" class="clan-chat-ava" alt="ava">` : ""}
                            </div>
                        `;
                    })
                    .join("");
                box.scrollTop = box.scrollHeight;
            }
        );
    };

    window.clanSendMessage = async function () {
        if (!currentClanData) return;
        const nick = getActiveNick();
        const inp = document.getElementById("clanChatInput");
        const text = (inp?.value || "").trim();
        if (!nick || !text) return;
        inp.value = "";
        const me = membersCache.get(nick) || {};
        const { db, collection, addDoc } = await getFs();
        await addDoc(collection(db, "clans", currentClanData.id, "messages"), {
            sender: nick,
            senderName: me.username || nick,
            avatarUrl: me.avatarUrl || "",
            text,
            createdAt: Date.now()
        });
    };

    window.clanJoinOpen = async function (clanId) {
        const nick = getActiveNick();
        if (!nick) return;
        const { db, doc, runTransaction } = await getFs();
        await runTransaction(db, async (tx) => {
            const cRef = doc(db, "clans", clanId);
            const uRef = doc(db, "users", nick);
            const cSnap = await tx.get(cRef);
            if (!cSnap.exists()) return;
            const cData = cSnap.data();
            const members = Array.isArray(cData.members) ? [...cData.members] : [];
            if (!members.includes(nick)) members.push(nick);
            tx.update(cRef, { members });
            tx.set(uRef, { clanId, clanName: cData.name || clanId }, { merge: true });
        });
        viewedOtherClanId = null;
        await syncUserClanAndRender(nick, null);
    };

    window.clanRequestJoin = async function (clanId) {
        const nick = getActiveNick();
        if (!nick) return;
        const { db, doc, updateDoc, arrayUnion } = await getFs();
        await updateDoc(doc(db, "clans", clanId), { joinRequests: arrayUnion(nick) });
        alert("Заявка отправлена!");
    };

    window.clanApproveRequest = async function (clanId, reqNick) {
        const { db, doc, runTransaction } = await getFs();
        await runTransaction(db, async (tx) => {
            const cRef = doc(db, "clans", clanId);
            const uRef = doc(db, "users", reqNick);
            const cSnap = await tx.get(cRef);
            if (!cSnap.exists()) return;
            const cData = cSnap.data();
            const members = Array.isArray(cData.members) ? [...cData.members] : [];
            if (!members.includes(reqNick)) members.push(reqNick);
            const joinRequests = Array.isArray(cData.joinRequests) ? cData.joinRequests.filter((x) => x !== reqNick) : [];
            tx.update(cRef, { members, joinRequests });
            tx.set(uRef, { clanId, clanName: cData.name || clanId }, { merge: true });
        });
    };

    window.clanRejectRequest = async function (clanId, reqNick) {
        const { db, doc, updateDoc, arrayRemove } = await getFs();
        await updateDoc(doc(db, "clans", clanId), { joinRequests: arrayRemove(reqNick) });
    };

    window.clanKickMember = async function (targetNick) {
        if (!currentClanData) return;
        const cleanTarget = String(targetNick).toLowerCase();
        const { db, doc, runTransaction } = await getFs();
        await runTransaction(db, async (tx) => {
            const cRef = doc(db, "clans", currentClanData.id);
            const uRef = doc(db, "users", cleanTarget);
            const cSnap = await tx.get(cRef);
            if (!cSnap.exists()) return;
            const members = (Array.isArray(cSnap.data().members) ? cSnap.data().members : []).filter(
                (m) => String(m).toLowerCase() !== cleanTarget
            );
            tx.update(cRef, { members });
            tx.update(uRef, { clanId: null, clanName: null }).catch(() => {});
        });
    };

    window.clanLeave = async function (clanId) {
        const nick = getActiveNick();
        if (!nick || !confirm("Выйти из клана?")) return;
        const { db, doc, runTransaction } = await getFs();
        await runTransaction(db, async (tx) => {
            const cRef = doc(db, "clans", clanId);
            const uRef = doc(db, "users", nick);
            const cSnap = await tx.get(cRef);
            if (!cSnap.exists()) return;
            const cData = cSnap.data();
            const members = (Array.isArray(cData.members) ? cData.members : []).filter((m) => m !== nick);
            const patch = { members };
            if (cData.leader === nick) patch.leader = null;
            tx.update(cRef, patch);
            tx.set(uRef, { clanId: null, clanName: null }, { merge: true });
        });
        viewedOtherClanId = null;
        await syncUserClanAndRender(nick, null);
    };

    window.clanDelete = async function (clanId) {
        const nick = getActiveNick();
        if (!nick || !confirm("Удалить клан навсегда?")) return;
        const { db, doc, getDoc, deleteDoc, setDoc } = await getFs();
        const cRef = doc(db, "clans", clanId);
        const snap = await getDoc(cRef);
        if (!snap.exists()) return;
        const cData = snap.data();
        for (const m of Array.isArray(cData.members) ? cData.members : []) {
            await setDoc(doc(db, "users", String(m).toLowerCase()), { clanId: null, clanName: null }, { merge: true }).catch(() => {});
        }
        if (cData.nameLower) {
            await deleteDoc(doc(db, "clanNames", cData.nameLower)).catch(() => {});
        }
        await deleteDoc(cRef);
        viewedOtherClanId = null;
        await syncUserClanAndRender(nick, null);
    };

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

    setTimeout(() => {
        injectStyles();
        createUiElements();
        updateOpenClanBtnVisibility();
        setInterval(updateOpenClanBtnVisibility, 600);
    }, 500);
})();
