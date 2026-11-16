// shop.js — Полная синхронизация: рамки и радужный перелив работают в магазине, в профиле и у всех друзей

(function() {
    // 1. Создаем кнопку "Магазин" со смайликом 🏪 в главном меню
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
            display: flex;
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

    // 2. Создаем шторку магазина с падающими предметами и заголовком по центру
    function createShopDrawer() {
        if (document.getElementById("shopDrawer")) return;

        const shopDrawer = document.createElement("div");
        shopDrawer.id = "shopDrawer";
        shopDrawer.style.cssText = `
            position: absolute;
            top: 0;
            left: -380px;
            width: 360px;
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

                <div style="margin: 10px auto; position: relative; width: 80px; height: 80px;">
                    <div id="shopPreviewBorder" style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid #fff; box-sizing: border-box; position: absolute; top:0; left:0; transition: all 0.3s;"></div>
                    <img id="shopPreviewAvatar" src="https://via.placeholder.com/80" style="width: 74px; height: 74px; border-radius: 50%; object-fit: cover; position: absolute; top: 3px; left: 3px;">
                </div>
                <div id="shopCurrentBalance" style="font-size: 13px; color: #a5d6a7; margin-bottom: 15px;">Баланс: загрузка...</div>

                <button class="btn-drawer-custom" style="margin-bottom: 5px; background: #248bda; display:flex; justify-content:space-between; align-items:center;" onclick="toggleShopFramesAccordion()">
                    <span>✨ Рамки для аватара</span>
                    <span id="accordionArrow">▼</span>
                </button>

                <div id="shopFramesContainer" class="drawer-section-panel" style="display:none; max-height:260px; margin-top:0; margin-bottom:15px; width:100%;">
                    <div style="width:100%; display:flex; flex-direction:column; gap:6px;">
                        
                        <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="width:24px; height:24px; border-radius:50%; border:3px solid #fff;"></div>
                                <span style="font-size:11px; font-weight:bold; color:#fff;">Стандартная</span>
                            </div>
                            <div id="action_default"></div>
                        </div>

                        <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="width:24px; height:24px; border-radius:50%; border:3px solid #ff4d4d;"></div>
                                <span style="font-size:11px; font-weight:bold; color:#fff;">Красная (1 мл)</span>
                            </div>
                            <div id="action_red"></div>
                        </div>

                        <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="width:24px; height:24px; border-radius:50%; border:3px solid #9c27b0;"></div>
                                <span style="font-size:11px; font-weight:bold; color:#fff;">Фиолетовая (1 мл)</span>
                            </div>
                            <div id="action_purple"></div>
                        </div>

                        <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div id="rainbowShopDemo" style="width:24px; height:24px; border-radius:50%; border:3px solid red;"></div>
                                <span style="font-size:11px; font-weight:bold; color:#fff;">Радужная (2 мл)</span>
                            </div>
                            <div id="action_rainbow"></div>
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
        sCanvas.width = sW * (window.devicePixelRatio || 1);
        sCanvas.height = sH * (window.devicePixelRatio || 1);
        sCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

        let sDecorItems = [];
        const pool = ["sword", "bomb", "shield", "helmet", "drop1", "snow", "table"];
        for (let i = 0; i < 10; i++) {
            let t = pool[Math.floor(Math.random() * pool.length)];
            sDecorItems.push({
                x: Math.random() * sW,
                y: Math.random() * sH,
                speed: 1.3 + Math.random() * 1.6,
                type: t,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.025
            });
        }

        function drawShopDecor() {
            const drawer = document.getElementById("shopDrawer");
            if (!drawer || drawer.style.left !== "0px") {
                requestAnimationFrame(drawShopDecor);
                return;
            }

            sCtx.clearRect(0, 0, sW, sH);
            sDecorItems.forEach(item => {
                item.y += item.speed;
                item.rotation += item.rotSpeed;
                if (item.y > sH + 50) {
                    item.y = -50;
                    item.x = Math.random() * sW;
                }

                sCtx.save();
                sCtx.translate(item.x, item.y);
                sCtx.rotate(item.rotation);
                sCtx.font = "35px 'Segoe UI Emoji', 'Apple Color Emoji', Arial, sans-serif";
                sCtx.textAlign = "center";

                let symbol = "🗡";
                if (item.type === "table") symbol = "🪑";
                else if (item.type === "shield") symbol = "🛡";
                else if (item.type === "helmet") symbol = "🪖";
                else if (item.type === "drop1") symbol = "💧";
                else if (item.type === "snow") symbol = "❄️";
                else if (item.type === "bomb") symbol = "💣";

                sCtx.fillText(symbol, 0, 0);
                sCtx.restore();
            });

            requestAnimationFrame(drawShopDecor);
        }
        requestAnimationFrame(drawShopDecor);
    }

    window.toggleShopFramesAccordion = function() {
        const container = document.getElementById("shopFramesContainer");
        const arrow = document.getElementById("accordionArrow");
        if (!container) return;
        const isVisible = container.style.display === "flex";
        container.style.display = isVisible ? "none" : "flex";
        if (arrow) arrow.innerText = isVisible ? "▼" : "▲";
    };

    window.toggleShopDrawer = async function() {
        const drawer = document.getElementById("shopDrawer");
        if (!drawer) return;
        const isOpen = drawer.style.left === "0px";
        if (isOpen) {
            drawer.style.left = "-380px";
        } else {
            const profileDrawer = document.getElementById("profileDrawer");
            if (profileDrawer) profileDrawer.classList.remove("open");
            drawer.style.left = "0px";
            await window.updateShopUI();
        }
    };

    function checkShopButtonVisibility() {
        const shopBtn = document.getElementById("menuShopBtn");
        const profileDrawer = document.getElementById("profileDrawer");
        const shopDrawer = document.getElementById("shopDrawer");
        
        if (!shopBtn) return;

        const isProfileOpen = profileDrawer && profileDrawer.classList.contains("open");
        const isShopOpen = shopDrawer && shopDrawer.style.left === "0px";
        const isGamePlaying = window.gameStarted === true;
        const isGamePaused = window.isPaused === true;
        const isGameOver = window.gameOver === true;

        if (isProfileOpen || isShopOpen || isGamePlaying || isGamePaused || isGameOver) {
            shopBtn.style.display = "none";
        } else {
            shopBtn.style.display = "flex";
        }
    }

    setInterval(checkShopButtonVisibility, 100);

    // Функция применения цвета рамки к любому элементу
    window.applyFrameColor = function(el, frameName, rainbowColor) {
        if (!el) return;
        el.dataset.frame = frameName;
        if (frameName === "red") {
            el.style.borderColor = "#ff4d4d";
            el.style.borderWidth = "3px";
            el.style.borderStyle = "solid";
        } else if (frameName === "purple") {
            el.style.borderColor = "#9c27b0";
            el.style.borderWidth = "3px";
            el.style.borderStyle = "solid";
        } else if (frameName === "rainbow") {
            el.style.borderColor = rainbowColor || "#ff0000";
            el.style.borderWidth = "3px";
            el.style.borderStyle = "solid";
        } else {
            el.style.borderColor = "#ffffff";
        }
    };

    const usersFramesCache = {};

    async function fetchUserFrame(nick) {
        if (!nick) return "default";
        if (usersFramesCache[nick]) return usersFramesCache[nick];
        try {
            const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const db = getFirestore();
            const snap = await getDoc(doc(db, "users", nick));
            if (snap.exists()) {
                const frame = snap.data().selectedFrame || "default";
                usersFramesCache[nick] = frame;
                return frame;
            }
        } catch(e) {}
        return "default";
    }

    // Живой цикл обновления рамок в магазине, в вашей шторке профиля и у всех игроков/друзей
    setInterval(async () => {
        const hue = (Date.now() / 10) % 360;
        const rainbowColor = `hsl(${hue}, 100%, 50%)`;

        // 1. В магазине (превью и демо)
        const demo = document.getElementById("rainbowShopDemo");
        if (demo) demo.style.borderColor = rainbowColor;
        const previewBorder = document.getElementById("shopPreviewBorder");
        if (previewBorder && previewBorder.dataset.frame === "rainbow") {
            previewBorder.style.borderColor = rainbowColor;
        }

        // 2. В вашем главном профиле (все возможные блоки аватарок в шторке аккаунта)
        const activeNick = localStorage.getItem("egg_logged_in_nick");
        const myCurrentFrame = window.currentUserData?.selectedFrame || "default";
        
        // Ищем все обертки и изображения аватарок в шторке профиля
        document.querySelectorAll(".drawer-avatar-wrap, #userAvatarImg, .profile-avatar-container").forEach(el => {
            if (myCurrentFrame !== "default") {
                window.applyFrameColor(el, myCurrentFrame, rainbowColor);
            }
        });

        // 3. У друзей в списке и в чатах в реальном времени
        const avatars = document.querySelectorAll(".user-result-ava, #activeChatAvatar, img[data-friend-nick]");
        for (let imgEl of avatars) {
            let friendNick = imgEl.dataset.friendNick || imgEl.getAttribute("alt") || imgEl.title;
            if (friendNick && friendNick !== activeNick) {
                let fFrame = await fetchUserFrame(friendNick);
                if (fFrame && fFrame !== "default") {
                    window.applyFrameColor(imgEl, fFrame, rainbowColor);
                }
            }
        }
    }, 200);

    // Загрузка данных из Firebase
    window.updateShopUI = async function() {
        const activeNick = localStorage.getItem("egg_logged_in_nick");
        if (!activeNick) {
            document.getElementById("shopCurrentBalance").innerText = "Войдите в аккаунт!";
            return;
        }

        try {
            const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const db = getFirestore();
            const userSnap = await getDoc(doc(db, "users", activeNick));

            if (!userSnap.exists()) return;
            const userData = userSnap.data();

            const balance = userData.balance_ml || 0;
            document.getElementById("shopCurrentBalance").innerText = `Баланс: ${balance.toFixed(3)} мл`;

            const mainAvatarImg = document.getElementById("userAvatarImg");
            const previewAvatar = document.getElementById("shopPreviewAvatar");
            if (previewAvatar) {
                previewAvatar.src = (userData.avatarUrl && userData.avatarUrl !== "") ? userData.avatarUrl : (mainAvatarImg ? mainAvatarImg.src : "https://via.placeholder.com/80");
            }

            const unlocked = userData.unlockedFrames || ["default"];
            const currentFrame = userData.selectedFrame || "default";

            const previewBorder = document.getElementById("shopPreviewBorder");
            if (previewBorder) {
                previewBorder.dataset.frame = currentFrame;
            }

            renderItemAction("default", 0, "Стандартная", unlocked, currentFrame);
            renderItemAction("red", 1.0, "Красная", unlocked, currentFrame);
            renderItemAction("purple", 1.0, "Фиолетовая", unlocked, currentFrame);
            renderItemAction("rainbow", 2.0, "Радужная", unlocked, currentFrame);

            // Обновляем глобальные данные
            if (!window.currentUserData) window.currentUserData = {};
            window.currentUserData.selectedFrame = currentFrame;
            window.currentUserData.balance_ml = balance;

        } catch (e) {
            console.error("Ошибка загрузки магазина:", e);
        }
    };

    function renderItemAction(frameId, price, name, unlocked, current) {
        const container = document.getElementById(`action_${frameId}`);
        if (!container) return;

        const hasIt = unlocked.includes(frameId);
        const isSelected = (current === frameId);

        if (isSelected) {
            container.innerHTML = `<button class="btn-mini-action btn-mini-gray" disabled>Выбрано ✅</button>`;
        } else if (hasIt) {
            container.innerHTML = `<button class="btn-mini-action btn-mini-success" onclick="applyAndSaveFrame('${frameId}')">Выбрать</button>`;
        } else {
            container.innerHTML = `<button class="btn-mini-action" onclick="buyAndUnlockFrame('${frameId}', ${price})">Купить (${price} мл)</button>`;
        }
    }

    window.buyAndUnlockFrame = async function(frameId, price) {
        const activeNick = localStorage.getItem("egg_logged_in_nick");
        if (!activeNick) {
            alert("Сначала войдите в аккаунт!");
            return;
        }

        try {
            const { getFirestore, doc, getDoc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const db = getFirestore();
            const userRef = doc(db, "users", activeNick);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) return;
            const userData = userSnap.data();
            const currentBalance = userData.balance_ml || 0;

            if (currentBalance < price) {
                alert("❌ Недостаточно миллилитров в банке!");
                return;
            }

            const newBalance = currentBalance - price;
            let unlocked = userData.unlockedFrames || ["default"];
            if (!unlocked.includes(frameId)) unlocked.push(frameId);

            await updateDoc(userRef, {
                balance_ml: newBalance,
                unlockedFrames: unlocked,
                selectedFrame: frameId
            });

            window.totalBank = newBalance;
            localStorage.setItem("egg_total_ml_bank", newBalance.toFixed(3));
            if (!window.currentUserData) window.currentUserData = {};
            window.currentUserData.balance_ml = newBalance;
            window.currentUserData.unlockedFrames = unlocked;
            window.currentUserData.selectedFrame = frameId;
            usersFramesCache[activeNick] = frameId;

            await window.updateShopUI();
            alert("🎉 Рамка успешно куплена и установлена!");
        } catch (e) {
            alert("Ошибка при покупке: " + e.message);
        }
    };

    window.applyAndSaveFrame = async function(frameId) {
        const activeNick = localStorage.getItem("egg_logged_in_nick");
        if (!activeNick) return;

        try {
            const { getFirestore, doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const db = getFirestore();
            const userRef = doc(db, "users", activeNick);

            await updateDoc(userRef, {
                selectedFrame: frameId
            });

            if (!window.currentUserData) window.currentUserData = {};
            window.currentUserData.selectedFrame = frameId;
            usersFramesCache[activeNick] = frameId;

            await window.updateShopUI();
            alert("✅ Рамка успешно применена!");
        } catch (e) {
            alert("Ошибка выбора рамки: " + e.message);
        }
    };

    setTimeout(() => {
        injectShopButton();
        createShopDrawer();
    }, 1000);
})();
