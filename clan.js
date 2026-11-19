// clan.js — Оптимизированный модуль кланов (без лагов, крупные бомбы, плавный спуск на телефоне)

(function () {
    const FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
    const AUTH_URL = "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    let fsApi = null;
    let authApi = null;
    let clanPageOpen = false;
    let currentClanUnsub = null;
    let currentClanData = null;
    let currentClanId = null;
    let viewedOtherClanId = null;
    let membersCache = new Map();
    let userClanCache = new Map();
    let createAvatarDataUrl = "";
    let liveTimerInterval = null;
    let decorAnimId = null;
    let enrichTimer = null;

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
            updateDoc: mod.updateDoc,
            deleteDoc: mod.deleteDoc,
            collection: mod.collection,
            query: mod.query,
            where: mod.where,
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

    function injectStyles() {
        if (document.getElementById("clanModuleStyles")) return;
        const style = document.createElement("style");
        style.id = "clanModuleStyles";
        style.textContent = `
            #openClanBtn {
                position: absolute;
                top: 15px;
                right: 15px;
                background: rgba(24, 34, 45, 0.72);
                color: #e2e8f0;
                border: 1px solid rgba(148, 163, 184, 0.28);
                height: 44px;
                padding: 0 16px;
                border-radius: 12px;
                cursor: pointer;
                z-index: 30;
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
            #openClanBtn .clan-btn-badge {
                background: #ef4444;
                color: #fff;
                font-size: 11px;
                padding: 1px 6px;
                border-radius: 999px;
                display: none;
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
                padding: 72px 18px 36px 18px;
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
                width: 96px;
                height: 96px;
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
                background: rgba(15, 23, 33, 0.8);
                border: 1px solid rgba(148, 163, 184, 0.25);
                border-radius: 16px;
                padding: 18px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
            }

            .clan-name-green {
                color: #4ade80;
                font-size: 24px;
                font-weight: bold;
                margin: 12px 0 4px 0;
                text-align: center;
                word-break: break-word;
            }
            .clan-ml-blue {
                color: #38bdf8;
                font-size: 16px;
                font-weight: bold;
                margin-bottom: 8px;
                text-align: center;
            }
            .clan-desc-text {
                color: #cbd5e1;
                font-size: 13px;
                text-align: center;
                margin-bottom: 14px;
                line-height: 1.4;
                word-break: break-word;
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
            .clan-badge-link {
                display: inline-block;
                margin-top: 3px;
                padding: 2px 7px;
                border-radius: 6px;
                background: rgba(56, 189, 248, 0.16);
                border: 1px solid rgba(56, 189, 248, 0.45);
                color: #7dd3fc;
                font-size: 10px;
                font-weight: bold;
                cursor: pointer;
            }
            .clan-badge-link:hover {
                background: rgba(56, 189, 248, 0.28);
            }
        `;
        document.head.appendChild(style);
    }

    function createUiElements() {
        if (!document.getElementById("openClanBtn")) {
            const btn = document.createElement("button");
            btn.id = "openClanBtn";
            btn.innerHTML = `Клан <span id="clanBtnReqBadge" class="clan-btn-badge">0</span>`;
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

    function updateOpenClanBtnVisibility() {
        const btn = document.getElementById("openClanBtn");
        if (!btn) return;
        const nick = getActiveNick();
        const startScreen = document.getElementById("startScreen");
        const startVisible = startScreen && getComputedStyle(startScreen).display !== "none";
        const hide =
            !nick ||
            clanPageOpen ||
            !startVisible ||
            window.gameStarted === true ||
            window.isPaused === true ||
            window.gameOver === true;

        btn.style.display = hide ? "none" : "flex";
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
        viewedOtherClanId = targetClanId;
        const overlay = document.getElementById("clanPageOverlay");
        if (overlay) overlay.style.display = "flex";
        updateOpenClanBtnVisibility();

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
        if (viewedOtherClanId) {
            viewedOtherClanId = null;
            const nick = getActiveNick();
            syncUserClanAndRender(nick, null);
            return;
        }
        closeClanPage();
    };

    function closeClanPage() {
        clanPageOpen = false;
        viewedOtherClanId = null;
        if (currentClanUnsub) {
            currentClanUnsub();
            currentClanUnsub = null;
        }
        if (liveTimerInterval) {
            clearInterval(liveTimerInterval);
            liveTimerInterval = null;
        }
        currentClanData = null;
        currentClanId = null;
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
                    await syncUserClanAndRender(nick, null);
                    return;
                }
                currentClanData = { id: snap.id, ...snap.data() };
                await refreshMembersCache(currentClanData.members || []);
                renderClanHubView(currentClanData, nick);
            });
            return;
        }

        const userSnap = await getDoc(doc(db, "users", nick));
        const userClanId = userSnap.exists() ? (userSnap.data().clanId || null) : null;

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
                await updateDoc(doc(db, "users", nick), { clanId: null }).catch(() => {});
                currentClanId = null;
                currentClanData = null;
                renderNoClanView("");
                return;
            }
            const data = snap.data();
            const members = Array.isArray(data.members) ? data.members : [];
            if (!members.includes(nick)) {
                await updateDoc(doc(db, "users", nick), { clanId: null }).catch(() => {});
                currentClanId = null;
                currentClanData = null;
                renderNoClanView("");
                return;
            }
            currentClanData = { id: snap.id, ...data };
            updateReqBadge(currentClanData);
            await refreshMembersCache(members);
            renderClanHubView(currentClanData, nick);
        });
    }

    function updateReqBadge(clanData) {
        const badge = document.getElementById("clanBtnReqBadge");
        if (!badge) return;
        const nick = getActiveNick();
        const isLeader = clanData && clanData.leader === nick;
        const reqs = clanData && Array.isArray(clanData.joinRequests) ? clanData.joinRequests : [];
        if (isLeader && reqs.length > 0) {
            badge.textContent = String(reqs.length);
            badge.style.display = "inline-block";
        } else {
            badge.style.display = "none";
        }
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
            await syncUserClanAndRender(nick, null);
        } catch (err) {
            alert(`${err.message || "Ошибка создания клана"} ${err.code ? "[" + err.code + "]" : ""}`);
        }
    };

    async function refreshMembersCache(memberNicks) {
        await ensureAuthSession();
        const { db, doc, getDoc } = await getFs();
        const nextMap = new Map();
        for (const mNick of memberNicks) {
            const clean = String(mNick).toLowerCase();
            try {
                const snap = await getDoc(doc(db, "users", clean));
                if (snap.exists()) {
                    nextMap.set(clean, snap.data());
                } else {
                    nextMap.set(clean, { username: clean });
                }
            } catch (_) {
                nextMap.set(clean, membersCache.get(clean) || { username: clean });
            }
        }
        membersCache = nextMap;
    }

    function formatMemberStatus(data) {
        if (!data) return { text: "Не в сети", color: "#94a3b8" };
        const lastActive = data.lastActive && typeof data.lastActive.toMillis === "function" ? data.lastActive.toMillis() : 0;
        const isOnline = lastActive && Date.now() - lastActive < 6000;

        if (data.inGame && isOnline) {
            if (data.currentBossName) {
                return { text: `В игре • Босс ${data.currentBossName}`, color: "#38bdf8" };
            }
            const startMs = data.gameStartTime && typeof data.gameStartTime.toMillis === "function" ? data.gameStartTime.toMillis() : 0;
            const diffSec = startMs ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
            const mins = String(Math.floor(diffSec / 60)).padStart(2, "0");
            const secs = String(diffSec % 60).padStart(2, "0");
            return { text: `В игре [${mins}:${secs}]`, color: "#4ade80" };
        }

        if (isOnline) {
            return { text: "В сети", color: "#4ade80" };
        }

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
            actionButtonsHtml = `<div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:center; margin-bottom:10px;">
                <button class="clan-action-btn" style="background:#475569;" onclick="clanLeave('${escapeAttr(clan.id)}')">Выйти из клана</button>
                ${isLeader ? `<button class="clan-action-btn" style="background:#dc2626;" onclick="clanDelete('${escapeAttr(clan.id)}')">Удалить клан</button>` : ""}
            </div>`;
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

                <div style="width:100%; font-size:13px; font-weight:bold; color:#cbd5e1; text-align:left; margin-top:6px;">
                    Участники (${members.length})
                </div>
                <div id="clanMembersList" class="clan-members-box"></div>
            </div>
        `;

        paintMembersRows(members, clan.leader || "");

        if (liveTimerInterval) clearInterval(liveTimerInterval);
        liveTimerInterval = setInterval(() => {
            if (!clanPageOpen || !currentClanData) return;
            paintMembersRows(currentClanData.members || [], currentClanData.leader || "");
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
                const status = formatMemberStatus(uData);
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
            await syncUserClanAndRender(nick, null);
        } catch (err) {
            alert("Ошибка выхода из клана: " + err.message);
        }
    };

    window.clanDelete = async function (clanId) {
        const nick = getActiveNick();
        if (!nick) return;
        if (!confirm("Удалить клан навсегда? Название освободится.")) return;

        try {
            await ensureAuthSession();
            const { db, doc, getDoc, updateDoc, deleteDoc } = await getFs();
            const clanRef = doc(db, "clans", clanId);
            const snap = await getDoc(clanRef);
            if (!snap.exists()) return;
            const cData = snap.data();

            const members = Array.isArray(cData.members) ? cData.members : [];
            for (const m of members) {
                await updateDoc(doc(db, "users", String(m).toLowerCase()), {
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

    async function enrichFriendsWithClans() {
        const container = document.getElementById("friendsResultsContainer");
        if (!container) return;

        const cards = container.querySelectorAll(".user-result-card");
        if (!cards.length) return;

        const unenriched = Array.from(cards).filter((c) => c.dataset.clanEnriched !== "1");
        if (!unenriched.length) return;

        await ensureAuthSession();
        const { db, doc, getDoc } = await getFs();

        for (const card of unenriched) {
            card.dataset.clanEnriched = "1";
            const nameEl = card.querySelector(".user-result-name");
            const metaEl = card.querySelector(".user-result-meta");
            if (!nameEl || !metaEl) continue;

            const friendNick = nameEl.textContent.trim().toLowerCase();
            if (!friendNick) continue;

            let info = userClanCache.get(friendNick);
            if (info === undefined) {
                try {
                    const uSnap = await getDoc(doc(db, "users", friendNick));
                    if (uSnap.exists() && uSnap.data().clanId) {
                        const cId = uSnap.data().clanId;
                        let cName = uSnap.data().clanName || "";
                        if (!cName) {
                            const cSnap = await getDoc(doc(db, "clans", cId));
                            if (cSnap.exists()) cName = cSnap.data().name || cId;
                        }
                        info = { clanId: cId, clanName: cName };
                    } else {
                        info = null;
                    }
                } catch (_) {
                    info = null;
                }
                userClanCache.set(friendNick, info);
            }

            if (info && info.clanId) {
                const badge = document.createElement("span");
                badge.className = "clan-badge-link";
                badge.textContent = `Клан: ${info.clanName || info.clanId}`;
                badge.onclick = (ev) => {
                    ev.stopPropagation();
                    openClanPage(info.clanId);
                };
                metaEl.parentElement.appendChild(badge);
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

    function startLightSync() {
        const friendsBox = document.getElementById("friendsResultsContainer");
        if (friendsBox) {
            const obs = new MutationObserver(() => {
                if (enrichTimer) clearTimeout(enrichTimer);
                enrichTimer = setTimeout(enrichFriendsWithClans, 120);
            });
            obs.observe(friendsBox, { childList: true });
        }
        setInterval(() => {
            updateOpenClanBtnVisibility();
            if (document.getElementById("friendsResultsContainer")?.children.length) {
                enrichFriendsWithClans().catch(() => {});
            }
        }, 700);
    }

    setTimeout(() => {
        injectStyles();
        createUiElements();
        updateOpenClanBtnVisibility();
        startLightSync();
    }, 500);
})();
