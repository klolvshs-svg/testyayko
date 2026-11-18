// shop.js — Магазин рамок, падающие иконки (мечи, щиты, капли, снежинки) и редкие batyabomb.png

(function () {
    const FRAMES_CONFIG = {
        default: { name: "Стандартная (темно-синяя)", price: 0 },
        red:     { name: "Красная (1 мл)", price: 1.0 },
        blue:    { name: "Голубая (1 мл)", price: 1.0 },
        purple:  { name: "Фиолетовая (1 мл)", price: 1.0 }
    };

    const VALID_FRAMES = ["default", "red", "blue", "purple"];
    const userFramesCache = new Map();
    const activeListeners = new Map();
    let firestoreApi = null;

    // 1. Внедряем чистые стили для круглых аватарок
    function injectGlobalStyles() {
        if (document.getElementById("shopGlobalStyles")) return;
        const style = document.createElement("style");
        style.id = "shopGlobalStyles";
        style.textContent = `
            img.user-result-ava,
            #userAvatarImg,
            #activeChatAvatar,
            #shopPreviewAvatar,
            .profile-avatar-container img,
            .user-card img,
            .chat-message img,
            .message-avatar img {
                box-sizing: border-box !important;
                border-style: solid !important;
                border-width: 3px !important;
                border-radius: 50% !important;
                -webkit-border-radius: 50% !important;
                background-clip: padding-box !important;
                overflow: hidden !important;
            }

            .egg-frame-default { border-color: #1a365d !important; box-shadow: none !important; }
            .egg-frame-red { border-color: #ff4d4d !important; box-shadow: none !important; }
            .egg-frame-blue { border-color: #00d2ff !important; box-shadow: none !important; }
            .egg-frame-purple { border-color: #9c27b0 !important; box-shadow: none !important; }
        `;
        document.head.appendChild(style);
    }

    function getActiveUserNick() {
        return (
            localStorage.getItem("egg_logged_in_nick") ||
            localStorage.getItem("egg_current_user") ||
            window.currentUserNick ||
            ""
        ).trim();
    }

    async function getFirestoreApi() {
        if (firestoreApi) return firestoreApi;
        const mod = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        firestoreApi = {
            db: mod.getFirestore(),
            doc: mod.doc,
            getDoc: mod.getDoc,
            updateDoc: mod.updateDoc,
            onSnapshot: mod.onSnapshot
        };
        return firestoreApi;
    }

    function setElementFrame(el, frameId) {
        if (!el) return;
        const safeFrame = VALID_FRAMES.includes(frameId) ? frameId : "default";
        const targetClass = `egg-frame-${safeFrame}`;

        if (el.dataset.appliedFrame === safeFrame && el.classList.contains(targetClass)) {
            return;
        }

        el.classList.remove("egg-frame-default", "egg-frame-red", "egg-frame-blue", "egg-frame-purple");
        el.style.removeProperty("border-color");
        el.style.removeProperty("box-shadow");
        el.style.removeProperty("border-image");
        el.style.removeProperty("filter");

        el.classList.add(targetClass);
        el.dataset.appliedFrame = safeFrame;
    }

    async function subscribeToUserFrame(nick) {
        if (!nick || activeListeners.has(nick)) return;
        activeListeners.set(nick, () => {});

        try {
            const { db, doc, onSnapshot } = await getFirestoreApi();
            const unsub = onSnapshot(doc(db, "users", nick), (snap) => {
                const frame = snap.exists() ? (snap.data().selectedFrame || "default") : "default";
                const safeFrame = VALID_FRAMES.includes(frame) ? frame : "default";
                const prev = userFramesCache.get(nick);
                
                userFramesCache.set(nick, safeFrame);

                if (nick === getActiveUserNick()) {
                    localStorage.setItem(`egg_frame_${nick}`, safeFrame);
                }

                if (prev !== safeFrame) {
                    refreshAllVisibleAvatars();
                }
            });
            activeListeners.set(nick, unsub);
        } catch (e) {
            activeListeners.delete(nick);
        }
    }

    function resolveFrame(nick) {
        if (!nick) return "default";
        if (userFramesCache.has(nick)) return userFramesCache.get(nick);

        if (nick === getActiveUserNick()) {
            const local = localStorage.getItem(`egg_frame_${nick}`);
            if (local && VALID_FRAMES.includes(local)) {
                userFramesCache.set(nick, local);
                subscribeToUserFrame(nick);
                return local;
            }
        }

        subscribeToUserFrame(nick);
        return "default";
    }

    function refreshAllVisibleAvatars() {
        const myNick = getActiveUserNick();
        const myFrame = myNick ? resolveFrame(myNick) : "default";

        setElementFrame(document.getElementById("userAvatarImg"), myFrame);
        setElementFrame(document.getElementById("shopPreviewAvatar"), myFrame);

        document.querySelectorAll(".user-result-card, .friend-item, .user-card").forEach((card) => {
            const nameEl = card.querySelector(".user-result-name, .friend-name");
            const imgEl = card.querySelector("img.user-result-ava, img");
            if (!nameEl || !imgEl) return;

            const cardNick = nameEl.textContent.trim();
            if (!cardNick) return;

            const frame = cardNick === myNick ? myFrame : resolveFrame(cardNick);
            setElementFrame(imgEl, frame);
        });

        document.querySelectorAll("img.user-result-ava").forEach((imgEl) => {
            if (!imgEl.closest(".user-result-card, .friend-item, .user-card")) {
                setElementFrame(imgEl, myFrame);
            }
        });

        const chatAvatar = document.getElementById("activeChatAvatar");
        const chatTitle = document.getElementById("chatWithTitle");
        if (chatAvatar && chatTitle) {
            const partnerNick = chatTitle.textContent.trim();
            if (partnerNick && partnerNick !== "Чат" && partnerNick !== "Загрузка...") {
                setElementFrame(chatAvatar, resolveFrame(partnerNick));
            }
        }

        document.querySelectorAll(".chat-message img, .message-avatar img, .chat-avatar").forEach((msgImg) => {
            setElementFrame(msgImg, myFrame);
        });
    }

    function injectShopButton() {
        if (document.getElementById("menuShopBtn")) return;

        const shopBtn = document.createElement("button");
        shopBtn.id = "menuShopBtn";
        shopBtn.innerHTML = "🏪";
        shopBtn.title = "Магазин рамок";
        shopBtn.style.cssText = `
            position: absolute;
            top: 15px;
            left: 70px;
            background: rgba(24, 34, 45, 0.55);
            border: 2px solid transparent;
            width: 44px;
            height: 44px;
            border-radius: 12px;
            cursor: pointer;
            z-index: 30;
            display: none;
            justify-content: center;
            align-items: center;
            font-size: 20px;
            outline: none;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
            -webkit-tap-highlight-color: transparent;
            transition: transform 0.1s, background 0.3s;
        `;
        shopBtn.onclick = toggleShopDrawer;
        document.body.appendChild(shopBtn);
    }

    function createShopDrawer() {
        if (document.getElementById("shopOverlay")) return;

        const overlay = document.createElement("div");
        overlay.id = "shopOverlay";
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.4);
            z-index: 35;
            display: none;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                toggleShopDrawer();
            }
        };
        document.body.appendChild(overlay);

        const shopDrawer = document.createElement("div");
        shopDrawer.id = "shopDrawer";
        shopDrawer.style.cssText = `
            position: absolute;
            top: 0;
            left: -380px;
            width: 360px;
            max-width: 92vw;
            height: 100%;
            background: rgba(15, 23, 33, 0.98);
            border-right: 2px solid rgba(0, 210, 255, 0.2);
            z-index: 36;
            transition: left 0.3s cubic-bezier(0.25, 1, 0.5, 1);
            display: flex;
            flex-direction: column;
            box-shadow: 5px 0 25px rgba(0,0,0,0.6);
            overflow: hidden;
        `;

        shopDrawer.innerHTML = `
            <canvas id="shopDrawerCanvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;"></canvas>

            <div class="shop-drawer-content" style="position: relative; z-index: 2; padding: 15px 20px; display: flex; flex-direction: column; align-items: center; height: 100%; box-sizing: border-box; overflow-y: auto;">
                
                <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <div style="width: 24px;"></div>
                    <h3 style="margin: 0; color: #00d2ff; font-size: 18px; text-align: center; flex-grow: 1;">Магазин</h3>
                    <button class="btn-mini-action btn-mini-danger" onclick="toggleShopDrawer()" style="z-index: 5;">✕</button>
                </div>

                <div style="margin: 10px auto; position: relative; width: 84px; height: 84px;">
                    <img id="shopPreviewAvatar" src="https://via.placeholder.com/80" class="egg-frame-default" style="width: 84px; height: 84px; border-radius: 50%; object-fit: cover;">
                </div>
                <div id="shopCurrentBalance" style="font-size: 13px; color: #a5d6a7; margin-bottom: 15px;">Баланс: загрузка...</div>

                <button class="btn-drawer-custom" style="margin-bottom: 5px; background: rgba(18, 28, 40, 0.75); border: 1px solid rgba(255,255,255,0.1); display:flex; justify-content:space-between; align-items:center;" onclick="toggleShopFramesAccordion()">
                    <span>Рамки для аватара</span>
                    <span id="accordionArrow">▲</span>
                </button>

                <div id="shopFramesContainer" class="drawer-section-panel" style="display:flex; max-height:320px; margin-top:0; margin-bottom:15px; width:100%;">
                    <div style="width:100%; display:flex; flex-direction:column; gap:6px;">
                        
                        <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div class="egg-frame-default" style="width:24px; height:24px; border-radius:50%; border-style:solid; border-width:3px; box-sizing:border-box;"></div>
                                <span style="font-size:11px; font-weight:bold; color:#fff;">Стандартная (темно-синяя)</span>
                            </div>
                            <div id="action_default"></div>
                        </div>

                        <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div class="egg-frame-red" style="width:24px; height:24px; border-radius:50%; border-style:solid; border-width:3px; box-sizing:border-box;"></div>
                                <span style="font-size:11px; font-weight:bold; color:#fff;">Красная (1 мл)</span>
                            </div>
                            <div id="action_red"></div>
                        </div>

                        <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div class="egg-frame-blue" style="width:24px; height:24px; border-radius:50%; border-style:solid; border-width:3px; box-sizing:border-box;"></div>
                                <span style="font-size:11px; font-weight:bold; color:#fff;">Голубая (1 мл)</span>
                            </div>
                            <div id="action_blue"></div>
                        </div>

                        <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div class="egg-frame-purple" style="width:24px; height:24px; border-radius:50%; border-style:solid; border-width:3px; box-sizing:border-box;"></div>
                                <span style="font-size:11px; font-weight:bold; color:#fff;">Фиолетовая (1 мл)</span>
                            </div>
                            <div id="action_purple"></div>
                        </div>

                    </div>
                </div>

            </div>
        `;

        document.body.appendChild(shopDrawer);
        initShopDrawerCanvas();
    }

    function initShopDrawerCanvas() {
        const sCanvas = document.getElementById("shopDrawerCanvas");
        if (!sCanvas) return;
        const sCtx = sCanvas.getContext("2d");
        const sW = 360;
        let sH = window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        sCanvas.width = sW * dpr;
        sCanvas.height = sH * dpr;
        sCtx.scale(dpr, dpr);

        const bombImg = new Image();
        bombImg.src = "batyabomb.png";

        // Создаем разнообразные падающие элементы (мечи, щиты, капли, снежинки и немного бомб batyabomb.png)
        const symbolsList = ["🗡", "🛡", "💧", "❄️", "⚔️", "🛡️"];
        const sDecorItems = Array.from({ length: 9 }, () => {
            const isBomb = Math.random() < 0.25; // Примерно 25% шанс на бомбу, остальное — другие предметы
            return {
                x: Math.random() * sW,
                y: Math.random() * sH,
                speed: 1.0 + Math.random() * 1.5,
                size: isBomb ? 34 : 28 + Math.random() * 10,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.02,
                isBomb: isBomb,
                symbol: symbolsList[Math.floor(Math.random() * symbolsList.length)]
            };
        });

        function drawShopDecor() {
            const drawer = document.getElementById("shopDrawer");
            if (drawer && drawer.style.left === "0px") {
                sCtx.clearRect(0, 0, sW, sH);

                for (const item of sDecorItems) {
                    item.y += item.speed;
                    item.rotation += item.rotSpeed;
                    if (item.y > sH + 50) {
                        item.y = -50;
                        item.x = Math.random() * sW;
                    }
                    sCtx.save();
                    sCtx.translate(item.x, item.y);
                    sCtx.rotate(item.rotation);
                    
                    if (item.isBomb) {
                        if (bombImg.complete && bombImg.naturalWidth !== 0) {
                            sCtx.drawImage(bombImg, -item.size / 2, -item.size / 2, item.size, item.size);
                        } else {
                            sCtx.font = "28px sans-serif";
                            sCtx.textAlign = "center";
                            sCtx.fillText("💣", 0, 0);
                        }
                    } else {
                        sCtx.font = "28px 'Segoe UI Emoji', 'Apple Color Emoji', Arial, sans-serif";
                        sCtx.textAlign = "center";
                        sCtx.fillText(item.symbol, 0, 0);
                    }
                    sCtx.restore();
                }
            }
            requestAnimationFrame(drawShopDecor);
        }
        requestAnimationFrame(drawShopDecor);
    }

    window.toggleShopFramesAccordion = function () {
        const container = document.getElementById("shopFramesContainer");
        const arrow = document.getElementById("accordionArrow");
        if (!container) return;
        const isVisible = container.style.display === "flex";
        container.style.display = isVisible ? "none" : "flex";
        if (arrow) arrow.textContent = isVisible ? "▼" : "▲";
    };

    window.toggleShopDrawer = async function () {
        const drawer = document.getElementById("shopDrawer");
        const overlay = document.getElementById("shopOverlay");
        if (!drawer || !overlay) return;
        
        const isOpen = drawer.style.left === "0px";
        if (isOpen) {
            drawer.style.left = "-380px";
            overlay.style.opacity = "0";
            setTimeout(() => { overlay.style.display = "none"; }, 300);
        } else {
            const profileDrawer = document.getElementById("profileDrawer");
            if (profileDrawer) profileDrawer.classList.remove("open");
            
            overlay.style.display = "block";
            setTimeout(() => { overlay.style.opacity = "1"; }, 10);
            drawer.style.left = "0px";
            await window.updateShopUI();
        }
    };

    function checkShopButtonVisibility() {
        const shopBtn = document.getElementById("menuShopBtn");
        if (!shopBtn) return;

        const profileDrawer = document.getElementById("profileDrawer");
        const shopDrawer = document.getElementById("shopDrawer");
        const activeNick = getActiveUserNick();

        const hide =
            !activeNick ||
            (profileDrawer && profileDrawer.classList.contains("open")) ||
            (shopDrawer && shopDrawer.style.left === "0px") ||
            window.gameStarted === true ||
            window.isPaused === true ||
            window.gameOver === true;

        shopBtn.style.display = hide ? "none" : "flex";
    }

    window.updateShopUI = async function () {
        const activeNick = getActiveUserNick();
        if (!activeNick) return;

        const mainAvatarImg = document.getElementById("userAvatarImg");
        const previewAvatar = document.getElementById("shopPreviewAvatar");
        if (previewAvatar && mainAvatarImg && mainAvatarImg.src) {
            previewAvatar.src = mainAvatarImg.src;
        }

        const cachedFrame = resolveFrame(activeNick);
        setElementFrame(previewAvatar, cachedFrame);

        try {
            const { db, doc, getDoc } = await getFirestoreApi();
            const userSnap = await getDoc(doc(db, "users", activeNick));
            if (!userSnap.exists()) return;

            const userData = userSnap.data();
            const balance = Number(userData.balance_ml || 0);
            const balEl = document.getElementById("shopCurrentBalance");
            if (balEl) balEl.textContent = `Баланс: ${balance.toFixed(3)} мл`;

            if (previewAvatar && userData.avatarUrl) {
                previewAvatar.src = userData.avatarUrl;
            }

            const unlocked = Array.isArray(userData.unlockedFrames) ? userData.unlockedFrames : ["default"];
            if (!unlocked.includes("default")) unlocked.unshift("default");

            const currentFrame = VALID_FRAMES.includes(userData.selectedFrame) ? userData.selectedFrame : "default";
            userFramesCache.set(activeNick, currentFrame);
            localStorage.setItem(`egg_frame_${activeNick}`, currentFrame);

            setElementFrame(previewAvatar, currentFrame);
            refreshAllVisibleAvatars();

            for (const frameId of VALID_FRAMES) {
                renderItemAction(frameId, FRAMES_CONFIG[frameId].price, unlocked, currentFrame);
            }
        } catch (e) {
            console.error("Ошибка загрузки магазина:", e);
        }
    };

    function renderItemAction(frameId, price, unlocked, current) {
        const container = document.getElementById(`action_${frameId}`);
        if (!container) return;

        if (current === frameId) {
            container.innerHTML = `<button class="btn-mini-action btn-mini-gray" disabled>Выбрано ✅</button>`;
        } else if (unlocked.includes(frameId)) {
            container.innerHTML = `<button class="btn-mini-action btn-mini-success" onclick="applyAndSaveFrame('${frameId}')">Выбрать</button>`;
        } else {
            container.innerHTML = `<button class="btn-mini-action" onclick="buyAndUnlockFrame('${frameId}', ${price})">Купить (${price} мл)</button>`;
        }
    }

    window.buyAndUnlockFrame = async function (frameId, price) {
        const activeNick = getActiveUserNick();
        if (!activeNick) return;

        const container = document.getElementById(`action_${frameId}`);
        if (container) {
            container.innerHTML = `<button class="btn-mini-action btn-mini-gray" disabled>Покупка...</button>`;
        }

        try {
            const { db, doc, getDoc, updateDoc } = await getFirestoreApi();
            const userRef = doc(db, "users", activeNick);
            const userSnap = await getDoc(userRef);
            if (!userSnap.exists()) return;

            const userData = userSnap.data();
            const currentBalance = Number(userData.balance_ml || 0);

            if (currentBalance < price) {
                alert("❌ Недостаточно миллилитров в банке!");
                await window.updateShopUI();
                return;
            }

            const newBalance = Number((currentBalance - price).toFixed(3));
            const unlocked = Array.isArray(userData.unlockedFrames) ? [...userData.unlockedFrames] : ["default"];
            if (!unlocked.includes("default")) unlocked.unshift("default");
            if (!unlocked.includes(frameId)) unlocked.push(frameId);

            userFramesCache.set(activeNick, frameId);
            localStorage.setItem(`egg_frame_${activeNick}`, frameId);
            refreshAllVisibleAvatars();

            await updateDoc(userRef, {
                balance_ml: newBalance,
                unlockedFrames: unlocked,
                selectedFrame: frameId
            });

            window.totalBank = newBalance;
            localStorage.setItem("egg_total_ml_bank", newBalance.toFixed(3));

            await window.updateShopUI();
        } catch (e) {
            alert("Ошибка при покупке: " + e.message);
            await window.updateShopUI();
        }
    };

    window.applyAndSaveFrame = async function (frameId) {
        const activeNick = getActiveUserNick();
        if (!activeNick || !VALID_FRAMES.includes(frameId)) return;

        userFramesCache.set(activeNick, frameId);
        localStorage.setItem(`egg_frame_${activeNick}`, frameId);
        refreshAllVisibleAvatars();

        try {
            const { db, doc, updateDoc } = await getFirestoreApi();
            await updateDoc(doc(db, "users", activeNick), {
                selectedFrame: frameId
            });
            await window.updateShopUI();
        } catch (e) {
            alert("Ошибка сохранения рамки: " + e.message);
        }
    };

    function startDomObserver() {
        let scheduled = false;
        const observer = new MutationObserver((mutations) => {
            let onlyFrames = true;
            for (const m of mutations) {
                if (m.target.id !== "userAvatarImg" && m.target.id !== "shopPreviewAvatar" && !m.target.dataset?.appliedFrame) {
                    onlyFrames = false;
                    break;
                }
            }
            if (onlyFrames) return;

            if (scheduled) return;
            scheduled = true;
            setTimeout(() => {
                scheduled = false;
                refreshAllVisibleAvatars();
                checkShopButtonVisibility();
            }, 100);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "src"]
        });
    }

    setTimeout(() => {
        injectGlobalStyles();
        injectShopButton();
        createShopDrawer();
        startDomObserver();
        refreshAllVisibleAvatars();
        setInterval(checkShopButtonVisibility, 250);
    }, 600);
})();
